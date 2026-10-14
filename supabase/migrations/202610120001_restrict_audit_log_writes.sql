drop policy if exists "Employees create audit logs" on public.audit_logs;

revoke insert on table public.audit_logs from public, anon, authenticated;