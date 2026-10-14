alter table public.inventory_items
  add column model text,
  add column active boolean not null default true;

revoke update (model, active) on public.inventory_items from public, anon, authenticated;

create function public.create_inventory_item_with_model(
  p_name text,
  p_barcode text,
  p_serial_number text,
  p_category text,
  p_reorder_threshold integer,
  p_initial_quantity integer,
  p_store_id uuid,
  p_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created_product jsonb;
begin
  created_product := public.create_inventory_item(
    p_name,
    p_barcode,
    p_serial_number,
    p_category,
    p_reorder_threshold,
    p_initial_quantity,
    p_store_id
  );
  update public.inventory_items
  set model = nullif(trim(p_model), '')
  where id = (created_product->>'item_id')::uuid;
  return created_product;
end;
$$;

create function public.update_inventory_item_details_with_model(
  p_item_id uuid,
  p_name text,
  p_barcode text,
  p_serial_number text,
  p_category text,
  p_reorder_threshold integer,
  p_model text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.update_inventory_item_details(
    p_item_id,
    p_name,
    p_barcode,
    p_serial_number,
    p_category,
    p_reorder_threshold
  );
  update public.inventory_items
  set model = nullif(trim(p_model), '')
  where id = p_item_id;
end;
$$;

revoke all on function public.create_inventory_item_with_model(text, text, text, text, integer, integer, uuid, text) from public, anon;
revoke all on function public.update_inventory_item_details_with_model(uuid, text, text, text, text, integer, text) from public, anon;
grant execute on function public.create_inventory_item_with_model(text, text, text, text, integer, integer, uuid, text) to authenticated;
grant execute on function public.update_inventory_item_details_with_model(uuid, text, text, text, text, integer, text) to authenticated;

create function public.inventory_label_categories()
returns table(category text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct item.category
  from public.inventory_items as item
  where item.active = true
  order by item.category;
$$;

revoke all on function public.inventory_label_categories() from public, anon;
grant execute on function public.inventory_label_categories() to authenticated;