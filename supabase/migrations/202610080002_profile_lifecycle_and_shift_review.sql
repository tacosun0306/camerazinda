alter table public.profiles add column email text;

update public.profiles as profile
set email = auth_user.email
from auth.users as auth_user
where auth_user.id = profile.id and profile.email is null;

alter table public.profiles alter column email set not null;
alter table public.profiles add constraint profiles_email_key unique (email);

create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited boolean := new.invited_at is not null;
begin
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    case
      when invited and not exists (select 1 from public.profiles) then 'admin'::public.employee_role
      else 'sales'::public.employee_role
    end,
    invited
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.sync_auth_user_profile();

create or replace function public.review_shift_change_request(p_request_id uuid, p_approved boolean)
returns void
language plpgsql
set search_path = public
as $$
declare
  request_row public.shift_change_requests%rowtype;
begin
  if public.current_employee_role() not in ('admin', 'manager') then
    raise exception 'Only managers can review shift change requests';
  end if;

  select * into strict request_row
  from public.shift_change_requests
  where id = p_request_id and status = 'pending'
  for update;

  if p_approved then
    update public.shifts
    set starts_at = request_row.requested_starts_at,
        ends_at = request_row.requested_ends_at,
        status = 'confirmed'
    where id = request_row.shift_id;
  end if;

  update public.shift_change_requests
  set status = case when p_approved then 'approved'::public.shift_change_status else 'rejected'::public.shift_change_status end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_request_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    case when p_approved then 'shift_change_approved' else 'shift_change_rejected' end,
    'shift_change_request',
    p_request_id::text,
    jsonb_build_object('shift_id', request_row.shift_id, 'employee_id', request_row.employee_id)
  );
end;
$$;

revoke all on function public.sync_auth_user_profile() from public;
revoke all on function public.review_shift_change_request(uuid, boolean) from public;
grant execute on function public.review_shift_change_request(uuid, boolean) to authenticated;
