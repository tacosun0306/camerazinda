begin;

alter table public.profiles add column account_status text;

update public.profiles as profile
set account_status = case
  when exists (
    select 1 from auth.users as auth_user
    where auth_user.id = profile.id
      and auth_user.invited_at is not null
      and auth_user.email_confirmed_at is null
  ) then 'pending_password_setup'
  when profile.active = false then 'disabled'
  else 'active'
end;

update public.profiles
set active = false
where account_status = 'pending_password_setup';

alter table public.profiles
  alter column account_status set default 'active',
  alter column account_status set not null,
  add constraint profiles_account_status_check
    check (account_status in ('pending_password_setup', 'active', 'password_reset_pending', 'disabled')),
  add constraint profiles_active_matches_account_status_check
    check (active = (account_status = 'active'));

create index profiles_account_status_idx on public.profiles (account_status);

create or replace function public.protect_last_active_admin()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  active_admin_count integer;
begin
  if old.role = 'admin' and old.active = true and old.account_status = 'active'
    and not (new.role = 'admin' and new.active = true and new.account_status = 'active') then
    perform pg_advisory_xact_lock(hashtext('camera-store-last-active-admin'));
    select count(*) into active_admin_count
    from public.profiles
    where role = 'admin' and active = true and account_status = 'active';
    if active_admin_count <= 1 then
      raise exception 'Cannot disable or demote the last active administrator' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_last_active_admin() from public, anon, authenticated;
drop trigger if exists protect_last_active_admin on public.profiles;
create trigger protect_last_active_admin
  before update of role, active, account_status on public.profiles
  for each row execute function public.protect_last_active_admin();

create table public.employee_password_setup_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  email text not null,
  flow text not null check (flow in ('invite', 'recovery')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index employee_password_setup_challenges_expiry_idx
  on public.employee_password_setup_challenges (expires_at)
  where consumed_at is null;
create unique index employee_password_setup_challenges_one_pending_idx
  on public.employee_password_setup_challenges (user_id, flow)
  where consumed_at is null;

create table public.employee_auth_email_requests (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  target_email text not null,
  flow text not null check (flow in ('invite', 'recovery')),
  created_at timestamptz not null default now()
);
create index employee_auth_email_requests_target_idx
  on public.employee_auth_email_requests (target_email, created_at desc);
create index employee_auth_email_requests_actor_idx
  on public.employee_auth_email_requests (actor_id, created_at desc);

alter table public.employee_password_setup_challenges enable row level security;
alter table public.employee_auth_email_requests enable row level security;
revoke all on public.employee_password_setup_challenges, public.employee_auth_email_requests from public, anon, authenticated;
grant all on public.employee_password_setup_challenges, public.employee_auth_email_requests to service_role;

create or replace function public.current_employee_role()
returns public.employee_role
language sql stable security definer set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and active = true
    and account_status = 'active'
$$;

create or replace function public.reject_uninvited_auth_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.invited_at is null then
    raise exception 'Self-registration is disabled; ask an administrator for an invitation'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_uninvited_auth_user() from public, anon, authenticated;
drop trigger if exists require_admin_invitation on auth.users;
create trigger require_admin_invitation
  before insert on auth.users
  for each row execute function public.reject_uninvited_auth_user();

create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (id, email, full_name, role, store_name, active, account_status)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    case requested_role
      when 'admin' then 'admin'::public.employee_role
      when 'manager' then 'manager'::public.employee_role
      when 'sales' then 'sales'::public.employee_role
      when 'technician' then 'technician'::public.employee_role
      else 'sales'::public.employee_role
    end,
    coalesce(nullif(new.raw_user_meta_data ->> 'store_name', ''), (select name from public.store_locations where active order by created_at limit 1)),
    false,
    'pending_password_setup'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

revoke all on function public.sync_auth_user_profile() from public, anon, authenticated;

create or replace function public.revoke_employee_auth_sessions()
returns trigger
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
begin
  if new.active = false or new.account_status <> 'active' then
    delete from auth.sessions where user_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.revoke_employee_auth_sessions() from public, anon, authenticated;
drop trigger if exists revoke_sessions_for_inactive_employee on public.profiles;
create trigger revoke_sessions_for_inactive_employee
  after update of active, account_status on public.profiles
  for each row
  when (old.active is distinct from new.active or old.account_status is distinct from new.account_status)
  execute function public.revoke_employee_auth_sessions();

delete from auth.sessions as session
where exists (
  select 1 from public.profiles profile
  where profile.id = session.user_id
    and (profile.active = false or profile.account_status <> 'active')
);

drop policy if exists "Employees can read active profiles" on public.profiles;
drop policy if exists "Admins manage profiles" on public.profiles;
create policy "Active employees read profiles" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or (
      public.current_employee_role() is not null
      and (public.current_employee_role() = 'admin' or active = true)
    )
  );
revoke insert, update, delete on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert on public.audit_logs to service_role;

drop policy if exists "Employees read inventory" on public.inventory_items;
create policy "Active employees read inventory" on public.inventory_items for select to authenticated
  using (public.current_employee_role() is not null);

drop policy if exists "Employees read repair jobs" on public.repair_jobs;
create policy "Active employees read repair jobs" on public.repair_jobs for select to authenticated
  using (public.current_employee_role() is not null);
drop policy if exists "Employees create repair jobs" on public.repair_jobs;
create policy "Active employees create repair jobs" on public.repair_jobs for insert to authenticated
  with check (public.current_employee_role() is not null and created_by = auth.uid());

drop policy if exists "Employees read shifts" on public.shifts;
create policy "Active employees read shifts" on public.shifts for select to authenticated
  using (public.current_employee_role() is not null);

drop policy if exists "Employees read own shift change requests" on public.shift_change_requests;
create policy "Active employees read shift change requests" on public.shift_change_requests for select to authenticated
  using (
    public.current_employee_role() is not null
    and (employee_id = auth.uid() or public.current_employee_role() in ('admin', 'manager'))
  );
drop policy if exists "Employees request changes to own shifts" on public.shift_change_requests;
create policy "Active employees request changes to own shifts" on public.shift_change_requests for insert to authenticated
  with check (
    public.current_employee_role() is not null
    and employee_id = auth.uid()
    and exists (select 1 from public.shifts where id = shift_id and employee_id = auth.uid())
  );

drop policy if exists "Employees read attendance" on public.attendance_records;
create policy "Active employees read attendance" on public.attendance_records for select to authenticated
  using (
    public.current_employee_role() is not null
    and (employee_id = auth.uid() or public.current_employee_role() in ('admin', 'manager'))
  );
drop policy if exists "Employees clock themselves" on public.attendance_records;
create policy "Active employees clock themselves" on public.attendance_records for insert to authenticated
  with check (public.current_employee_role() is not null and employee_id = auth.uid());
drop policy if exists "Employees update own attendance" on public.attendance_records;
create policy "Active employees update attendance" on public.attendance_records for update to authenticated
  using (
    public.current_employee_role() is not null
    and (employee_id = auth.uid() or public.current_employee_role() in ('admin', 'manager'))
  )
  with check (
    public.current_employee_role() is not null
    and (employee_id = auth.uid() or public.current_employee_role() in ('admin', 'manager'))
  );

create or replace function public.create_employee_password_setup_challenge(
  p_flow text,
  p_token_hash text
)
returns boolean
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  expected_status text;
  account_email text;
  session_id uuid;
begin
  expected_status := case p_flow
    when 'invite' then 'pending_password_setup'
    when 'recovery' then 'password_reset_pending'
    else null
  end;
  if auth.uid() is null or expected_status is null then return false; end if;
  session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if session_id is null or not exists (
    select 1 from auth.sessions
    where id = session_id and user_id = auth.uid()
  ) then return false; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':employee-password-challenge'));
  delete from public.employee_password_setup_challenges
  where created_at < now() - interval '30 days';
  if (
    select count(*) from public.employee_password_setup_challenges
    where user_id = auth.uid() and created_at > now() - interval '15 minutes'
  ) >= 5 then return false; end if;

  select email into account_email from public.profiles
  where id = auth.uid() and active = false and account_status = expected_status;
  if account_email is null then return false; end if;

  update public.employee_password_setup_challenges
  set consumed_at = now()
  where user_id = auth.uid() and flow = p_flow and consumed_at is null;
  insert into public.employee_password_setup_challenges (user_id, email, flow, token_hash, expires_at)
  values (auth.uid(), account_email, p_flow, p_token_hash, now() + interval '15 minutes');
  return true;
end;
$$;

revoke all on function public.create_employee_password_setup_challenge(text, text) from public, anon;
grant execute on function public.create_employee_password_setup_challenge(text, text) to authenticated;

create or replace function public.consume_employee_password_setup_challenge(p_token_hash text)
returns text
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  consumed_flow text;
  session_id uuid;
begin
  if auth.uid() is null then return null; end if;
  session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if session_id is null or not exists (
    select 1 from auth.sessions
    where id = session_id and user_id = auth.uid()
  ) then return null; end if;

  update public.employee_password_setup_challenges as challenge
  set consumed_at = now()
  where challenge.user_id = auth.uid()
    and challenge.token_hash = p_token_hash
    and challenge.expires_at > now()
    and challenge.consumed_at is null
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.account_status = case challenge.flow
          when 'invite' then 'pending_password_setup'
          when 'recovery' then 'password_reset_pending'
        end
        and profile.active = false
    )
  returning challenge.flow into consumed_flow;
  return consumed_flow;
end;
$$;

revoke all on function public.consume_employee_password_setup_challenge(text) from public, anon;
grant execute on function public.consume_employee_password_setup_challenge(text) to authenticated;

create or replace function public.reserve_employee_auth_email_request(
  p_actor_id uuid,
  p_target_email text,
  p_flow text
)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  email_key text := lower(trim(p_target_email));
  target_requests integer;
  actor_requests integer;
begin
  if p_flow not in ('invite', 'recovery') or email_key = '' then return false; end if;
  perform pg_advisory_xact_lock(hashtext(email_key));
  delete from public.employee_auth_email_requests
  where created_at < now() - interval '30 days';

  select count(*) into target_requests
  from public.employee_auth_email_requests
  where target_email = email_key and created_at > now() - interval '15 minutes';
  select count(*) into actor_requests
  from public.employee_auth_email_requests
  where actor_id = p_actor_id and created_at > now() - interval '1 hour';
  if target_requests >= 3 or actor_requests >= 10 then return false; end if;

  insert into public.employee_auth_email_requests (actor_id, target_email, flow)
  values (p_actor_id, email_key, p_flow);
  return true;
end;
$$;

revoke all on function public.reserve_employee_auth_email_request(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_employee_auth_email_request(uuid, text, text) to service_role;

commit;