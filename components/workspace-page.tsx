'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';
import { useStaffProfile } from '@/components/app-shell';
import { RepairCaseDetails, type RepairJobDetails } from '@/components/repair-case-details';
import { addAuditLog, clockIn, clockOut, createWorkspaceRecord, loadWorkspaceRecords, localDateKey, updateWorkspaceRecord, type WorkspaceRecord } from '@/lib/data/workspaces';
import { moduleContent, type WorkspaceField, type WorkspaceKey } from '@/lib/modules';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const statusTone = (value: string) => {
  if (/已售完|未打卡|遲到|停用|低/.test(value)) return 'bg-[#fae8e2] text-[#bd5039]';
  if (/待|維修中/.test(value)) return 'bg-[#f5eed9] text-[#816925]';
  if (/充足|確認|工作中|在職|完整|已下班/.test(value)) return 'bg-[#e6efe8] text-fern';
  return 'bg-[#eef0ed] text-[#65716b]';
};

const repairFilters = [
  { value: 'all', label: '全部案件' },
  { value: 'my_todo', label: '我的待辦' },
  { value: 'urgent', label: '急件' },
  { value: 'quote_pending', label: '待報價' },
  { value: 'customer_pending', label: '待客戶確認' },
  { value: 'repairing', label: '維修中' },
  { value: 'return_pending', label: '待寄回' },
  { value: 'notify_pending', label: '待通知客戶' },
  { value: 'completed', label: '已完成' },
] as const;
const repairCreateFieldKeys = new Set(['case_number', 'customer_name', 'customer_phone', 'brand', 'item_name', 'model', 'serial_number', 'issue', 'due_at', 'accessories', 'appearance_condition']);

function repairMatchesFilter(record: WorkspaceRecord, filter: string, employeeId?: string) {
  const status = String(record.data?.status ?? '');
  const priority = String(record.data?.priority ?? 'normal');
  if (filter === 'my_todo') return !['picked_up', 'repair_cancelled', 'unrepairable'].includes(status) && (record.data?.assigned_to === employeeId || record.data?.priority_assigned_to === employeeId || record.data?.created_by === employeeId);
  if (filter === 'urgent') return priority === 'urgent' && !['picked_up', 'repair_cancelled', 'unrepairable'].includes(status);
  if (filter === 'quote_pending') return ['diagnosing', 'quoting'].includes(status);
  if (filter === 'customer_pending') return ['quote_pending_customer', 'waiting_customer'].includes(status);
  if (filter === 'repairing') return ['repairing', 'paused'].includes(status);
  if (filter === 'return_pending') return status === 'repair_completed';
  if (filter === 'notify_pending') return status === 'store_received';
  if (filter === 'completed') return status === 'picked_up';
  return true;
}

function fieldSchema(field: WorkspaceField) {
  let validator = z.string().trim();
  if (!field.optional) validator = validator.min(1, '此欄位為必填');
  if (field.type === 'email') validator = validator.email('請輸入有效的電子郵件');
  if (field.type === 'tel') validator = validator.regex(/^\+?[\d\s()-]{8,20}$/, '請輸入有效的電話號碼');
  if (field.type === 'number') validator = validator.regex(/^\d+$/, '請輸入有效的非負整數');
  if (field.type === 'date') return validator.refine((value) => !value || !Number.isNaN(Date.parse(value)), '請輸入有效日期');
  if (field.type === 'select' && field.options) return validator.refine((value) => field.options?.some((option) => option.value === value), '請選擇有效選項');
  return validator;
}

function toFormValues(fields: readonly WorkspaceField[], data?: Record<string, unknown>) {
  return Object.fromEntries(fields.map((field) => [field.key, data?.[field.key] == null ? '' : String(data[field.key])])) as Record<string, string>;
}

export function WorkspacePage({ moduleKey }: { moduleKey: WorkspaceKey }) {
  const config = moduleContent[moduleKey];
  const profile = useStaffProfile();
  const [records, setRecords] = useState<WorkspaceRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceRecord | null>(null);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [repairFilter, setRepairFilter] = useState('all');
  const [selectedRepair, setSelectedRepair] = useState<WorkspaceRecord | null>(null);

  const formFields = useMemo(() => moduleKey === 'repairs' ? config.fields.filter((field) => repairCreateFieldKeys.has(field.key)) : config.fields, [config.fields, moduleKey]);
  const formSchema = useMemo(() => z.object(Object.fromEntries(formFields.map((field) => [field.key, fieldSchema(field)])) as z.ZodRawShape), [formFields]);
  const form = useForm<Record<string, string>>({ resolver: zodResolver(formSchema) as Resolver<Record<string, string>> });
  const filteredRecords = useMemo(() => records.filter((record) => record.cells.join(' ').toLowerCase().includes(query.toLowerCase())), [query, records]);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const rows = await loadWorkspaceRecords(createSupabaseBrowserClient(), moduleKey);
      setRecords(rows);
      if (moduleKey === 'repairs' && selectedRepair) setSelectedRepair(rows.find((record) => record.id === selectedRepair.id) ?? null);
      if (moduleKey === 'repairs') window.dispatchEvent(new Event('repair-jobs-changed'));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '無法載入資料');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [moduleKey]);

  function openCreate() {
    setEditing(null);
    form.reset(toFormValues(formFields));
    setModalOpen(true);
  }

  function openEdit(record: WorkspaceRecord) {
    setEditing(record);
    form.reset(toFormValues(config.fields, record.data));
    setModalOpen(true);
  }

  async function submitForm(values: Record<string, string>) {
    if (!profile?.id) return;
    setError('');
    try {
      const supabase = createSupabaseBrowserClient();
      if (editing) {
        await updateWorkspaceRecord(supabase, moduleKey, editing.id, values);
        if (moduleKey !== 'repairs') await addAuditLog(supabase, profile.id, `${moduleKey}_updated`, moduleKey, editing.id);
      } else {
        await createWorkspaceRecord(supabase, moduleKey, values, profile.id);
        if (moduleKey !== 'repairs') await addAuditLog(supabase, profile.id, `${moduleKey}_created`, moduleKey, values.case_number ?? values.sku ?? '');
      }
      setModalOpen(false);
      setNotice(editing ? '資料已更新' : '資料已建立');
      await refresh();
      window.setTimeout(() => setNotice(''), 2600);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '儲存失敗，請確認角色權限');
    }
  }

  async function handleClock(action: 'in' | 'out') {
    if (!profile?.id) return;
    setAttendanceBusy(true);
    setError('');
    try {
      const supabase = createSupabaseBrowserClient();
      if (action === 'in') await clockIn(supabase, profile.id);
      else await clockOut(supabase, profile.id);
      setNotice(action === 'in' ? '上班打卡完成' : '下班打卡完成');
      await refresh();
    } catch (clockError) {
      setError(clockError instanceof Error ? clockError.message : '打卡失敗');
    } finally {
      setAttendanceBusy(false);
    }
  }

  const canEditInventory = profile && ['admin', 'manager', 'sales'].includes(profile.role);
  const canUpdateRepair = profile && ['admin', 'manager', 'sales', 'technician'].includes(profile.role);
  const canCreateRepair = profile && ['admin', 'manager', 'sales'].includes(profile.role);
  const ownAttendance = records.find((record) => record.data?.employee_id === profile?.id && record.data?.punch_id && !record.data?.clocked_out_at);
  const canShowActions = (moduleKey === 'inventory' && canEditInventory) || (moduleKey === 'repairs' && canUpdateRepair);
  const visibleRecords = moduleKey === 'repairs'
    ? filteredRecords.filter((record) => repairMatchesFilter(record, repairFilter, profile?.id))
    : filteredRecords;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">STORE OPERATIONS</p><h1 className="mt-2 font-display text-[32px] leading-tight">{config.title}</h1><p className="mt-2 text-sm text-[#77827c]">{config.description}</p></div>
        <div className="flex gap-2">
          {moduleKey === 'attendance' && <button disabled={attendanceBusy} onClick={() => void handleClock(ownAttendance ? 'out' : 'in')} className="h-10 rounded-md bg-ink px-3.5 text-xs font-semibold text-white disabled:opacity-60">{ownAttendance ? '下班打卡' : '上班打卡'}</button>}
          {config.addLabel && (moduleKey !== 'repairs' || canCreateRepair) && <button onClick={openCreate} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3.5 text-xs font-semibold text-white hover:bg-fern"><Plus size={15} />{config.addLabel}</button>}
          <button onClick={() => void refresh()} aria-label="重新載入" className="grid h-10 w-10 place-items-center rounded-md border border-[#dce2db] bg-white hover:border-ink"><RefreshCw size={15} /></button>
        </div>
      </section>
      {error && <div role="alert" className="rounded-md border border-[#f0c5b8] bg-[#fff8f5] px-4 py-3 text-sm text-[#a84834]">{error}</div>}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] px-4 py-4 md:px-5"><div><p className="eyebrow">{loading ? '讀取中' : `${filteredRecords.length} 筆資料`}</p><h2 className="mt-1 text-base font-semibold">{config.title}清單</h2></div><label className="flex h-9 w-full max-w-[260px] items-center gap-2 rounded-md border border-[#dfe5de] bg-white px-3 focus-within:border-fern"><Search size={15} className="shrink-0 text-[#89928d]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋資料..." className="w-full border-0 bg-transparent p-0 text-xs outline-none placeholder:text-[#a0a8a2] focus:ring-0" /></label></div>
        {moduleKey === 'repairs' && <div className="flex gap-2 overflow-x-auto border-b border-[#edf0eb] px-4 py-3 md:px-5">{repairFilters.map((filter) => <button key={filter.value} onClick={() => setRepairFilter(filter.value)} className={`shrink-0 rounded-md px-3 py-2 text-xs font-semibold ${repairFilter === filter.value ? 'bg-ink text-white' : 'border border-[#dce2db] bg-white text-[#65716b]'}`}>{filter.label}</button>)}</div>}
        <div className="overflow-x-auto"><div className={moduleKey === 'repairs' ? 'min-w-[1180px]' : 'min-w-[660px]'}><div className="data-row grid gap-3 bg-[#fafbf9] px-5 py-3 text-[10px] font-semibold text-[#87918a]" style={{ gridTemplateColumns: `repeat(${config.columns.length}, minmax(0, 1fr)) ${canShowActions ? '132px' : ''}` }}>{config.columns.map((column) => <span key={column}>{column}</span>)}{canShowActions && <span>操作</span>}</div>
          {loading && <div className="px-5 py-12 text-center text-sm text-[#87918a]">正在從 Supabase 載入…</div>}
          {!loading && visibleRecords.map((record) => { const isUrgent = record.data?.priority === 'urgent'; const dueAt = String(record.data?.due_at ?? ''); const overdue = dueAt !== '' && dueAt < localDateKey() && !['picked_up', 'repair_cancelled', 'unrepairable'].includes(String(record.data?.status)); return <div key={record.id} className={`data-row min-h-[58px] gap-3 px-5 py-3 text-xs ${isUrgent ? 'border-l-4 border-coral bg-[#fff8f5]' : overdue ? 'border-l-4 border-[#bd5039] bg-[#fffaf8]' : ''}`} style={{ gridTemplateColumns: `repeat(${config.columns.length}, minmax(0, 1fr)) ${canShowActions ? '132px' : ''}` }}>{record.cells.map((cell, cellIndex) => <span key={`${cell}-${cellIndex}`} className="truncate" title={cell}>{moduleKey === 'repairs' && cellIndex === 5 && isUrgent ? <span className="status-pill bg-[#fae8e2] text-[#bd5039]">急件</span> : moduleKey === 'repairs' && cellIndex === 6 && overdue ? <span className="font-semibold text-[#bd5039]">{cell} · 逾期</span> : cellIndex === record.cells.length - 2 ? <span className={`status-pill ${statusTone(cell)}`}>{cell}</span> : <span className={cellIndex === 0 ? 'font-semibold text-ink' : 'text-[#65716b]'}>{cell}</span>}</span>)}
            {moduleKey === 'inventory' && canEditInventory && <span className="flex items-center gap-2"><button onClick={() => openEdit(record)} className="text-xs font-semibold text-fern hover:underline">編輯品項</button></span>}
            {moduleKey === 'repairs' && canUpdateRepair && <span><button onClick={() => setSelectedRepair(record)} className="text-xs font-semibold text-fern hover:underline">查看／編輯案件</button></span>}
          </div>; })}
          {!loading && !error && visibleRecords.length === 0 && <div className="px-5 py-14 text-center text-sm text-[#87918a]">目前沒有符合條件的案件</div>}
          </div></div>
        <div className="flex items-center justify-between border-t border-[#edf0eb] px-5 py-3 text-[11px] text-[#87918a]"><span>{loading ? '等待資料' : `顯示 ${visibleRecords.length} 筆資料`}</span><span>來源：Supabase</span></div>
      </section>
      {notice && <div role="status" className="fixed bottom-5 right-5 z-50 rounded-md bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg">{notice}</div>}
      {modalOpen && moduleKey === 'repairs' && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}><form onSubmit={form.handleSubmit((values) => submitForm(values))} noValidate className="my-auto w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl"><div className="mb-5 flex items-start justify-between"><div><p className="eyebrow">NEW REPAIR CASE</p><h2 className="mt-1 text-lg font-semibold">建立維修單</h2></div><button type="button" onClick={() => setModalOpen(false)} aria-label="關閉" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div><div className="grid gap-4 sm:grid-cols-2">{formFields.map((field) => { const fieldError = form.formState.errors[field.key]?.message; return <label key={field.key} className="text-xs font-semibold text-[#56635c]">{field.label}<input type={field.type} {...form.register(field.key)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm focus:border-fern focus:ring-fern" />{fieldError && <span role="alert" className="mt-1 block text-[11px] text-coral">{String(fieldError)}</span>}</label>; })}</div><p className="mt-4 text-[11px] text-[#78827c]">案件會自動記錄建立人員、門市與案件歷程。</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setModalOpen(false)} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">取消</button><button disabled={form.formState.isSubmitting} className="h-9 rounded-md bg-ink px-4 text-xs font-semibold text-white hover:bg-fern disabled:opacity-60">建立維修單</button></div></form></div>}
      {modalOpen && moduleKey !== 'repairs' && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}><form onSubmit={form.handleSubmit((values) => submitForm(values))} noValidate className="my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"><div className="mb-5 flex items-start justify-between"><div><p className="eyebrow">{editing ? 'EDIT RECORD' : 'NEW RECORD'}</p><h2 className="mt-1 text-lg font-semibold">{editing ? '編輯資料' : config.addLabel}</h2></div><button type="button" onClick={() => setModalOpen(false)} aria-label="關閉" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div><div className="grid gap-4 sm:grid-cols-2">{formFields.map((field) => { const fieldError = form.formState.errors[field.key]?.message; return <label key={field.key} className="text-xs font-semibold text-[#56635c]">{field.label}{field.type === 'select' ? <select {...form.register(field.key)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm"><option value="">請選擇</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input type={field.type} {...form.register(field.key)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm focus:border-fern focus:ring-fern" />}{fieldError && <span role="alert" className="mt-1 block text-[11px] text-coral">{String(fieldError)}</span>}</label>; })}</div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setModalOpen(false)} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">取消</button><button disabled={form.formState.isSubmitting} className="h-9 rounded-md bg-ink px-4 text-xs font-semibold text-white hover:bg-fern disabled:opacity-60">{editing ? '儲存變更' : config.addLabel}</button></div></form></div>}
      {selectedRepair && profile && <RepairCaseDetails job={selectedRepair.data as RepairJobDetails} role={profile.role} onClose={() => setSelectedRepair(null)} onSaved={refresh} />}
    </div>
  );
}
