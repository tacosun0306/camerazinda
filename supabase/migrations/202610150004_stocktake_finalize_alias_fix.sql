begin;

create or replace function public.finalize_inventory_stocktake(p_stocktake_id uuid)
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

  for stocktake_line in
    select * from public.inventory_stocktake_lines
    where stocktake_id = p_stocktake_id
    order by product_id, unit_id
  loop
    target_quantity := coalesce(stocktake_line.reviewed_quantity, stocktake_line.counted_quantity);
    if stocktake_line.count_method = 'unit' then
      select status, store_id into unit_status, unit_store_id
      from public.product_units
      where id = stocktake_line.unit_id and product_id = stocktake_line.product_id
      for update;
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
      from public.product_units
      where product_id = stocktake_line.product_id and store_id = stocktake.store_id and status = 'in_stock';
      if target_quantity < actual_quantity then
        for unit_id in
          select id from public.product_units
          where product_id = stocktake_line.product_id and store_id = stocktake.store_id and status = 'in_stock'
          order by unit_code desc
          limit actual_quantity - target_quantity
          for update
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

revoke all on function public.finalize_inventory_stocktake(uuid) from public, anon;
grant execute on function public.finalize_inventory_stocktake(uuid) to authenticated;

commit;