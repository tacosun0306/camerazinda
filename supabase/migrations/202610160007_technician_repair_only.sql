begin;

-- Technicians can read only their own profile and repair-related data.
drop policy if exists "Active employees read profiles" on public.profiles;
create policy "Employees read profiles by role" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or (
      public.current_employee_role() is not null
      and public.current_employee_role() <> 'technician'
      and (public.current_employee_role() = 'admin' or active = true)
    )
  );

-- Keep the existing operational roles, but prevent technicians from inventory data.
drop policy if exists "Active employees read inventory" on public.inventory_items;
create policy "Operational employees read inventory" on public.inventory_items for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager', 'sales'));

drop policy if exists "Active employees read store locations" on public.store_locations;
create policy "Operational employees read store locations" on public.store_locations for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager', 'sales'));
drop policy if exists "Active employees read inventory stocks" on public.inventory_stocks;
create policy "Operational employees read inventory stocks" on public.inventory_stocks for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager', 'sales'));
drop policy if exists "Active employees read inventory movements" on public.inventory_movements;
create policy "Operational employees read inventory movements" on public.inventory_movements for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager', 'sales'));
drop policy if exists "Active employees read product units" on public.product_units;
create policy "Operational employees read product units" on public.product_units for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager', 'sales'));

-- Stocktakes are part of inventory operations and remain unavailable to technicians.
drop policy if exists "Active employees read inventory stocktakes" on public.inventory_stocktakes;
create policy "Operational employees read inventory stocktakes" on public.inventory_stocktakes for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager', 'sales'));
drop policy if exists "Active employees read inventory stocktake lines" on public.inventory_stocktake_lines;
create policy "Operational employees read inventory stocktake lines" on public.inventory_stocktake_lines for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager', 'sales'));

-- Scheduling and attendance are reserved for admins/managers while these modules are unavailable to staff roles.
drop policy if exists "Non-sales employees read shifts" on public.shifts;
create policy "Managers read shifts" on public.shifts for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));
drop policy if exists "Non-sales employees read shift change requests" on public.shift_change_requests;
create policy "Managers read shift change requests" on public.shift_change_requests for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));
drop policy if exists "Non-sales employees request changes to own shifts" on public.shift_change_requests;
create policy "Employees request own shifts by role" on public.shift_change_requests for insert to authenticated
  with check (
    public.current_employee_role() in ('admin', 'manager')
    and employee_id = auth.uid()
    and exists (select 1 from public.shifts where id = shift_id and employee_id = auth.uid())
  );
drop policy if exists "Non-sales employees read attendance" on public.attendance_records;
create policy "Managers read attendance" on public.attendance_records for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));
drop policy if exists "Non-sales employees clock themselves" on public.attendance_records;
create policy "Managers clock attendance" on public.attendance_records for insert to authenticated
  with check (public.current_employee_role() in ('admin', 'manager') and employee_id = auth.uid());
drop policy if exists "Non-sales employees update attendance" on public.attendance_records;
create policy "Managers update attendance" on public.attendance_records for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager'))
  with check (public.current_employee_role() in ('admin', 'manager'));

commit;
