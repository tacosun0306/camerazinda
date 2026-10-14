alter table public.inventory_items add column barcode text;
create unique index inventory_items_barcode_key on public.inventory_items (barcode) where barcode is not null;

create table public.store_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.store_locations (name)
select distinct trim(store_name)
from public.profiles
where nullif(trim(store_name), '') is not null
on conflict (name) do nothing;

insert into public.store_locations (name)
values (U&'\53F0\5317\65D7\8266\5E97')
on conflict (name) do nothing;

create table public.inventory_stocks (
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  store_id uuid not null references public.store_locations (id),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (item_id, store_id)
);

insert into public.inventory_stocks (item_id, store_id, quantity)
select item.id, store.id, item.quantity
from public.inventory_items as item
cross join public.store_locations as store
where store.name = U&'\53F0\5317\65D7\8266\5E97'
on conflict (item_id, store_id) do nothing;

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  action text not null check (action in ('created', 'updated', 'sale', 'transfer')),
  quantity integer check (quantity is null or quantity > 0),
  from_store_id uuid references public.store_locations (id),
  to_store_id uuid references public.store_locations (id),
  actor_id uuid not null references public.profiles (id),
  note text,
  created_at timestamptz not null default now()
);

create index inventory_movements_item_created_idx on public.inventory_movements (item_id, created_at desc);

alter table public.store_locations enable row level security;
alter table public.inventory_stocks enable row level security;
alter table public.inventory_movements enable row level security;

create policy "Active employees read store locations" on public.store_locations for select to authenticated
  using (public.current_employee_role() is not null);
create policy "Active employees read inventory stocks" on public.inventory_stocks for select to authenticated
  using (public.current_employee_role() is not null);
create policy "Active employees read inventory movements" on public.inventory_movements for select to authenticated
  using (public.current_employee_role() is not null);

revoke all on public.store_locations, public.inventory_stocks, public.inventory_movements from public, anon, authenticated;
grant select on public.store_locations, public.inventory_stocks, public.inventory_movements to authenticated;
revoke all on sequence public.inventory_movements_id_seq from public, anon, authenticated;

revoke insert, update on public.inventory_items from public, anon, authenticated;
grant update (name, sku, barcode, serial_number, category, reorder_threshold) on public.inventory_items to authenticated;

create function public.sync_inventory_item_quantity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_item_id uuid;
begin
  affected_item_id := case when tg_op = 'DELETE' then old.item_id else new.item_id end;
  update public.inventory_items
  set quantity = coalesce((select sum(quantity) from public.inventory_stocks where item_id = affected_item_id), 0),
      updated_at = now()
  where id = affected_item_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger sync_inventory_item_quantity_after_stock_change
after insert or update or delete on public.inventory_stocks
for each row execute function public.sync_inventory_item_quantity();

create function public.create_inventory_store(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.employee_role;
  store_id uuid;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager') then
    raise exception 'Only managers can create store locations' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'Store name is required' using errcode = '22023';
  end if;
  insert into public.store_locations (name) values (trim(p_name))
  on conflict (name) do update set active = true
  returning id into store_id;
  return store_id;
end;
$$;

create function public.create_inventory_item(
  p_name text,
  p_sku text,
  p_barcode text,
  p_serial_number text,
  p_category text,
  p_reorder_threshold integer,
  p_initial_quantity integer,
  p_store_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.employee_role;
  item_id uuid;
  store_exists boolean;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Not allowed to create inventory items' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_sku), '') is null or nullif(trim(p_category), '') is null then
    raise exception 'Name, SKU, and category are required' using errcode = '22023';
  end if;
  if p_reorder_threshold < 0 or p_initial_quantity < 0 then
    raise exception 'Quantities cannot be negative' using errcode = '22023';
  end if;
  select exists (select 1 from public.store_locations where id = p_store_id and active) into store_exists;
  if not store_exists then
    raise exception 'Active store location not found' using errcode = '22023';
  end if;
  insert into public.inventory_items (name, sku, barcode, serial_number, category, quantity, reorder_threshold)
  values (trim(p_name), trim(p_sku), nullif(trim(p_barcode), ''), nullif(trim(p_serial_number), ''), trim(p_category), 0, p_reorder_threshold)
  returning id into item_id;
  insert into public.inventory_stocks (item_id, store_id, quantity)
  values (item_id, p_store_id, p_initial_quantity);
  insert into public.inventory_movements (item_id, action, quantity, to_store_id, actor_id, note)
  values (item_id, 'created', nullif(p_initial_quantity, 0), p_store_id, auth.uid(), 'Product created');
  return item_id;
end;
$$;

create function public.update_inventory_item_details(
  p_item_id uuid,
  p_name text,
  p_sku text,
  p_barcode text,
  p_serial_number text,
  p_category text,
  p_reorder_threshold integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.employee_role;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Not allowed to update inventory items' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_sku), '') is null or nullif(trim(p_category), '') is null or p_reorder_threshold < 0 then
    raise exception 'Invalid inventory item details' using errcode = '22023';
  end if;
  update public.inventory_items
  set name = trim(p_name), sku = trim(p_sku), barcode = nullif(trim(p_barcode), ''),
      serial_number = nullif(trim(p_serial_number), ''), category = trim(p_category),
      reorder_threshold = p_reorder_threshold, updated_at = now()
  where id = p_item_id;
  if not found then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  insert into public.inventory_movements (item_id, action, actor_id, note)
  values (p_item_id, 'updated', auth.uid(), 'Product details updated');
end;
$$;

create function public.record_inventory_sale(p_item_id uuid, p_store_id uuid, p_quantity integer, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.employee_role;
  current_quantity integer;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Not allowed to sell inventory' using errcode = '42501';
  end if;
  if p_quantity <= 0 then raise exception 'Quantity must be greater than zero' using errcode = '22023'; end if;
  perform 1 from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  select quantity into current_quantity from public.inventory_stocks
  where item_id = p_item_id and store_id = p_store_id for update;
  if not found then raise exception 'No stock record at this store' using errcode = 'P0002'; end if;
  if current_quantity < p_quantity then raise exception 'Insufficient stock' using errcode = '22023'; end if;
  update public.inventory_stocks set quantity = quantity - p_quantity, updated_at = now()
  where item_id = p_item_id and store_id = p_store_id;
  insert into public.inventory_movements (item_id, action, quantity, from_store_id, actor_id, note)
  values (p_item_id, 'sale', p_quantity, p_store_id, auth.uid(), nullif(trim(p_note), ''));
end;
$$;

create function public.transfer_inventory_stock(
  p_item_id uuid,
  p_from_store_id uuid,
  p_to_store_id uuid,
  p_quantity integer,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.employee_role;
  current_quantity integer;
  target_exists boolean;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Not allowed to transfer inventory' using errcode = '42501';
  end if;
  if p_quantity <= 0 or p_from_store_id = p_to_store_id then
    raise exception 'Invalid transfer quantity or locations' using errcode = '22023';
  end if;
  perform 1 from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  select exists (select 1 from public.store_locations where id = p_to_store_id and active) into target_exists;
  if not target_exists then raise exception 'Active destination store not found' using errcode = '22023'; end if;
  select quantity into current_quantity from public.inventory_stocks
  where item_id = p_item_id and store_id = p_from_store_id for update;
  if not found then raise exception 'No stock record at source store' using errcode = 'P0002'; end if;
  if current_quantity < p_quantity then raise exception 'Insufficient stock' using errcode = '22023'; end if;
  update public.inventory_stocks set quantity = quantity - p_quantity, updated_at = now()
  where item_id = p_item_id and store_id = p_from_store_id;
  insert into public.inventory_stocks (item_id, store_id, quantity)
  values (p_item_id, p_to_store_id, p_quantity)
  on conflict (item_id, store_id) do update
  set quantity = public.inventory_stocks.quantity + excluded.quantity, updated_at = now();
  insert into public.inventory_movements (item_id, action, quantity, from_store_id, to_store_id, actor_id, note)
  values (p_item_id, 'transfer', p_quantity, p_from_store_id, p_to_store_id, auth.uid(), nullif(trim(p_note), ''));
end;
$$;

revoke all on function public.sync_inventory_item_quantity() from public, anon, authenticated;
revoke all on function public.create_inventory_store(text) from public, anon;
revoke all on function public.create_inventory_item(text, text, text, text, text, integer, integer, uuid) from public, anon;
revoke all on function public.update_inventory_item_details(uuid, text, text, text, text, text, integer) from public, anon;
revoke all on function public.record_inventory_sale(uuid, uuid, integer, text) from public, anon;
revoke all on function public.transfer_inventory_stock(uuid, uuid, uuid, integer, text) from public, anon;

grant execute on function public.create_inventory_store(text) to authenticated;
grant execute on function public.create_inventory_item(text, text, text, text, text, integer, integer, uuid) to authenticated;
grant execute on function public.update_inventory_item_details(uuid, text, text, text, text, text, integer) to authenticated;
grant execute on function public.record_inventory_sale(uuid, uuid, integer, text) to authenticated;
grant execute on function public.transfer_inventory_stock(uuid, uuid, uuid, integer, text) to authenticated;