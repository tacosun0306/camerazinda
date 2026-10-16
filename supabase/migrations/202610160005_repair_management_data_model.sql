begin;

alter table public.repair_jobs
  add column if not exists brand text,
  add column if not exists model text,
  add column if not exists serial_number text,
  add column if not exists store_name text,
  add column if not exists accessories text,
  add column if not exists appearance_condition text,
  add column if not exists priority text not null default 'normal',
  add column if not exists priority_reason text,
  add column if not exists priority_due_at timestamptz,
  add column if not exists priority_assigned_to uuid references public.profiles (id),
  add column if not exists priority_created_by uuid references public.profiles (id),
  add column if not exists priority_created_at timestamptz,
  add column if not exists inspection_person_id uuid references public.profiles (id),
  add column if not exists inspection_at timestamptz,
  add column if not exists fault_cause text,
  add column if not exists inspection_result text,
  add column if not exists recommended_repair text,
  add column if not exists inspection_notes text,
  add column if not exists actual_repair_items text,
  add column if not exists replacement_parts text,
  add column if not exists repair_result text,
  add column if not exists repaired_at timestamptz,
  add column if not exists repaired_by uuid references public.profiles (id),
  add column if not exists store_shipped_at timestamptz,
  add column if not exists store_tracking_number text,
  add column if not exists repair_received_at timestamptz,
  add column if not exists repair_shipped_back_at timestamptz,
  add column if not exists return_tracking_number text,
  add column if not exists store_received_at timestamptz,
  add column if not exists customer_notified_at timestamptz,
  add column if not exists notification_method text,
  add column if not exists notification_result text,
  add column if not exists picked_up_at timestamptz,
  add column if not exists quote_version integer not null default 0,
  add column if not exists customer_confirmation_status text not null default 'pending',
  add column if not exists updated_by uuid references public.profiles (id);

update public.repair_jobs as job
set store_name = coalesce(profile.store_name, '台南晶大門市')
from public.profiles as profile
where profile.id = job.created_by and job.store_name is null;

update public.repair_jobs set store_name = '台南晶大門市' where store_name is null;
alter table public.repair_jobs alter column store_name set default '台南晶大門市';
alter table public.repair_jobs alter column store_name set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'repair_jobs_priority_check') then
    alter table public.repair_jobs add constraint repair_jobs_priority_check check (priority in ('normal', 'priority', 'urgent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'repair_jobs_customer_confirmation_check') then
    alter table public.repair_jobs add constraint repair_jobs_customer_confirmation_check
      check (customer_confirmation_status in ('pending', 'approved', 'declined', 'cancelled'));
  end if;
end;
$$;

create index if not exists repair_jobs_priority_due_idx on public.repair_jobs (priority, priority_due_at);
create index if not exists repair_jobs_assignee_status_idx on public.repair_jobs (assigned_to, status);

create table if not exists public.repair_quotes (
  id uuid primary key default gen_random_uuid(),
  repair_job_id uuid not null references public.repair_jobs (id) on delete cascade,
  request_key uuid not null default gen_random_uuid(),
  version integer not null check (version > 0),
  quote_status text not null check (quote_status in ('submitted', 'superseded')),
  customer_decision text not null default 'pending' check (customer_decision in ('pending', 'approved', 'declined', 'cancelled')),
  total_amount numeric(12, 2) not null default 0 check (total_amount >= 0),
  estimated_days integer check (estimated_days is null or estimated_days >= 0),
  notes text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  responded_by uuid references public.profiles (id),
  responded_at timestamptz,
  response_note text,
  unique (repair_job_id, version)
);
alter table public.repair_quotes add column if not exists request_key uuid;
update public.repair_quotes set request_key = gen_random_uuid() where request_key is null;
alter table public.repair_quotes alter column request_key set default gen_random_uuid();
alter table public.repair_quotes alter column request_key set not null;
create unique index if not exists repair_quotes_request_key_idx on public.repair_quotes (request_key);

create table if not exists public.repair_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.repair_quotes (id) on delete cascade,
  line_number integer not null check (line_number > 0),
  item_name text not null,
  quantity numeric(10, 2) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  subtotal numeric(14, 2) generated always as (quantity * unit_price) stored,
  notes text,
  unique (quote_id, line_number)
);

create table if not exists public.repair_job_events (
  id uuid primary key default gen_random_uuid(),
  repair_job_id uuid not null references public.repair_jobs (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  event_type text not null,
  summary text not null,
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists repair_job_events_timeline_idx on public.repair_job_events (repair_job_id, created_at desc);

create table if not exists public.repair_notifications (
  id uuid primary key default gen_random_uuid(),
  repair_job_id uuid not null references public.repair_jobs (id) on delete cascade,
  quote_id uuid references public.repair_quotes (id) on delete cascade,
  notification_type text not null,
  recipient_id uuid references public.profiles (id),
  recipient_role text,
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists repair_notifications_open_idx on public.repair_notifications (recipient_id, status, created_at desc);

alter table public.repair_quotes enable row level security;
alter table public.repair_quote_items enable row level security;
alter table public.repair_job_events enable row level security;
alter table public.repair_notifications enable row level security;

revoke all on public.repair_quotes, public.repair_quote_items, public.repair_job_events, public.repair_notifications from public, anon, authenticated;
grant select on public.repair_quotes, public.repair_quote_items, public.repair_job_events, public.repair_notifications to authenticated;
revoke insert, update on public.repair_jobs from public, anon, authenticated;

drop policy if exists "Active employees read repair quotes" on public.repair_quotes;
create policy "Active employees read repair quotes" on public.repair_quotes for select to authenticated
  using (public.current_employee_role() is not null);
drop policy if exists "Active employees read repair quote items" on public.repair_quote_items;
create policy "Active employees read repair quote items" on public.repair_quote_items for select to authenticated
  using (exists (select 1 from public.repair_quotes quote where quote.id = quote_id and public.current_employee_role() is not null));
drop policy if exists "Active employees read repair history" on public.repair_job_events;
create policy "Active employees read repair history" on public.repair_job_events for select to authenticated
  using (public.current_employee_role() is not null);
drop policy if exists "Employees read assigned repair notifications" on public.repair_notifications;
create policy "Employees read assigned repair notifications" on public.repair_notifications for select to authenticated
  using (
    public.current_employee_role() is not null
    and (recipient_id = auth.uid() or recipient_role = public.current_employee_role()::text or public.current_employee_role() in ('admin', 'manager'))
  );

create or replace function public.create_repair_job(p_changes jsonb)
returns uuid
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  employee_role public.employee_role := public.current_employee_role();
  created_job public.repair_jobs%rowtype;
begin
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Employee role cannot create repair jobs' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'object'
    or nullif(trim(p_changes->>'case_number'), '') is null
    or nullif(trim(p_changes->>'customer_name'), '') is null
    or nullif(trim(p_changes->>'customer_phone'), '') is null
    or nullif(trim(p_changes->>'item_name'), '') is null
    or nullif(trim(p_changes->>'issue'), '') is null then
    raise exception 'Missing required repair case fields' using errcode = '22023';
  end if;

  insert into public.repair_jobs (
    case_number, customer_name, customer_phone, brand, item_name, model, serial_number, store_name,
    issue, due_at, accessories, appearance_condition, created_by, updated_by
  ) values (
    trim(p_changes->>'case_number'), trim(p_changes->>'customer_name'), trim(p_changes->>'customer_phone'),
    nullif(trim(p_changes->>'brand'), ''), trim(p_changes->>'item_name'), nullif(trim(p_changes->>'model'), ''),
    nullif(trim(p_changes->>'serial_number'), ''), (select store_name from public.profiles where id = auth.uid()), trim(p_changes->>'issue'), nullif(p_changes->>'due_at', '')::date,
    nullif(trim(p_changes->>'accessories'), ''), nullif(trim(p_changes->>'appearance_condition'), ''), auth.uid(), auth.uid()
  ) returning * into created_job;

  insert into public.repair_job_events (repair_job_id, actor_id, event_type, summary, after_values)
  values (created_job.id, auth.uid(), 'created', '建立維修案件', to_jsonb(created_job));
  return created_job.id;
end;
$$;

drop function if exists public.update_repair_job(uuid, text, text, text, text, text, date, public.repair_status);
create or replace function public.update_repair_job(p_repair_job_id uuid, p_changes jsonb)
returns void
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  employee_role public.employee_role := public.current_employee_role();
  old_job public.repair_jobs%rowtype;
  new_job public.repair_jobs%rowtype;
  allowed_fields text[] := array[
    'customer_name', 'customer_phone', 'brand', 'item_name', 'model', 'serial_number',
    'issue', 'due_at', 'accessories', 'appearance_condition', 'inspection_person_id', 'inspection_at',
    'fault_cause', 'inspection_result', 'recommended_repair', 'inspection_notes', 'actual_repair_items',
    'replacement_parts', 'repair_result', 'repaired_at', 'repaired_by'
  ];
  store_fields text[] := array[
    'customer_name', 'customer_phone', 'brand', 'item_name', 'model', 'serial_number',
    'issue', 'due_at', 'accessories', 'appearance_condition'
  ];
begin
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales', 'technician') then
    raise exception 'Employee role cannot update repair jobs' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Repair changes must be an object' using errcode = '22023';
  end if;
  if (p_changes ? 'customer_name' and nullif(trim(p_changes->>'customer_name'), '') is null)
    or (p_changes ? 'customer_phone' and nullif(trim(p_changes->>'customer_phone'), '') is null)
    or (p_changes ? 'item_name' and nullif(trim(p_changes->>'item_name'), '') is null)
    or (p_changes ? 'issue' and nullif(trim(p_changes->>'issue'), '') is null) then
    raise exception 'Required repair fields cannot be empty' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_changes) as keys(change_key) where change_key <> all (allowed_fields)) then
    raise exception 'Repair changes contain unsupported fields' using errcode = '22023';
  end if;
  if employee_role = 'sales' and exists (
    select 1 from jsonb_object_keys(p_changes) as keys(change_key) where change_key <> all (store_fields)
  ) then
    raise exception 'Store employees cannot edit repair department data' using errcode = '42501';
  end if;
  if employee_role = 'technician' and exists (
    select 1 from jsonb_object_keys(p_changes) as keys(change_key) where change_key = any (store_fields)
  ) then
    raise exception 'Repair staff cannot edit store/customer data' using errcode = '42501';
  end if;

  select * into old_job from public.repair_jobs where id = p_repair_job_id for update;
  if not found then raise exception 'Repair job not found' using errcode = 'P0002'; end if;

  update public.repair_jobs set
    customer_name = case when p_changes ? 'customer_name' then trim(p_changes->>'customer_name') else customer_name end,
    customer_phone = case when p_changes ? 'customer_phone' then trim(p_changes->>'customer_phone') else customer_phone end,
    brand = case when p_changes ? 'brand' then nullif(trim(p_changes->>'brand'), '') else brand end,
    item_name = case when p_changes ? 'item_name' then trim(p_changes->>'item_name') else item_name end,
    model = case when p_changes ? 'model' then nullif(trim(p_changes->>'model'), '') else model end,
    serial_number = case when p_changes ? 'serial_number' then nullif(trim(p_changes->>'serial_number'), '') else serial_number end,
    issue = case when p_changes ? 'issue' then trim(p_changes->>'issue') else issue end,
    due_at = case when p_changes ? 'due_at' then nullif(p_changes->>'due_at', '')::date else due_at end,
    accessories = case when p_changes ? 'accessories' then nullif(trim(p_changes->>'accessories'), '') else accessories end,
    appearance_condition = case when p_changes ? 'appearance_condition' then nullif(trim(p_changes->>'appearance_condition'), '') else appearance_condition end,
    inspection_person_id = case when p_changes ? 'inspection_person_id' then nullif(p_changes->>'inspection_person_id', '')::uuid else inspection_person_id end,
    inspection_at = case when p_changes ? 'inspection_at' then nullif(p_changes->>'inspection_at', '')::timestamptz else inspection_at end,
    fault_cause = case when p_changes ? 'fault_cause' then nullif(trim(p_changes->>'fault_cause'), '') else fault_cause end,
    inspection_result = case when p_changes ? 'inspection_result' then nullif(trim(p_changes->>'inspection_result'), '') else inspection_result end,
    recommended_repair = case when p_changes ? 'recommended_repair' then nullif(trim(p_changes->>'recommended_repair'), '') else recommended_repair end,
    inspection_notes = case when p_changes ? 'inspection_notes' then nullif(trim(p_changes->>'inspection_notes'), '') else inspection_notes end,
    actual_repair_items = case when p_changes ? 'actual_repair_items' then nullif(trim(p_changes->>'actual_repair_items'), '') else actual_repair_items end,
    replacement_parts = case when p_changes ? 'replacement_parts' then nullif(trim(p_changes->>'replacement_parts'), '') else replacement_parts end,
    repair_result = case when p_changes ? 'repair_result' then nullif(trim(p_changes->>'repair_result'), '') else repair_result end,
    repaired_at = case when p_changes ? 'repaired_at' then nullif(p_changes->>'repaired_at', '')::timestamptz else repaired_at end,
    repaired_by = case when p_changes ? 'repaired_by' then nullif(p_changes->>'repaired_by', '')::uuid else repaired_by end,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_repair_job_id returning * into new_job;

  insert into public.repair_job_events (repair_job_id, actor_id, event_type, summary, before_values, after_values)
  values (new_job.id, auth.uid(), 'job_updated', '更新案件資料', to_jsonb(old_job), to_jsonb(new_job));
end;
$$;

create or replace function public.set_repair_priority(
  p_repair_job_id uuid,
  p_priority text,
  p_reason text,
  p_due_at timestamptz,
  p_assigned_to uuid
)
returns void
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  employee_role public.employee_role := public.current_employee_role();
  old_job public.repair_jobs%rowtype;
  new_job public.repair_jobs%rowtype;
begin
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales', 'technician') then
    raise exception 'Employee role cannot set repair priority' using errcode = '42501';
  end if;
  if p_priority not in ('normal', 'priority', 'urgent') then
    raise exception 'Invalid repair priority' using errcode = '22023';
  end if;
  if p_assigned_to is not null and not exists (select 1 from public.profiles where id = p_assigned_to and active) then
    raise exception 'Priority assignee must be active' using errcode = '22023';
  end if;
  select * into old_job from public.repair_jobs where id = p_repair_job_id for update;
  if not found then raise exception 'Repair job not found' using errcode = 'P0002'; end if;

  update public.repair_jobs set
    priority = p_priority,
    priority_reason = case when p_priority = 'normal' then null else nullif(trim(p_reason), '') end,
    priority_due_at = case when p_priority = 'normal' then null else p_due_at end,
    priority_assigned_to = case when p_priority = 'normal' then null else p_assigned_to end,
    priority_created_by = case when p_priority = 'normal' then null else coalesce(priority_created_by, auth.uid()) end,
    priority_created_at = case when p_priority = 'normal' then null else coalesce(priority_created_at, now()) end,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_repair_job_id returning * into new_job;

  if old_job.priority is not distinct from new_job.priority
    and old_job.priority_reason is not distinct from new_job.priority_reason
    and old_job.priority_due_at is not distinct from new_job.priority_due_at
    and old_job.priority_assigned_to is not distinct from new_job.priority_assigned_to then
    return;
  end if;

  insert into public.repair_job_events (repair_job_id, actor_id, event_type, summary, before_values, after_values)
  values (
    new_job.id, auth.uid(), 'priority_updated', '更新急件等級',
    jsonb_build_object('priority', old_job.priority, 'reason', old_job.priority_reason, 'due_at', old_job.priority_due_at),
    jsonb_build_object('priority', new_job.priority, 'reason', new_job.priority_reason, 'due_at', new_job.priority_due_at, 'assigned_to', new_job.priority_assigned_to)
  );

  if old_job.priority = 'urgent' and (new_job.priority <> 'urgent' or old_job.priority_assigned_to is distinct from new_job.priority_assigned_to) then
    update public.repair_notifications set status = 'resolved', resolved_at = now()
    where repair_job_id = new_job.id and notification_type = 'urgent_repair' and status = 'pending';
  end if;
  if p_priority = 'urgent' and new_job.status not in ('picked_up', 'repair_cancelled', 'unrepairable') then
    insert into public.repair_notifications (repair_job_id, notification_type, recipient_id, recipient_role, created_by)
    select new_job.id, 'urgent_repair', new_job.priority_assigned_to, case when new_job.priority_assigned_to is null then 'technician' else null end, auth.uid()
    where not exists (
      select 1 from public.repair_notifications notification
      where notification.repair_job_id = new_job.id and notification.notification_type = 'urgent_repair' and notification.status = 'pending'
    );
  else
    update public.repair_notifications set status = 'resolved', resolved_at = now()
    where repair_job_id = new_job.id and notification_type = 'urgent_repair' and status = 'pending';
  end if;
end;
$$;

drop function if exists public.submit_repair_quote(uuid, jsonb, integer, text);
create or replace function public.submit_repair_quote(
  p_repair_job_id uuid,
  p_request_key uuid,
  p_items jsonb,
  p_estimated_days integer,
  p_notes text
)
returns uuid
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  employee_role public.employee_role := public.current_employee_role();
  repair_job public.repair_jobs%rowtype;
  existing_quote_id uuid;
  item jsonb;
  next_version integer;
  next_quote_id uuid;
  total numeric(14, 2) := 0;
  line_number integer := 0;
  line_quantity numeric(10, 2);
  line_price numeric(12, 2);
begin
  if employee_role is null or employee_role not in ('admin', 'manager', 'technician') then
    raise exception 'Employee role cannot submit repair quotes' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Quote requires at least one item' using errcode = '22023';
  end if;
  select * into repair_job from public.repair_jobs where id = p_repair_job_id for update;
  if not found then raise exception 'Repair job not found' using errcode = 'P0002'; end if;
  select id into existing_quote_id from public.repair_quotes where repair_job_id = p_repair_job_id and request_key = p_request_key;
  if found then return existing_quote_id; end if;
  if repair_job.status not in ('diagnosing', 'quoting', 'quote_pending_customer', 'waiting_customer', 'repairing') then
    raise exception 'Repair job is not ready for a quote' using errcode = '22023';
  end if;

  update public.repair_quotes set quote_status = 'superseded'
  where repair_job_id = p_repair_job_id and quote_status = 'submitted';
  select coalesce(max(version), 0) + 1 into next_version from public.repair_quotes where repair_job_id = p_repair_job_id;

  for item in select value from jsonb_array_elements(p_items) loop
    line_number := line_number + 1;
    line_quantity := (item->>'quantity')::numeric;
    line_price := (item->>'unit_price')::numeric;
    if nullif(trim(item->>'item_name'), '') is null or line_quantity <= 0 or line_price < 0 then
      raise exception 'Invalid quote item' using errcode = '22023';
    end if;
    total := total + line_quantity * line_price;
  end loop;

  insert into public.repair_quotes (repair_job_id, request_key, version, quote_status, customer_decision, total_amount, estimated_days, notes, created_by)
  values (p_repair_job_id, p_request_key, next_version, 'submitted', 'pending', total, p_estimated_days, nullif(trim(p_notes), ''), auth.uid())
  returning id into next_quote_id;

  line_number := 0;
  for item in select value from jsonb_array_elements(p_items) loop
    line_number := line_number + 1;
    insert into public.repair_quote_items (quote_id, line_number, item_name, quantity, unit_price, notes)
    values (next_quote_id, line_number, trim(item->>'item_name'), (item->>'quantity')::numeric, (item->>'unit_price')::numeric, nullif(trim(item->>'notes'), ''));
  end loop;

  update public.repair_jobs set status = 'quote_pending_customer', quote_version = next_version, customer_confirmation_status = 'pending', updated_by = auth.uid(), updated_at = now()
  where id = p_repair_job_id;
  update public.repair_notifications set status = 'resolved', resolved_at = now()
  where repair_job_id = p_repair_job_id and notification_type = 'quote_waiting_customer' and status = 'pending';
  insert into public.repair_notifications (repair_job_id, quote_id, notification_type, recipient_role, created_by)
  values (p_repair_job_id, next_quote_id, 'quote_waiting_customer', 'sales', auth.uid());
  insert into public.repair_job_events (repair_job_id, actor_id, event_type, summary, before_values, after_values)
  values (p_repair_job_id, auth.uid(), 'quote_submitted', '提交維修報價', jsonb_build_object('status', repair_job.status), jsonb_build_object('status', 'quote_pending_customer', 'quote_id', next_quote_id, 'version', next_version, 'total', total));
  return next_quote_id;
end;
$$;

create or replace function public.respond_repair_quote(p_quote_id uuid, p_decision text, p_note text)
returns void
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  employee_role public.employee_role := public.current_employee_role();
  selected_quote public.repair_quotes%rowtype;
  repair_job public.repair_jobs%rowtype;
  next_status public.repair_status;
begin
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales') then
    raise exception 'Employee role cannot record customer decision' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'declined', 'cancelled') then
    raise exception 'Invalid customer decision' using errcode = '22023';
  end if;
  select * into selected_quote from public.repair_quotes where id = p_quote_id for update;
  if not found or selected_quote.quote_status <> 'submitted' or selected_quote.customer_decision <> 'pending' then
    raise exception 'Quote is not awaiting customer decision' using errcode = '22023';
  end if;
  select * into repair_job from public.repair_jobs where id = selected_quote.repair_job_id for update;
  if repair_job.quote_version <> selected_quote.version then
    raise exception 'Quote is no longer the latest version' using errcode = '22023';
  end if;

  next_status := case when p_decision in ('declined', 'cancelled') then 'repair_cancelled'::public.repair_status else repair_job.status end;
  update public.repair_quotes set customer_decision = p_decision, responded_by = auth.uid(), responded_at = now(), response_note = nullif(trim(p_note), '') where id = p_quote_id;
  update public.repair_jobs set customer_confirmation_status = p_decision, status = next_status, updated_by = auth.uid(), updated_at = now() where id = repair_job.id;
  update public.repair_notifications set status = 'resolved', resolved_at = now() where quote_id = p_quote_id and status = 'pending';
  insert into public.repair_job_events (repair_job_id, actor_id, event_type, summary, before_values, after_values)
  values (repair_job.id, auth.uid(), 'customer_decision', '記錄客戶報價決定', jsonb_build_object('decision', selected_quote.customer_decision, 'status', repair_job.status), jsonb_build_object('decision', p_decision, 'status', next_status, 'quote_id', p_quote_id, 'note', p_note));
end;
$$;

create or replace function public.transition_repair_job(p_repair_job_id uuid, p_target_status public.repair_status, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  employee_role public.employee_role := public.current_employee_role();
  repair_job public.repair_jobs%rowtype;
  allowed boolean := false;
begin
  if employee_role is null then raise exception 'Active employee required' using errcode = '42501'; end if;
  select * into repair_job from public.repair_jobs where id = p_repair_job_id for update;
  if not found then raise exception 'Repair job not found' using errcode = 'P0002'; end if;

  if employee_role in ('admin', 'manager') then
    allowed := (repair_job.status = 'store_created' and p_target_status = 'store_shipped')
      or (repair_job.status = 'store_shipped' and p_target_status = 'repair_received')
      or (repair_job.status = 'repair_received' and p_target_status = 'diagnosing')
      or (repair_job.status in ('diagnosing', 'quoting') and p_target_status = 'repair_cancelled')
      or (repair_job.status = 'quote_pending_customer' and repair_job.customer_confirmation_status = 'approved' and p_target_status = 'repairing')
      or (repair_job.status = 'repairing' and p_target_status in ('paused', 'repair_completed', 'unrepairable'))
      or (repair_job.status = 'paused' and p_target_status in ('repairing', 'unrepairable'))
      or (repair_job.status = 'repair_completed' and p_target_status = 'returned_to_store')
      or (repair_job.status = 'returned_to_store' and p_target_status = 'store_received')
      or (repair_job.status = 'store_received' and p_target_status = 'customer_notified')
      or (repair_job.status = 'customer_notified' and p_target_status = 'picked_up')
      or (p_target_status = 'repair_cancelled' and repair_job.status not in ('picked_up', 'repair_cancelled', 'unrepairable'));
  elsif employee_role = 'sales' then
    allowed := (repair_job.status = 'store_created' and p_target_status = 'store_shipped')
      or (repair_job.status = 'returned_to_store' and p_target_status = 'store_received')
      or (repair_job.status = 'store_received' and p_target_status = 'customer_notified')
      or (repair_job.status = 'customer_notified' and p_target_status = 'picked_up')
      or (repair_job.status in ('store_created', 'store_shipped') and p_target_status = 'repair_cancelled');
  elsif employee_role = 'technician' then
    allowed := (repair_job.status = 'store_shipped' and p_target_status = 'repair_received')
      or (repair_job.status = 'repair_received' and p_target_status = 'diagnosing')
      or (repair_job.status = 'quote_pending_customer' and repair_job.customer_confirmation_status = 'approved' and p_target_status = 'repairing')
      or (repair_job.status = 'repairing' and p_target_status in ('paused', 'repair_completed', 'unrepairable'))
      or (repair_job.status = 'paused' and p_target_status in ('repairing', 'repair_cancelled', 'unrepairable'))
      or (repair_job.status = 'repair_completed' and p_target_status = 'returned_to_store');
  end if;
  if not allowed then raise exception 'Transition is not allowed for this role or case stage' using errcode = '42501'; end if;
  if p_target_status = 'repairing' and repair_job.customer_confirmation_status <> 'approved' then
    raise exception 'Customer approval is required before repair' using errcode = '23514';
  end if;
  if p_target_status = 'quote_pending_customer' then
    raise exception 'Submit a quote before waiting for customer' using errcode = '23514';
  end if;

  update public.repair_jobs set
    status = p_target_status,
    store_shipped_at = case when p_target_status = 'store_shipped' then now() else store_shipped_at end,
    store_tracking_number = case when p_target_status = 'store_shipped' and p_payload ? 'tracking_number' then nullif(p_payload->>'tracking_number', '') else store_tracking_number end,
    repair_received_at = case when p_target_status = 'repair_received' then now() else repair_received_at end,
    repaired_at = case when p_target_status = 'repair_completed' then now() else repaired_at end,
    repair_shipped_back_at = case when p_target_status = 'returned_to_store' then now() else repair_shipped_back_at end,
    return_tracking_number = case when p_target_status = 'returned_to_store' and p_payload ? 'tracking_number' then nullif(p_payload->>'tracking_number', '') else return_tracking_number end,
    store_received_at = case when p_target_status = 'store_received' then now() else store_received_at end,
    customer_notified_at = case when p_target_status = 'customer_notified' then now() else customer_notified_at end,
    notification_method = case when p_target_status = 'customer_notified' and p_payload ? 'notification_method' then p_payload->>'notification_method' else notification_method end,
    notification_result = case when p_target_status = 'customer_notified' and p_payload ? 'notification_result' then p_payload->>'notification_result' else notification_result end,
    picked_up_at = case when p_target_status = 'picked_up' then now() else picked_up_at end,
    updated_by = auth.uid(), updated_at = now()
  where id = p_repair_job_id;
  insert into public.repair_job_events (repair_job_id, actor_id, event_type, summary, before_values, after_values)
  values (repair_job.id, auth.uid(), 'status_changed', '變更維修狀態', jsonb_build_object('status', repair_job.status), jsonb_build_object('status', p_target_status, 'payload', p_payload));
  if p_target_status in ('picked_up', 'repair_cancelled', 'unrepairable') then
    update public.repair_notifications set status = 'resolved', resolved_at = now()
    where repair_job_id = p_repair_job_id and status = 'pending';
  end if;
end;
$$;

revoke all on function public.create_repair_job(jsonb) from public, anon;
revoke all on function public.update_repair_job(uuid, jsonb) from public, anon;
revoke all on function public.set_repair_priority(uuid, text, text, timestamptz, uuid) from public, anon;
revoke all on function public.submit_repair_quote(uuid, uuid, jsonb, integer, text) from public, anon;
revoke all on function public.respond_repair_quote(uuid, text, text) from public, anon;
revoke all on function public.transition_repair_job(uuid, public.repair_status, jsonb) from public, anon;
grant execute on function public.create_repair_job(jsonb) to authenticated;
grant execute on function public.update_repair_job(uuid, jsonb) to authenticated;
grant execute on function public.set_repair_priority(uuid, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.submit_repair_quote(uuid, uuid, jsonb, integer, text) to authenticated;
grant execute on function public.respond_repair_quote(uuid, text, text) to authenticated;
grant execute on function public.transition_repair_job(uuid, public.repair_status, jsonb) to authenticated;

commit;