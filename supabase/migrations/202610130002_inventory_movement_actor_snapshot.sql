alter table public.inventory_movements
  add column actor_name text,
  add column actor_role public.employee_role;

update public.inventory_movements as movement
set actor_name = profile.full_name,
    actor_role = profile.role
from public.profiles as profile
where profile.id = movement.actor_id;

alter table public.inventory_movements
  alter column actor_name set not null,
  alter column actor_role set not null;

create function public.snapshot_inventory_movement_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select profile.full_name, profile.role
  into new.actor_name, new.actor_role
  from public.profiles as profile
  where profile.id = new.actor_id and profile.active = true;

  if not found then
    raise exception 'Active employee profile required for inventory movements' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger snapshot_inventory_movement_actor_before_insert
before insert on public.inventory_movements
for each row execute function public.snapshot_inventory_movement_actor();

revoke all on function public.snapshot_inventory_movement_actor() from public, anon, authenticated;