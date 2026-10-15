begin;

create or replace function public.create_inventory_stocktake(p_store_id uuid)
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

commit;