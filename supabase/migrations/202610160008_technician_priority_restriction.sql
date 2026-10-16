begin;

create or replace function public.prevent_technician_repair_priority_updates()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if public.current_employee_role() = 'technician' then
    raise exception 'Technicians cannot edit repair priority or assignment' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_technician_repair_priority_updates() from public, anon, authenticated;
drop trigger if exists prevent_technician_repair_priority_updates on public.repair_jobs;
create trigger prevent_technician_repair_priority_updates
  before update of priority, priority_reason, priority_due_at, priority_assigned_to, priority_created_by, priority_created_at
  on public.repair_jobs
  for each row execute function public.prevent_technician_repair_priority_updates();

commit;