begin;

alter table public.inventory_items add column if not exists brand text;

create function public.create_inventory_item_with_brand(
  p_name text,
  p_barcode text,
  p_serial_number text,
  p_category text,
  p_reorder_threshold integer,
  p_initial_quantity integer,
  p_store_id uuid,
  p_model text default null,
  p_brand text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created_product jsonb;
  product_id uuid;
begin
  created_product := public.create_inventory_item_with_model(
    p_name, p_barcode, p_serial_number, p_category, p_reorder_threshold,
    p_initial_quantity, p_store_id, p_model
  );
  product_id := (created_product->>'item_id')::uuid;
  update public.inventory_items
  set brand = nullif(trim(p_brand), '')
  where id = product_id;
  return created_product;
end;
$$;

create function public.update_inventory_item_details_with_brand(
  p_item_id uuid,
  p_name text,
  p_barcode text,
  p_serial_number text,
  p_category text,
  p_reorder_threshold integer,
  p_model text default null,
  p_brand text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.update_inventory_item_details_with_model(
    p_item_id, p_name, p_barcode, p_serial_number, p_category,
    p_reorder_threshold, p_model
  );
  update public.inventory_items
  set brand = nullif(trim(p_brand), '')
  where id = p_item_id;
end;
$$;

revoke all on function public.create_inventory_item_with_brand(text, text, text, text, integer, integer, uuid, text, text) from public, anon;
revoke all on function public.update_inventory_item_details_with_brand(uuid, text, text, text, text, integer, text, text) from public, anon;
grant execute on function public.create_inventory_item_with_brand(text, text, text, text, integer, integer, uuid, text, text) to authenticated;
grant execute on function public.update_inventory_item_details_with_brand(uuid, text, text, text, text, integer, text, text) to authenticated;

commit;