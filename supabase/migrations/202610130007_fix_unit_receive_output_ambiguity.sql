begin;

create or replace function public.receive_inventory_units(
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

revoke all on function public.receive_inventory_units(uuid, uuid, integer, text[]) from public, anon;
grant execute on function public.receive_inventory_units(uuid, uuid, integer, text[]) to authenticated;

commit;