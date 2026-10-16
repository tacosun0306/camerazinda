begin;

drop policy if exists "Managers and technicians update repair jobs" on public.repair_jobs;
create policy "Active employees update repair jobs" on public.repair_jobs for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager', 'sales', 'technician'))
  with check (public.current_employee_role() in ('admin', 'manager', 'sales', 'technician'));

drop policy if exists "Active employees read shifts" on public.shifts;
create policy "Non-sales employees read shifts" on public.shifts for select to authenticated
  using (public.current_employee_role() is not null and public.current_employee_role() <> 'sales');

drop policy if exists "Active employees read shift change requests" on public.shift_change_requests;
create policy "Non-sales employees read shift change requests" on public.shift_change_requests for select to authenticated
  using (
    public.current_employee_role() is not null
    and public.current_employee_role() <> 'sales'
    and (employee_id = auth.uid() or public.current_employee_role() in ('admin', 'manager'))
  );

drop policy if exists "Active employees request changes to own shifts" on public.shift_change_requests;
create policy "Non-sales employees request changes to own shifts" on public.shift_change_requests for insert to authenticated
  with check (
    public.current_employee_role() is not null
    and public.current_employee_role() <> 'sales'
    and employee_id = auth.uid()
    and exists (select 1 from public.shifts where id = shift_id and employee_id = auth.uid())
  );

drop policy if exists "Active employees read attendance" on public.attendance_records;
create policy "Non-sales employees read attendance" on public.attendance_records for select to authenticated
  using (
    public.current_employee_role() is not null
    and public.current_employee_role() <> 'sales'
    and (employee_id = auth.uid() or public.current_employee_role() in ('admin', 'manager'))
  );

drop policy if exists "Employees clock themselves" on public.attendance_records;
create policy "Non-sales employees clock themselves" on public.attendance_records for insert to authenticated
  with check (public.current_employee_role() is not null and public.current_employee_role() <> 'sales' and employee_id = auth.uid());

drop policy if exists "Active employees update attendance" on public.attendance_records;
create policy "Non-sales employees update attendance" on public.attendance_records for update to authenticated
  using (
    public.current_employee_role() is not null
    and public.current_employee_role() <> 'sales'
    and (employee_id = auth.uid() or public.current_employee_role() in ('admin', 'manager'))
  )
  with check (
    public.current_employee_role() is not null
    and public.current_employee_role() <> 'sales'
    and (employee_id = auth.uid() or public.current_employee_role() in ('admin', 'manager'))
  );

create or replace function public.update_repair_job(
  p_repair_job_id uuid,
  p_case_number text,
  p_customer_name text,
  p_customer_phone text,
  p_item_name text,
  p_issue text,
  p_due_at date,
  p_status public.repair_status
)
returns void
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  employee_role public.employee_role := public.current_employee_role();
begin
  if employee_role is null or employee_role not in ('admin', 'manager', 'sales', 'technician') then
    raise exception 'Employee role cannot update repair jobs' using errcode = '42501';
  end if;

  update public.repair_jobs
  set case_number = p_case_number,
      customer_name = p_customer_name,
      customer_phone = p_customer_phone,
      item_name = p_item_name,
      issue = p_issue,
      due_at = p_due_at,
      status = p_status
  where id = p_repair_job_id;

  if not found then
    raise exception 'Repair job not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'repair_job_updated',
    'repair_job',
    p_repair_job_id::text,
    jsonb_build_object('updated_fields', jsonb_build_array('case_number', 'customer_name', 'customer_phone', 'item_name', 'issue', 'due_at', 'status'))
  );
end;
$$;

revoke all on function public.update_repair_job(uuid, text, text, text, text, text, date, public.repair_status) from public, anon;
grant execute on function public.update_repair_job(uuid, text, text, text, text, text, date, public.repair_status) to authenticated;

commit;
