import type { SupabaseClient } from '@supabase/supabase-js';
import { repairStatuses, type WorkspaceKey } from '@/lib/modules';

export type WorkspaceRecord = {
  id: string;
  cells: string[];
  editableValue?: string;
  data?: Record<string, unknown>;
};

const roleLabels: Record<string, string> = {
  admin: '系統管理員',
  manager: '店長',
  sales: '門市人員',
  technician: '維修技師',
};

const formatDate = (value: string | null) => value ? value.slice(0, 10) : '—';
const formatTime = (value: string | null) => value ? new Date(value).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function loadWorkspaceRecords(client: SupabaseClient, moduleKey: WorkspaceKey): Promise<WorkspaceRecord[]> {
  if (moduleKey === 'inventory') {
    const { data, error } = await client.from('inventory_items').select('id, name, sku, serial_number, category, quantity, reorder_threshold').order('name');
    fail(error);
    return (data ?? []).map((item) => ({
      id: item.id,
      cells: [item.name, item.sku, item.serial_number ?? '—', item.category, String(item.quantity), item.quantity === 0 ? '已售完' : item.quantity <= item.reorder_threshold ? '庫存偏低' : '庫存充足'],
      editableValue: String(item.quantity),
      data: item,
    }));
  }

  if (moduleKey === 'repairs') {
    const { data, error } = await client.from('repair_jobs').select('id, case_number, customer_name, customer_phone, item_name, issue, due_at, status').order('created_at', { ascending: false });
    fail(error);
    return (data ?? []).map((job) => ({
      id: job.id,
      cells: [job.case_number, job.customer_name, job.customer_phone, job.item_name, job.issue, formatDate(job.due_at), repairStatuses.find((status) => status.value === job.status)?.label ?? job.status],
      editableValue: job.status,
      data: job,
    }));
  }

  if (moduleKey === 'users') {
    const { data, error } = await client.from('profiles').select('id, full_name, email, role, store_name, active').order('full_name');
    fail(error);
    return (data ?? []).map((profile) => ({
      id: profile.id,
      cells: [profile.full_name, profile.email, roleLabels[profile.role] ?? profile.role, profile.store_name, profile.active ? '在職' : '停用'],
      editableValue: profile.role,
      data: profile,
    }));
  }

  if (moduleKey === 'roles') {
    const { data, error } = await client.from('profiles').select('role, active');
    fail(error);
    const counts = new Map<string, number>();
    (data ?? []).filter((profile) => profile.active).forEach((profile) => counts.set(profile.role, (counts.get(profile.role) ?? 0) + 1));
    return (['admin', 'manager', 'sales', 'technician'] as const).map((role) => ({
      id: role,
      cells: [roleLabels[role], `${counts.get(role) ?? 0} 人`, ['admin', 'manager', 'sales'].includes(role) ? '檢視 / 編輯' : '檢視', ['admin', 'manager', 'sales', 'technician'].includes(role) ? '檢視 / 編輯' : '檢視', ['admin', 'manager'].includes(role) ? '檢視 / 編輯' : '無權限'],
    }));
  }

  if (moduleKey === 'attendance') {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const [{ data: shifts, error: shiftsError }, { data: attendance, error: attendanceError }, { data: profiles, error: profilesError }] = await Promise.all([
      client.from('shifts').select('id, employee_id, starts_at, ends_at').gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString()).order('starts_at'),
      client.from('attendance_records').select('id, employee_id, shift_id, clocked_in_at, clocked_out_at').gte('clocked_in_at', start.toISOString()).lt('clocked_in_at', end.toISOString()).order('clocked_in_at', { ascending: false }),
      client.from('profiles').select('id, full_name'),
    ]);
    fail(shiftsError);
    fail(attendanceError);
    fail(profilesError);
    const profileNames = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
    const scheduledRows = (shifts ?? []).map((shift) => {
      const punch = (attendance ?? []).find((item) => item.shift_id === shift.id);
      return {
        id: punch?.id ?? shift.id,
        cells: [profileNames.get(shift.employee_id) ?? '員工', `${formatTime(shift.starts_at)}–${formatTime(shift.ends_at)}`, formatTime(punch?.clocked_in_at ?? null), formatTime(punch?.clocked_out_at ?? null), punch?.clocked_out_at ? '已下班' : punch ? '工作中' : '未打卡'],
        editableValue: punch?.id ?? '',
        data: { employee_id: shift.employee_id, shift_id: shift.id, punch_id: punch?.id ?? null, clocked_out_at: punch?.clocked_out_at ?? null },
      };
    });
    const scheduledShiftIds = new Set((shifts ?? []).map((shift) => shift.id));
    const unscheduledPunches = (attendance ?? []).filter((punch) => !punch.shift_id || !scheduledShiftIds.has(punch.shift_id)).map((punch) => ({
      id: punch.id,
      cells: [profileNames.get(punch.employee_id) ?? '員工', '未排班', formatTime(punch.clocked_in_at), formatTime(punch.clocked_out_at), punch.clocked_out_at ? '已下班' : '工作中'],
      editableValue: punch.id,
      data: { employee_id: punch.employee_id, shift_id: punch.shift_id, punch_id: punch.id, clocked_out_at: punch.clocked_out_at },
    }));
    return [...scheduledRows, ...unscheduledPunches];
  }

  const { data, error } = await client.from('audit_logs').select('id, actor_id, action, entity_type, entity_id, created_at, details').order('created_at', { ascending: false }).limit(100);
  fail(error);
  const actorIds = [...new Set((data ?? []).map((log) => log.actor_id).filter(Boolean))];
  const { data: profiles, error: profilesError } = actorIds.length
    ? await client.from('profiles').select('id, full_name').in('id', actorIds)
    : { data: [], error: null };
  fail(profilesError);
  const profileNames = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
  return (data ?? []).map((log) => ({
    id: String(log.id),
    cells: [new Date(log.created_at).toLocaleString('zh-TW'), profileNames.get(log.actor_id) ?? '系統', `${log.action} ${log.entity_id ?? ''}`.trim(), log.entity_type, '管理後台'],
    data: log,
  }));
}

export async function createWorkspaceRecord(client: SupabaseClient, moduleKey: WorkspaceKey, values: Record<string, string>, employeeId: string) {
  if (moduleKey === 'inventory') {
    const { error } = await client.from('inventory_items').insert({
      name: values.name,
      sku: values.sku,
      serial_number: values.serial_number || null,
      category: values.category,
      quantity: Number(values.quantity),
      reorder_threshold: Number(values.reorder_threshold),
    });
    fail(error);
    return;
  }
  if (moduleKey === 'repairs') {
    const { error } = await client.from('repair_jobs').insert({
      case_number: values.case_number,
      customer_name: values.customer_name,
      customer_phone: values.customer_phone,
      item_name: values.item_name,
      issue: values.issue,
      due_at: values.due_at || null,
      status: values.status,
      created_by: employeeId,
    });
    fail(error);
    return;
  }
  throw new Error('此模組不支援新增資料');
}

export async function updateWorkspaceRecord(client: SupabaseClient, moduleKey: WorkspaceKey, recordId: string, values: Record<string, string>) {
  if (moduleKey === 'inventory') {
    const { error } = await client.from('inventory_items').update({
      name: values.name,
      sku: values.sku,
      serial_number: values.serial_number || null,
      category: values.category,
      quantity: Number(values.quantity),
      reorder_threshold: Number(values.reorder_threshold),
    }).eq('id', recordId);
    fail(error);
    return;
  }
  if (moduleKey === 'repairs') {
    const { error } = await client.rpc('update_repair_job', {
      p_repair_job_id: recordId,
      p_case_number: values.case_number,
      p_customer_name: values.customer_name,
      p_customer_phone: values.customer_phone,
      p_item_name: values.item_name,
      p_issue: values.issue,
      p_due_at: values.due_at || null,
      p_status: values.status,
    });
    fail(error);
    return;
  }
  throw new Error('此模組不支援更新資料');
}

export async function addAuditLog(client: SupabaseClient, employeeId: string, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}) {
  const { error } = await client.from('audit_logs').insert({
    actor_id: employeeId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  });
  fail(error);
}

export async function clockIn(client: SupabaseClient, employeeId: string) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const { data: shift, error: shiftError } = await client.from('shifts').select('id').eq('employee_id', employeeId).gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString()).order('starts_at').limit(1).maybeSingle();
  fail(shiftError);
  const { data: record, error } = await client.from('attendance_records').insert({ employee_id: employeeId, shift_id: shift?.id ?? null }).select('id').single();
  fail(error);
  if (!record) throw new Error('打卡紀錄建立失敗');
  await addAuditLog(client, employeeId, 'clock_in', 'attendance_record', record.id);
}

export async function clockOut(client: SupabaseClient, employeeId: string) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const { data: record, error: findError } = await client.from('attendance_records').select('id').eq('employee_id', employeeId).is('clocked_out_at', null).gte('clocked_in_at', start.toISOString()).order('clocked_in_at', { ascending: false }).limit(1).maybeSingle();
  fail(findError);
  if (!record) throw new Error('找不到今日尚未下班的打卡紀錄');
  const { error } = await client.from('attendance_records').update({ clocked_out_at: now.toISOString() }).eq('id', record.id);
  fail(error);
  await addAuditLog(client, employeeId, 'clock_out', 'attendance_record', record.id);
}
