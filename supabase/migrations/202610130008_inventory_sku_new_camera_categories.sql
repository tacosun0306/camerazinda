begin;

create or replace function public.create_inventory_item(
  p_name text,
  p_barcode text,
  p_serial_number text,
  p_category text,
  p_reorder_threshold integer,
  p_initial_quantity integer,
  p_store_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.employee_role;
  item_id uuid;
  store_exists boolean;
  sku_prefix text;
  sku_sequence regclass;
  sku_number bigint;
  generated_sku text;
begin
  employee_role := public.current_employee_role();
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Not allowed to create inventory items' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_category), '') is null then
    raise exception 'Name and category are required' using errcode = '22023';
  end if;
  if p_reorder_threshold is null or p_initial_quantity is null or p_reorder_threshold < 0 or p_initial_quantity < 0 then
    raise exception 'Quantities cannot be negative' using errcode = '22023';
  end if;
  select exists (select 1 from public.store_locations where id = p_store_id and active) into store_exists;
  if not store_exists then
    raise exception 'Active store location not found' using errcode = '22023';
  end if;

  if lower(trim(p_category)) in (
    U&'\76F8\6A5F', U&'\651D\5F71\6A5F', U&'\62CD\7ACB\5F97',
    'camera', 'cameras', 'camcorder', 'instant camera'
  ) then
    sku_prefix := 'CAM';
    sku_sequence := 'public.inventory_sku_cam_seq'::regclass;
  elsif lower(trim(p_category)) in (U&'\93E1\982D', 'lens', 'lenses') then
    sku_prefix := 'LEN';
    sku_sequence := 'public.inventory_sku_len_seq'::regclass;
  else
    sku_prefix := 'ACC';
    sku_sequence := 'public.inventory_sku_acc_seq'::regclass;
  end if;

  sku_number := nextval(sku_sequence);
  generated_sku := sku_prefix || '-' || lpad(sku_number::text, greatest(6, length(sku_number::text)), '0');

  insert into public.inventory_items (name, sku, barcode, serial_number, category, quantity, reorder_threshold)
  values (trim(p_name), generated_sku, nullif(trim(p_barcode), ''), nullif(trim(p_serial_number), ''), trim(p_category), 0, p_reorder_threshold)
  returning id into item_id;
  insert into public.inventory_stocks (item_id, store_id, quantity)
  values (item_id, p_store_id, p_initial_quantity);
  insert into public.inventory_movements (item_id, action, quantity, to_store_id, actor_id, note)
  values (item_id, 'created', nullif(p_initial_quantity, 0), p_store_id, auth.uid(), 'Product created');

  return jsonb_build_object('item_id', item_id, 'sku', generated_sku);
end;
$$;

revoke all on function public.create_inventory_item(text, text, text, text, integer, integer, uuid) from public, anon;
grant execute on function public.create_inventory_item(text, text, text, text, integer, integer, uuid) to authenticated;

commit;