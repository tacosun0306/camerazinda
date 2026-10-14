create function public.search_inventory_label_items(
  p_search text default null,
  p_category text default null,
  p_offset integer default 0,
  p_page_size integer default 50
)
returns table (
  id uuid,
  name text,
  model text,
  sku text,
  category text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with matching_items as (
    select item.id, item.name, item.model, item.sku, item.category
    from public.inventory_items as item
    where item.active = true
      and public.current_employee_role() is not null
      and (p_category is null or item.category = p_category)
      and (
        nullif(trim(p_search), '') is null
        or concat_ws(' ', item.name, item.model, item.sku, item.category, item.serial_number, item.barcode)
          ilike '%' || trim(p_search) || '%'
      )
  )
  select matching_items.id,
         matching_items.name,
         matching_items.model,
         matching_items.sku,
         matching_items.category,
         count(*) over () as total_count
  from matching_items
  order by matching_items.name, matching_items.sku
  limit least(greatest(coalesce(p_page_size, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_inventory_label_items(text, text, integer, integer) from public, anon;
grant execute on function public.search_inventory_label_items(text, text, integer, integer) to authenticated;