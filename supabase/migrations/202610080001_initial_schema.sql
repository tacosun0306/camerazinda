create type public.employee_role as enum ('admin', 'manager', 'sales', 'technician');
create type public.repair_status as enum (
  'store_created',
  'store_shipped',
  'repair_received',
  'diagnosing',
  'quoting',
  'repairing',
  'returned_to_store',
  'store_received',
  'customer_notified',
  'picked_up'
);
create type public.shift_change_status as enum ('pending', 'approved', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.employee_role not null default 'sales',
  store_name text not null default '台北旗艦店',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category text not null,
  quantity integer not null default 0 check (quantity >= 0),
  reorder_threshold integer not null default 1 check (reorder_threshold >= 0),
  serial_number text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.repair_jobs (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  customer_name text not null,
  customer_phone text not null,
  item_name text not null,
  issue text not null,
  status public.repair_status not null default 'store_created',
  due_at date,
  assigned_to uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.shift_change_requests (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  employee_id uuid not null references public.profiles (id),
  requested_starts_at timestamptz not null,
  requested_ends_at timestamptz not null,
  reason text not null,
  status public.shift_change_status not null default 'pending',
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check (requested_ends_at > requested_starts_at)
);

create unique index one_pending_change_per_shift_employee
  on public.shift_change_requests (shift_id, employee_id)
  where status = 'pending';

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id),
  shift_id uuid references public.shifts (id),
  clocked_in_at timestamptz not null default now(),
  clocked_out_at timestamptz,
  note text,
  check (clocked_out_at is null or clocked_out_at >= clocked_in_at)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function public.current_employee_role()
returns public.employee_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;

alter table public.profiles enable row level security;
alter table public.inventory_items enable row level security;
alter table public.repair_jobs enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_change_requests enable row level security;
alter table public.attendance_records enable row level security;
alter table public.audit_logs enable row level security;

create policy "Employees can read active profiles" on public.profiles for select to authenticated
  using (active = true or id = auth.uid());
create policy "Admins manage profiles" on public.profiles for all to authenticated
  using (public.current_employee_role() = 'admin') with check (public.current_employee_role() = 'admin');

create policy "Employees read inventory" on public.inventory_items for select to authenticated using (true);
create policy "Managers and sales manage inventory" on public.inventory_items for insert to authenticated
  with check (public.current_employee_role() in ('admin', 'manager', 'sales'));
create policy "Managers and sales update inventory" on public.inventory_items for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager', 'sales'))
  with check (public.current_employee_role() in ('admin', 'manager', 'sales'));
create policy "Admins delete inventory" on public.inventory_items for delete to authenticated
  using (public.current_employee_role() = 'admin');

create policy "Employees read repair jobs" on public.repair_jobs for select to authenticated using (true);
create policy "Employees create repair jobs" on public.repair_jobs for insert to authenticated with check (created_by = auth.uid());
create policy "Managers and technicians update repair jobs" on public.repair_jobs for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager', 'technician'))
  with check (public.current_employee_role() in ('admin', 'manager', 'technician'));

create policy "Employees read shifts" on public.shifts for select to authenticated using (true);
create policy "Managers manage shifts" on public.shifts for all to authenticated
  using (public.current_employee_role() in ('admin', 'manager'))
  with check (public.current_employee_role() in ('admin', 'manager'));
create policy "Employees read own shift change requests" on public.shift_change_requests for select to authenticated
  using (employee_id = auth.uid() or public.current_employee_role() in ('admin', 'manager'));
create policy "Employees request changes to own shifts" on public.shift_change_requests for insert to authenticated
  with check (
    employee_id = auth.uid()
    and exists (select 1 from public.shifts where id = shift_id and employee_id = auth.uid())
  );
create policy "Managers review shift change requests" on public.shift_change_requests for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager'))
  with check (public.current_employee_role() in ('admin', 'manager'));
create policy "Employees read attendance" on public.attendance_records for select to authenticated
  using (employee_id = auth.uid() or public.current_employee_role() in ('admin', 'manager'));
create policy "Employees clock themselves" on public.attendance_records for insert to authenticated
  with check (employee_id = auth.uid());
create policy "Employees update own attendance" on public.attendance_records for update to authenticated
  using (employee_id = auth.uid() or public.current_employee_role() in ('admin', 'manager'))
  with check (employee_id = auth.uid() or public.current_employee_role() in ('admin', 'manager'));

create policy "Admins read audit logs" on public.audit_logs for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.inventory_items to authenticated;
grant select, insert, update on public.repair_jobs to authenticated;
grant select, insert, update, delete on public.shifts to authenticated;
grant select, insert, update on public.shift_change_requests to authenticated;
grant select, insert, update on public.attendance_records to authenticated;
grant select on public.audit_logs to authenticated;

revoke all on function public.current_employee_role() from public;
grant execute on function public.current_employee_role() to authenticated;