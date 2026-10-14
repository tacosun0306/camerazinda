begin;

do $$
begin
  if exists (
    select 1
    from public.inventory_items item
    left join (
      select item_id, sum(quantity)::integer as quantity
      from public.inventory_stocks
      group by item_id
    ) stock on stock.item_id = item.id
    where item.quantity <> coalesce(stock.quantity, 0)
  ) then
    raise exception 'Inventory master quantities do not match store stock totals; unit migration aborted';
  end if;
end;
$$;

create sequence public.product_unit_code_seq;
revoke all on sequence public.product_unit_code_seq from public, anon, authenticated;

create table public.product_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.inventory_items (id) on delete restrict,
  unit_code text not null unique default (
    'UNIT-' || lpad(nextval('public.product_unit_code_seq')::text, 8, '0')
  ),
  store_id uuid not null references public.store_locations (id),
  status text not null default 'in_stock' check (status in ('in_stock', 'sold', 'disabled')),
  created_at timestamptz not null default now(),
  sold_at timestamptz,
  manufacturer_serial text,
  check ((status = 'sold') = (sold_at is not null))
);

create index product_units_product_status_idx on public.product_units (product_id, status);
create index product_units_store_status_idx on public.product_units (store_id, status);
create unique index product_units_manufacturer_serial_key
  on public.product_units (manufacturer_serial) where manufacturer_serial is not null;

create function public.prevent_product_unit_identity_change()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.id is distinct from old.id or new.unit_code is distinct from old.unit_code then
    raise exception 'Physical unit ID and unit code cannot be changed' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger product_unit_identity_immutable_before_update
before update of id, unit_code on public.product_units
for each row execute function public.prevent_product_unit_identity_change();
revoke all on function public.prevent_product_unit_identity_change() from public, anon, authenticated;

insert into public.product_units (product_id, store_id, status, manufacturer_serial)
with stock_rows as (
  select stock.item_id, stock.store_id, stock.quantity, item.serial_number,
    row_number() over (partition by stock.item_id order by stock.store_id) as store_rank
  from public.inventory_stocks stock
  join public.inventory_items item on item.id = stock.item_id
  where stock.quantity > 0
)
select stock.item_id, stock.store_id, 'in_stock',
  case when stock.store_rank = 1 and units.unit_number = 1 then stock.serial_number else null end
from stock_rows stock
cross join lateral generate_series(1, stock.quantity) as units(unit_number);

alter table public.inventory_movements
  add column unit_id uuid references public.product_units (id) on delete restrict;
alter table public.inventory_movements drop constraint inventory_movements_action_check;
alter table public.inventory_movements add constraint inventory_movements_action_check
  check (action in ('created', 'updated', 'received', 'sale', 'transfer', 'disabled'));

alter table public.product_units enable row level security;
revoke all on public.product_units from public, anon, authenticated;
grant select on public.product_units to authenticated;
create policy "Active employees read product units" on public.product_units for select to authenticated
  using (public.current_employee_role() is not null);

create function public.sync_inventory_stock_from_units(p_product_id uuid, p_store_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare unit_count integer;
begin
  select count(*)::integer into unit_count from public.product_units
  where product_id = p_product_id and store_id = p_store_id and status = 'in_stock';
  insert into public.inventory_stocks (item_id, store_id, quantity) values (p_product_id, p_store_id, unit_count)
  on conflict (item_id, store_id) do update
  set quantity = excluded.quantity, updated_at = now()
  where public.inventory_stocks.quantity is distinct from excluded.quantity;
end;
$$;

create function public.sync_inventory_stocks_after_unit_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.sync_inventory_stock_from_units(new.product_id, new.store_id);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.sync_inventory_stock_from_units(old.product_id, old.store_id);
    return old;
  else
    perform public.sync_inventory_stock_from_units(old.product_id, old.store_id);
    if new.product_id is distinct from old.product_id or new.store_id is distinct from old.store_id then
      perform public.sync_inventory_stock_from_units(new.product_id, new.store_id);
    end if;
  end if;
  return new;
end;
$$;

create trigger product_units_sync_inventory_stock
after insert or update or delete on public.product_units
for each row execute function public.sync_inventory_stocks_after_unit_change();
revoke all on function public.sync_inventory_stock_from_units(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sync_inventory_stocks_after_unit_change() from public, anon, authenticated;

create function public.receive_inventory_units(
  p_product_id uuid, p_store_id uuid, p_quantity integer, p_manufacturer_serials text[] default null
)
returns table (unit_id uuid, unit_code text)
language plpgsql security definer set search_path = public
as $$
declare employee_role public.employee_role; product_is_active boolean; store_is_active boolean;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Not allowed to receive inventory' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 5000 then
    raise exception 'Receive quantity must be between 0 and 5000' using errcode = '22023';
  end if;
  if p_manufacturer_serials is not null and cardinality(p_manufacturer_serials) <> p_quantity then
    raise exception 'Manufacturer serial count must match receive quantity' using errcode = '22023';
  end if;
  select active into product_is_active from public.inventory_items where id = p_product_id for update;
  if not found or not product_is_active then raise exception 'Active product not found' using errcode = 'P0002'; end if;
  select active into store_is_active from public.store_locations where id = p_store_id;
  if not found or not store_is_active then raise exception 'Active store location not found' using errcode = 'P0002'; end if;

  return query
  with inserted_units as (
    insert into public.product_units (product_id, store_id, status, manufacturer_serial)
    select p_product_id, p_store_id, 'in_stock',
      case when p_manufacturer_serials is null then null else nullif(trim(p_manufacturer_serials[number]), '') end
    from generate_series(1, p_quantity) as number
    returning id, product_units.unit_code
  ), logged_units as (
    insert into public.inventory_movements as movement (item_id, unit_id, action, quantity, to_store_id, actor_id, note)
    select p_product_id, inserted_units.id, 'received', 1, p_store_id, auth.uid(), 'Unit received'
    from inserted_units returning movement.unit_id
  )
  select inserted_units.id, inserted_units.unit_code from inserted_units;
end;
$$;

create or replace function public.create_inventory_item_with_model(
  p_name text, p_barcode text, p_serial_number text, p_category text,
  p_reorder_threshold integer, p_initial_quantity integer, p_store_id uuid, p_model text default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare created_product jsonb; created_units jsonb; remaining_units jsonb; product_id uuid;
begin
  created_product := public.create_inventory_item(
    p_name, p_barcode, p_serial_number, p_category, p_reorder_threshold, 0, p_store_id
  );
  product_id := (created_product->>'item_id')::uuid;
  update public.inventory_items set model = nullif(trim(p_model), '') where id = product_id;
  if p_initial_quantity > 0 and nullif(trim(p_serial_number), '') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id', unit.unit_id, 'unit_code', unit.unit_code)), '[]'::jsonb)
    into created_units from public.receive_inventory_units(product_id, p_store_id, 1, array[p_serial_number]) unit;
    if p_initial_quantity > 1 then
      select coalesce(jsonb_agg(jsonb_build_object('id', unit.unit_id, 'unit_code', unit.unit_code)), '[]'::jsonb)
      into remaining_units from public.receive_inventory_units(product_id, p_store_id, p_initial_quantity - 1, null) unit;
      created_units := created_units || remaining_units;
    end if;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', unit.unit_id, 'unit_code', unit.unit_code)), '[]'::jsonb)
    into created_units from public.receive_inventory_units(product_id, p_store_id, p_initial_quantity, null) unit;
  end if;
  return created_product || jsonb_build_object('units', created_units);
end;
$$;

revoke all on function public.create_inventory_item(text, text, text, text, integer, integer, uuid)
  from public, anon, authenticated;

create or replace function public.create_inventory_item(
  p_name text,
  p_legacy_sku text,
  p_barcode text,
  p_serial_number text,
  p_category text,
  p_reorder_threshold integer,
  p_initial_quantity integer,
  p_store_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare created_product jsonb;
begin
  created_product := public.create_inventory_item_with_model(
    p_name, p_barcode, p_serial_number, p_category, p_reorder_threshold, p_initial_quantity, p_store_id, null
  );
  return (created_product->>'item_id')::uuid;
end;
$$;

revoke all on function public.create_inventory_item(text, text, text, text, integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.create_inventory_item_with_model(text, text, text, text, integer, integer, uuid, text) from public, anon;
grant execute on function public.create_inventory_item_with_model(text, text, text, text, integer, integer, uuid, text) to authenticated;
grant execute on function public.create_inventory_item(text, text, text, text, text, integer, integer, uuid) to authenticated;

create function public.receive_existing_product_units(p_product_id uuid, p_store_id uuid, p_quantity integer)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare received_units jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', unit.unit_id, 'unit_code', unit.unit_code)), '[]'::jsonb)
  into received_units from public.receive_inventory_units(p_product_id, p_store_id, p_quantity, null) unit;
  return received_units;
end;
$$;

create or replace function public.record_inventory_sale(p_item_id uuid, p_store_id uuid, p_quantity integer, p_note text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare employee_role public.employee_role; product_is_active boolean; unit_ids uuid[];
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then raise exception 'Not allowed to sell inventory' using errcode = '42501'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero' using errcode = '22023'; end if;
  select active into product_is_active from public.inventory_items where id = p_item_id for update;
  if not found or not product_is_active then raise exception 'Active product not found' using errcode = 'P0002'; end if;
  select coalesce(array_agg(selected_unit.id), '{}'::uuid[]) into unit_ids
  from (
    select unit.id from public.product_units unit
    where unit.product_id = p_item_id and unit.store_id = p_store_id and unit.status = 'in_stock'
    order by unit.created_at, unit.id for update skip locked limit p_quantity
  ) selected_unit;
  if cardinality(unit_ids) <> p_quantity then raise exception 'Insufficient available physical units' using errcode = '22023'; end if;
  update public.product_units set status = 'sold', sold_at = now() where id = any(unit_ids);
  insert into public.inventory_movements (item_id, unit_id, action, quantity, from_store_id, actor_id, note)
  select p_item_id, unit_id, 'sale', 1, p_store_id, auth.uid(), nullif(trim(p_note), '') from unnest(unit_ids) unit_id;
end;
$$;

create function public.record_inventory_unit_sale(p_unit_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare employee_role public.employee_role; unit_row public.product_units%rowtype; product_is_active boolean; product_id uuid;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then raise exception 'Not allowed to sell inventory' using errcode = '42501'; end if;
  select unit.product_id into product_id from public.product_units unit where unit.id = p_unit_id;
  if not found then raise exception 'Physical unit not found' using errcode = 'P0002'; end if;
  perform 1 from public.inventory_items where id = product_id and active for update;
  if not found then raise exception 'Product is inactive or missing' using errcode = '22023'; end if;
  select * into unit_row from public.product_units where id = p_unit_id for update;
  if not found or unit_row.status <> 'in_stock' or unit_row.product_id <> product_id then raise exception 'Physical unit is not available for sale' using errcode = '22023'; end if;
  update public.product_units set status = 'sold', sold_at = now() where id = p_unit_id;
  insert into public.inventory_movements (item_id, unit_id, action, quantity, from_store_id, actor_id, note)
  values (unit_row.product_id, unit_row.id, 'sale', 1, unit_row.store_id, auth.uid(), nullif(trim(p_note), ''));
end;
$$;

create function public.record_inventory_units_sale(p_unit_ids uuid[], p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.employee_role;
  unit_row public.product_units%rowtype;
  product_id uuid;
  locked_count integer := 0;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Not allowed to sell inventory' using errcode = '42501';
  end if;
  if p_unit_ids is null or cardinality(p_unit_ids) = 0 or cardinality(p_unit_ids) > 500 then
    raise exception 'Select between 1 and 500 physical units' using errcode = '22023';
  end if;
  if (select count(distinct id) from unnest(p_unit_ids) as requested(id)) <> cardinality(p_unit_ids) then
    raise exception 'Duplicate physical units in sale request' using errcode = '22023';
  end if;

  for product_id in
    select distinct unit.product_id from public.product_units unit where unit.id = any(p_unit_ids) order by unit.product_id
  loop
    perform 1 from public.inventory_items where id = product_id and active for update;
    if not found then raise exception 'Product is inactive or missing' using errcode = '22023'; end if;
  end loop;

  for unit_row in
    select unit.* from public.product_units unit where unit.id = any(p_unit_ids) order by unit.id for update
  loop
    if unit_row.status <> 'in_stock' then raise exception 'Physical unit % is not available for sale', unit_row.unit_code using errcode = '22023'; end if;
    if not exists (select 1 from public.inventory_items item where item.id = unit_row.product_id and item.active) then
      raise exception 'Product for unit % is inactive', unit_row.unit_code using errcode = '22023';
    end if;
    locked_count := locked_count + 1;
  end loop;
  if locked_count <> cardinality(p_unit_ids) then raise exception 'One or more physical units no longer exist' using errcode = 'P0002'; end if;

  for unit_row in
    select unit.* from public.product_units unit where unit.id = any(p_unit_ids) order by unit.id
  loop
    update public.product_units set status = 'sold', sold_at = now() where id = unit_row.id;
    insert into public.inventory_movements (item_id, unit_id, action, quantity, from_store_id, actor_id, note)
    values (unit_row.product_id, unit_row.id, 'sale', 1, unit_row.store_id, auth.uid(), nullif(trim(p_note), ''));
  end loop;
end;
$$;

create function public.transfer_inventory_units(p_unit_ids uuid[], p_to_store_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.employee_role;
  unit_row public.product_units%rowtype;
  product_id uuid;
  target_is_active boolean;
  locked_count integer := 0;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Not allowed to transfer inventory' using errcode = '42501';
  end if;
  if p_unit_ids is null or cardinality(p_unit_ids) = 0 or cardinality(p_unit_ids) > 500 then
    raise exception 'Select between 1 and 500 physical units' using errcode = '22023';
  end if;
  if (select count(distinct id) from unnest(p_unit_ids) as requested(id)) <> cardinality(p_unit_ids) then
    raise exception 'Duplicate physical units in transfer request' using errcode = '22023';
  end if;
  select active into target_is_active from public.store_locations where id = p_to_store_id;
  if not found or not target_is_active then raise exception 'Active destination store not found' using errcode = 'P0002'; end if;

  for product_id in
    select distinct unit.product_id from public.product_units unit where unit.id = any(p_unit_ids) order by unit.product_id
  loop
    perform 1 from public.inventory_items where id = product_id and active for update;
    if not found then raise exception 'Product is inactive or missing' using errcode = '22023'; end if;
  end loop;

  for unit_row in
    select unit.* from public.product_units unit where unit.id = any(p_unit_ids) order by unit.id for update
  loop
    if unit_row.status <> 'in_stock' then raise exception 'Physical unit % is not available for transfer', unit_row.unit_code using errcode = '22023'; end if;
    if unit_row.store_id = p_to_store_id then raise exception 'Physical unit % is already at destination', unit_row.unit_code using errcode = '22023'; end if;
    if not exists (select 1 from public.inventory_items item where item.id = unit_row.product_id and item.active) then
      raise exception 'Product for unit % is inactive', unit_row.unit_code using errcode = '22023';
    end if;
    locked_count := locked_count + 1;
  end loop;
  if locked_count <> cardinality(p_unit_ids) then raise exception 'One or more physical units no longer exist' using errcode = 'P0002'; end if;

  for unit_row in
    select unit.* from public.product_units unit where unit.id = any(p_unit_ids) order by unit.id
  loop
    update public.product_units set store_id = p_to_store_id where id = unit_row.id;
    insert into public.inventory_movements (item_id, unit_id, action, quantity, from_store_id, to_store_id, actor_id, note)
    values (unit_row.product_id, unit_row.id, 'transfer', 1, unit_row.store_id, p_to_store_id, auth.uid(), nullif(trim(p_note), ''));
  end loop;
end;
$$;

create or replace function public.transfer_inventory_stock(p_item_id uuid, p_from_store_id uuid, p_to_store_id uuid, p_quantity integer, p_note text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare employee_role public.employee_role; product_is_active boolean; target_is_active boolean; unit_ids uuid[];
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then raise exception 'Not allowed to transfer inventory' using errcode = '42501'; end if;
  if p_quantity is null or p_quantity <= 0 or p_from_store_id = p_to_store_id then raise exception 'Invalid transfer quantity or locations' using errcode = '22023'; end if;
  select active into product_is_active from public.inventory_items where id = p_item_id for update;
  if not found or not product_is_active then raise exception 'Active product not found' using errcode = 'P0002'; end if;
  select active into target_is_active from public.store_locations where id = p_to_store_id;
  if not found or not target_is_active then raise exception 'Active destination store not found' using errcode = 'P0002'; end if;
  select coalesce(array_agg(selected_unit.id), '{}'::uuid[]) into unit_ids
  from (
    select unit.id from public.product_units unit
    where unit.product_id = p_item_id and unit.store_id = p_from_store_id and unit.status = 'in_stock'
    order by unit.created_at, unit.id for update skip locked limit p_quantity
  ) selected_unit;
  if cardinality(unit_ids) <> p_quantity then raise exception 'Insufficient available physical units at source store' using errcode = '22023'; end if;
  update public.product_units set store_id = p_to_store_id where id = any(unit_ids);
  insert into public.inventory_movements (item_id, unit_id, action, quantity, from_store_id, to_store_id, actor_id, note)
  select p_item_id, unit_id, 'transfer', 1, p_from_store_id, p_to_store_id, auth.uid(), nullif(trim(p_note), '') from unnest(unit_ids) unit_id;
end;
$$;

create function public.transfer_inventory_unit(p_unit_id uuid, p_to_store_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare employee_role public.employee_role; unit_row public.product_units%rowtype; target_is_active boolean; product_id uuid;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then raise exception 'Not allowed to transfer inventory' using errcode = '42501'; end if;
  select unit.product_id into product_id from public.product_units unit where unit.id = p_unit_id;
  if not found then raise exception 'Physical unit not found' using errcode = 'P0002'; end if;
  perform 1 from public.inventory_items where id = product_id and active for update;
  if not found then raise exception 'Product is inactive or missing' using errcode = '22023'; end if;
  select * into unit_row from public.product_units where id = p_unit_id for update;
  if not found or unit_row.status <> 'in_stock' or unit_row.product_id <> product_id then raise exception 'Physical unit is not available for transfer' using errcode = '22023'; end if;
  select active into target_is_active from public.store_locations where id = p_to_store_id;
  if not found or not target_is_active then raise exception 'Active destination store not found' using errcode = 'P0002'; end if;
  if unit_row.store_id = p_to_store_id then raise exception 'Unit is already at destination store' using errcode = '22023'; end if;
  update public.product_units set store_id = p_to_store_id where id = p_unit_id;
  insert into public.inventory_movements (item_id, unit_id, action, quantity, from_store_id, to_store_id, actor_id, note)
  values (unit_row.product_id, unit_row.id, 'transfer', 1, unit_row.store_id, p_to_store_id, auth.uid(), nullif(trim(p_note), ''));
end;
$$;

create function public.get_inventory_unit(p_unit_id uuid)
returns table (id uuid, product_id uuid, unit_code text, store_id uuid, status text, sold_at timestamptz, manufacturer_serial text, product_name text, model text, sku text, category text, product_active boolean, store_name text)
language sql stable security invoker set search_path = public
as $$
  select unit.id, unit.product_id, unit.unit_code, unit.store_id, unit.status, unit.sold_at, unit.manufacturer_serial,
    item.name, item.model, item.sku, item.category, item.active, store.name
  from public.product_units unit
  join public.inventory_items item on item.id = unit.product_id
  join public.store_locations store on store.id = unit.store_id
  where unit.id = p_unit_id and public.current_employee_role() is not null;
$$;

drop function public.search_inventory_label_items(text, text, integer, integer);
create function public.search_inventory_label_items(p_search text default null, p_category text default null, p_offset integer default 0, p_page_size integer default 50)
returns table (id uuid, product_id uuid, unit_code text, name text, model text, sku text, category text, store_name text, total_count bigint)
language sql stable security invoker set search_path = public
as $$
  with matching_units as (
    select unit.id, unit.product_id, unit.unit_code, item.name, item.model, item.sku, item.category, store.name as store_name
    from public.product_units unit
    join public.inventory_items item on item.id = unit.product_id
    join public.store_locations store on store.id = unit.store_id
    where unit.status = 'in_stock' and item.active = true and public.current_employee_role() is not null
      and (p_category is null or item.category = p_category)
      and (nullif(trim(p_search), '') is null or concat_ws(' ', item.name, item.model, item.sku, item.category, unit.unit_code, unit.manufacturer_serial, item.barcode) ilike '%' || trim(p_search) || '%')
  )
  select matching_units.id, matching_units.product_id, matching_units.unit_code, matching_units.name, matching_units.model,
    matching_units.sku, matching_units.category, matching_units.store_name, count(*) over ()
  from matching_units order by matching_units.name, matching_units.sku, matching_units.unit_code
  limit least(greatest(coalesce(p_page_size, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create function public.validate_inventory_label_units(p_unit_ids uuid[])
returns table (id uuid, product_id uuid, unit_code text, name text, model text, sku text, category text, store_name text, status text)
language sql stable security invoker set search_path = public
as $$
  select unit.id, unit.product_id, unit.unit_code, item.name, item.model, item.sku, item.category, store.name, unit.status
  from public.product_units unit
  join public.inventory_items item on item.id = unit.product_id
  join public.store_locations store on store.id = unit.store_id
  where unit.id = any(coalesce(p_unit_ids, '{}'::uuid[])) and unit.status = 'in_stock'
    and item.active = true and public.current_employee_role() is not null;
$$;

create function public.search_unit_product_categories()
returns table (category text)
language sql stable security invoker set search_path = public
as $$
  select distinct item.category from public.product_units unit
  join public.inventory_items item on item.id = unit.product_id
  where unit.status = 'in_stock' and item.active = true and public.current_employee_role() is not null
  order by item.category;
$$;

revoke all on function public.sync_inventory_stock_from_units(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sync_inventory_stocks_after_unit_change() from public, anon, authenticated;
revoke all on function public.receive_inventory_units(uuid, uuid, integer, text[]) from public, anon;
revoke all on function public.receive_existing_product_units(uuid, uuid, integer) from public, anon;
revoke all on function public.record_inventory_sale(uuid, uuid, integer, text) from public, anon;
revoke all on function public.record_inventory_units_sale(uuid[], text) from public, anon;
revoke all on function public.record_inventory_unit_sale(uuid, text) from public, anon;
revoke all on function public.transfer_inventory_stock(uuid, uuid, uuid, integer, text) from public, anon;
revoke all on function public.transfer_inventory_units(uuid[], uuid, text) from public, anon;
revoke all on function public.transfer_inventory_unit(uuid, uuid, text) from public, anon;
revoke all on function public.get_inventory_unit(uuid) from public, anon;
revoke all on function public.search_inventory_label_items(text, text, integer, integer) from public, anon;
revoke all on function public.validate_inventory_label_units(uuid[]) from public, anon;
revoke all on function public.search_unit_product_categories() from public, anon;
grant execute on function public.receive_inventory_units(uuid, uuid, integer, text[]) to authenticated;
grant execute on function public.receive_existing_product_units(uuid, uuid, integer) to authenticated;
grant execute on function public.record_inventory_sale(uuid, uuid, integer, text) to authenticated;
grant execute on function public.record_inventory_units_sale(uuid[], text) to authenticated;
grant execute on function public.record_inventory_unit_sale(uuid, text) to authenticated;
grant execute on function public.transfer_inventory_stock(uuid, uuid, uuid, integer, text) to authenticated;
grant execute on function public.transfer_inventory_units(uuid[], uuid, text) to authenticated;
grant execute on function public.transfer_inventory_unit(uuid, uuid, text) to authenticated;
grant execute on function public.get_inventory_unit(uuid) to authenticated;
grant execute on function public.search_inventory_label_items(text, text, integer, integer) to authenticated;
grant execute on function public.validate_inventory_label_units(uuid[]) to authenticated;
grant execute on function public.search_unit_product_categories() to authenticated;

commit;