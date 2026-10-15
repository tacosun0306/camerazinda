begin;

create table public.inventory_stocktakes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.store_locations (id) on delete restrict,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'completed')),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  note text
);

create index inventory_stocktakes_store_created_idx
  on public.inventory_stocktakes (store_id, created_at desc);
create index inventory_stocktakes_status_created_idx
  on public.inventory_stocktakes (status, created_at desc);
create unique index inventory_stocktakes_one_open_per_store_key
  on public.inventory_stocktakes (store_id) where status in ('in_progress', 'submitted');

create table public.inventory_stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references public.inventory_stocktakes (id) on delete cascade,
  product_id uuid not null references public.inventory_items (id) on delete restrict,
  unit_id uuid references public.product_units (id) on delete restrict,
  count_method text not null check (count_method in ('unit', 'quantity')),
  expected_quantity integer not null check (expected_quantity >= 0),
  counted_quantity integer check (counted_quantity is null or counted_quantity >= 0),
  reviewed_quantity integer check (reviewed_quantity is null or reviewed_quantity >= 0),
  count_note text,
  review_note text,
  counted_by uuid references public.profiles (id) on delete restrict,
  counted_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  check (
    (count_method = 'unit' and unit_id is not null and expected_quantity = 1)
    or (count_method = 'quantity' and unit_id is null)
  )
);

create unique index inventory_stocktake_lines_unit_key
  on public.inventory_stocktake_lines (stocktake_id, unit_id) where unit_id is not null;
create unique index inventory_stocktake_lines_quantity_key
  on public.inventory_stocktake_lines (stocktake_id, product_id) where unit_id is null;
create index inventory_stocktake_lines_stocktake_idx
  on public.inventory_stocktake_lines (stocktake_id, product_id);

alter table public.inventory_stocktakes enable row level security;
alter table public.inventory_stocktake_lines enable row level security;
revoke all on public.inventory_stocktakes, public.inventory_stocktake_lines from public, anon, authenticated;
grant select on public.inventory_stocktakes, public.inventory_stocktake_lines to authenticated;

create policy "Active employees read inventory stocktakes" on public.inventory_stocktakes
  for select to authenticated using (public.current_employee_role() is not null);
create policy "Active employees read inventory stocktake lines" on public.inventory_stocktake_lines
  for select to authenticated using (public.current_employee_role() is not null);

create function public.create_inventory_stocktake(p_store_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.employee_role;
  store_is_active boolean;
  stocktake_id uuid;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Not allowed to start inventory stocktake' using errcode = '42501';
  end if;
  select active into store_is_active from public.store_locations where id = p_store_id;
  if not found or not store_is_active then
    raise exception 'Active store location not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.inventory_stocktakes
    where store_id = p_store_id and status in ('in_progress', 'submitted')
  ) then
    raise exception 'This store already has an open stocktake' using errcode = '23505';
  end if;

  insert into public.inventory_stocktakes (store_id, created_by)
  values (p_store_id, auth.uid())
  returning id into stocktake_id;

  insert into public.inventory_stocktake_lines (stocktake_id, product_id, unit_id, count_method, expected_quantity)
  select stocktake_id, unit.product_id, unit.id, 'unit', 1
  from public.product_units unit
  join public.inventory_items item on item.id = unit.product_id
  where unit.store_id = p_store_id
    and unit.status = 'in_stock'
    and item.active = true
    and item.category in (
      U&'\76F8\6A5F', U&'\93E1\982D', U&'\651D\5F71\6A5F',
      U&'\62CD\7ACB\5F97', U&'\8A18\61B6\5361', U&'\539F\5EE0\96FB\6C60'
    );

  insert into public.inventory_stocktake_lines (stocktake_id, product_id, unit_id, count_method, expected_quantity)
  select stocktake_id, item.id, null, 'quantity', coalesce(stock.quantity, 0)
  from public.inventory_items item
  left join public.inventory_stocks stock
    on stock.item_id = item.id and stock.store_id = p_store_id
  where item.active = true
    and item.category not in (
      U&'\76F8\6A5F', U&'\93E1\982D', U&'\651D\5F71\6A5F',
      U&'\62CD\7ACB\5F97', U&'\8A18\61B6\5361', U&'\539F\5EE0\96FB\6C60'
    );

  return stocktake_id;
end;
$$;

create function public.set_inventory_stocktake_count(
  p_line_id uuid, p_counted_quantity integer, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.employee_role;
  line_method text;
  session_status text;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Not allowed to count inventory' using errcode = '42501';
  end if;
  if p_counted_quantity is null or p_counted_quantity < 0 or p_counted_quantity > 5000 then
    raise exception 'Count must be between 0 and 5000' using errcode = '22023';
  end if;
  select line.count_method, stocktake.status into line_method, session_status
  from public.inventory_stocktake_lines line
  join public.inventory_stocktakes stocktake on stocktake.id = line.stocktake_id
  where line.id = p_line_id
  for update of line, stocktake;
  if not found then raise exception 'Stocktake line not found' using errcode = 'P0002'; end if;
  if session_status <> 'in_progress' then raise exception 'Stocktake is not in progress' using errcode = '22023'; end if;
  if line_method = 'unit' and p_counted_quantity not in (0, 1) then
    raise exception 'A unit count must be 0 or 1' using errcode = '22023';
  end if;

  update public.inventory_stocktake_lines
  set counted_quantity = p_counted_quantity,
      count_note = nullif(trim(p_note), ''),
      counted_by = auth.uid(),
      counted_at = now()
  where id = p_line_id;
end;
$$;

create function public.submit_inventory_stocktake(p_stocktake_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare employee_role public.employee_role; session_status text;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Not allowed to submit inventory stocktake' using errcode = '42501';
  end if;
  select status into session_status from public.inventory_stocktakes where id = p_stocktake_id for update;
  if not found then raise exception 'Stocktake not found' using errcode = 'P0002'; end if;
  if session_status <> 'in_progress' then raise exception 'Stocktake is not in progress' using errcode = '22023'; end if;
  if exists (select 1 from public.inventory_stocktake_lines where stocktake_id = p_stocktake_id and counted_quantity is null) then
    raise exception 'All stocktake lines must be counted before submission' using errcode = '22023';
  end if;
  update public.inventory_stocktakes set status = 'submitted', submitted_at = now() where id = p_stocktake_id;
end;
$$;

create function public.review_inventory_stocktake_line(
  p_line_id uuid, p_reviewed_quantity integer, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare employee_role public.employee_role; line_method text; session_status text;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager') then
    raise exception 'Only managers can review stocktake differences' using errcode = '42501';
  end if;
  if p_reviewed_quantity is null or p_reviewed_quantity < 0 or p_reviewed_quantity > 5000 then
    raise exception 'Reviewed count must be between 0 and 5000' using errcode = '22023';
  end if;
  select line.count_method, stocktake.status into line_method, session_status
  from public.inventory_stocktake_lines line
  join public.inventory_stocktakes stocktake on stocktake.id = line.stocktake_id
  where line.id = p_line_id
  for update of line, stocktake;
  if not found then raise exception 'Stocktake line not found' using errcode = 'P0002'; end if;
  if session_status <> 'submitted' then raise exception 'Stocktake is not awaiting review' using errcode = '22023'; end if;
  if line_method = 'unit' and p_reviewed_quantity not in (0, 1) then
    raise exception 'A reviewed unit count must be 0 or 1' using errcode = '22023';
  end if;

  update public.inventory_stocktake_lines
  set reviewed_quantity = p_reviewed_quantity,
      review_note = nullif(trim(p_note), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_line_id;
end;
$$;

create function public.finalize_inventory_stocktake(p_stocktake_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.employee_role;
  stocktake public.inventory_stocktakes%rowtype;
  stocktake_line public.inventory_stocktake_lines%rowtype;
  unit_id uuid;
  unit_status text;
  unit_store_id uuid;
  actual_quantity integer;
  target_quantity integer;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager') then
    raise exception 'Only managers can finalize stocktakes' using errcode = '42501';
  end if;
  select * into stocktake from public.inventory_stocktakes where id = p_stocktake_id for update;
  if not found then raise exception 'Stocktake not found' using errcode = 'P0002'; end if;
  if stocktake.status <> 'submitted' then raise exception 'Stocktake is not awaiting review' using errcode = '22023'; end if;
  if exists (select 1 from public.inventory_stocktake_lines where stocktake_id = p_stocktake_id and counted_quantity is null) then
    raise exception 'Stocktake has uncounted lines' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.inventory_stocktake_lines
    where stocktake_id = p_stocktake_id
      and counted_quantity <> expected_quantity
      and reviewed_at is null
  ) then
    raise exception 'All differences must be reviewed before finalization' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.inventory_movements movement
    join public.inventory_stocktake_lines difference_line on difference_line.product_id = movement.item_id
    where difference_line.stocktake_id = p_stocktake_id
      and movement.created_at > stocktake.created_at
      and movement.action in ('created', 'received', 'sale', 'transfer', 'disabled')
      and (movement.from_store_id = stocktake.store_id or movement.to_store_id = stocktake.store_id)
  ) or exists (
    select 1
    from public.product_units unit
    join public.inventory_items item on item.id = unit.product_id
    where unit.store_id = stocktake.store_id
      and unit.status = 'in_stock'
      and item.active = true
      and unit.created_at > stocktake.created_at
  ) then
    raise exception 'Inventory changed during this stocktake; recount before finalization' using errcode = '22023';
  end if;

  for stocktake_line in select * from public.inventory_stocktake_lines where stocktake_id = p_stocktake_id order by product_id, unit_id
  loop
    target_quantity := coalesce(stocktake_line.reviewed_quantity, stocktake_line.counted_quantity);
    if stocktake_line.count_method = 'unit' then
      select status, store_id into unit_status, unit_store_id
      from public.product_units where id = stocktake_line.unit_id and product_id = stocktake_line.product_id for update;
      if not found or unit_status <> 'in_stock' or unit_store_id <> stocktake.store_id then
        raise exception 'Unit changed location or status during stocktake; refresh and review again' using errcode = '22023';
      end if;
      if target_quantity = 0 then
        update public.product_units set status = 'disabled' where id = stocktake_line.unit_id;
        insert into public.inventory_movements (item_id, unit_id, action, quantity, from_store_id, actor_id, note)
        values (stocktake_line.product_id, stocktake_line.unit_id, 'disabled', 1, stocktake.store_id, auth.uid(), 'Stocktake ' || p_stocktake_id::text || ': missing unit');
      end if;
    else
      perform 1 from public.inventory_items where id = stocktake_line.product_id and active for update;
      if not found then raise exception 'Product is inactive or missing; refresh stocktake before finalization' using errcode = '22023'; end if;
      select count(*)::integer into actual_quantity
      from public.product_units where product_id = stocktake_line.product_id and store_id = stocktake.store_id and status = 'in_stock';
      if target_quantity < actual_quantity then
        for unit_id in
          select id from public.product_units
          where product_id = stocktake_line.product_id and store_id = stocktake.store_id and status = 'in_stock'
          order by unit_code desc limit actual_quantity - target_quantity for update
        loop
          update public.product_units set status = 'disabled' where id = unit_id;
          insert into public.inventory_movements (item_id, unit_id, action, quantity, from_store_id, actor_id, note)
          values (stocktake_line.product_id, unit_id, 'disabled', 1, stocktake.store_id, auth.uid(), 'Stocktake ' || p_stocktake_id::text || ': quantity adjustment');
        end loop;
      elsif target_quantity > actual_quantity then
        perform public.receive_existing_product_units(stocktake_line.product_id, stocktake.store_id, target_quantity - actual_quantity);
      end if;
    end if;
  end loop;

  update public.inventory_stocktakes
  set status = 'completed', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_stocktake_id;
end;
$$;

revoke all on function public.create_inventory_stocktake(uuid) from public, anon;
revoke all on function public.set_inventory_stocktake_count(uuid, integer, text) from public, anon;
revoke all on function public.submit_inventory_stocktake(uuid) from public, anon;
revoke all on function public.review_inventory_stocktake_line(uuid, integer, text) from public, anon;
revoke all on function public.finalize_inventory_stocktake(uuid) from public, anon;
grant execute on function public.create_inventory_stocktake(uuid) to authenticated;
grant execute on function public.set_inventory_stocktake_count(uuid, integer, text) to authenticated;
grant execute on function public.submit_inventory_stocktake(uuid) to authenticated;
grant execute on function public.review_inventory_stocktake_line(uuid, integer, text) to authenticated;
grant execute on function public.finalize_inventory_stocktake(uuid) to authenticated;

commit;