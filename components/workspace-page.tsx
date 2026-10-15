'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';
import { useStaffProfile } from '@/components/app-shell';
import { addAuditLog, clockIn, clockOut, createWorkspaceRecord, loadWorkspaceRecords, updateWorkspaceRecord, type WorkspaceRecord } from '@/lib/data/workspaces';
import { moduleContent, repairStatuses, type WorkspaceField, type WorkspaceKey } from '@/lib/modules';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const statusTone = (value: string) => {
  if (/已售完|未打卡|遲到|停用|低/.test(value)) return 'bg-[#fae8e2] text-[#bd5039]';
  if (/待|維修中/.test(value)) return 'bg-[#f5eed9] text-[#816925]';
  if (/充足|確認|工作中|在職|完整|已下班/.test(value)) return 'bg-[#e6efe8] text-fern';
  return 'bg-[#eef0ed] text-[#65716b]';
};

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
  const [savingId, setSavingId] = useState('');
  const [pendingValues, setPendingValues] = useState<Record<string, string>>({});
  const [attendanceBusy, setAttendanceBusy] = useState(false);

  const formSchema = useMemo(() => z.object(Object.fromEntries(config.fields.map((field) => [field.key, fieldSchema(field)])) as z.ZodRawShape), [config.fields]);
  const form = useForm<Record<string, string>>({ resolver: zodResolver(formSchema) as Resolver<Record<string, string>> });
  const filteredRecords = useMemo(() => records.filter((record) => record.cells.join(' ').toLowerCase().includes(query.toLowerCase())), [query, records]);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const rows = await loadWorkspaceRecords(createSupabaseBrowserClient(), moduleKey);
      setRecords(rows);
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
    form.reset(toFormValues(config.fields));
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
        await addAuditLog(supabase, profile.id, `${moduleKey}_updated`, moduleKey, editing.id);
      } else {
        await createWorkspaceRecord(supabase, moduleKey, values, profile.id);
        await addAuditLog(supabase, profile.id, `${moduleKey}_created`, moduleKey, values.case_number ?? values.sku ?? '');
      }
      setModalOpen(false);
      setNotice(editing ? '資料已更新' : '資料已建立');
      await refresh();
      window.setTimeout(() => setNotice(''), 2600);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '儲存失敗，請確認角色權限');
    }
  }

  async function saveRepairStatus(record: WorkspaceRecord) {
    if (!profile?.id) return;
    setSavingId(record.id);
    try {
      const supabase = createSupabaseBrowserClient();
      const status = pendingValues[record.id] ?? record.editableValue;
      const { error: updateError } = await supabase.from('repair_jobs').update({ status }).eq('id', record.id);
      if (updateError) throw updateError;
      await addAuditLog(supabase, profile.id, 'repair_status_updated', 'repair_job', record.id, { status });
      await refresh();
      setNotice('維修狀態已更新');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '更新失敗，請確認角色權限');
    } finally {
      setSavingId('');
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
  const canUpdateRepair = profile && ['admin', 'manager', 'technician'].includes(profile.role);
  const ownAttendance = records.find((record) => record.data?.employee_id === profile?.id && record.data?.punch_id && !record.data?.clocked_out_at);
  const canShowActions = (moduleKey === 'inventory' && canEditInventory) || (moduleKey === 'repairs' && canUpdateRepair);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">STORE OPERATIONS</p><h1 className="mt-2 font-display text-[32px] leading-tight">{config.title}</h1><p className="mt-2 text-sm text-[#77827c]">{config.description}</p></div>
        <div className="flex gap-2">
          {moduleKey === 'attendance' && <button disabled={attendanceBusy} onClick={() => void handleClock(ownAttendance ? 'out' : 'in')} className="h-10 rounded-md bg-ink px-3.5 text-xs font-semibold text-white disabled:opacity-60">{ownAttendance ? '下班打卡' : '上班打卡'}</button>}
          {config.addLabel && <button onClick={openCreate} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3.5 text-xs font-semibold text-white hover:bg-fern"><Plus size={15} />{config.addLabel}</button>}
          <button onClick={() => void refresh()} aria-label="重新載入" className="grid h-10 w-10 place-items-center rounded-md border border-[#dce2db] bg-white hover:border-ink"><RefreshCw size={15} /></button>
        </div>
      </section>
      {error && <div role="alert" className="rounded-md border border-[#f0c5b8] bg-[#fff8f5] px-4 py-3 text-sm text-[#a84834]">{error}</div>}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] px-4 py-4 md:px-5"><div><p className="eyebrow">{loading ? '讀取中' : `${filteredRecords.length} 筆資料`}</p><h2 className="mt-1 text-base font-semibold">{config.title}清單</h2></div><label className="flex h-9 w-full max-w-[260px] items-center gap-2 rounded-md border border-[#dfe5de] bg-white px-3 focus-within:border-fern"><Search size={15} className="shrink-0 text-[#89928d]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋資料..." className="w-full border-0 bg-transparent p-0 text-xs outline-none placeholder:text-[#a0a8a2] focus:ring-0" /></label></div>
        <div className="overflow-x-auto"><div className="min-w-[660px]"><div className="data-row grid gap-3 bg-[#fafbf9] px-5 py-3 text-[10px] font-semibold text-[#87918a]" style={{ gridTemplateColumns: `repeat(${config.columns.length}, minmax(0, 1fr)) ${canShowActions ? '150px' : ''}` }}>{config.columns.map((column) => <span key={column}>{column}</span>)}{canShowActions && <span>操作</span>}</div>
          {loading && <div className="px-5 py-12 text-center text-sm text-[#87918a]">正在從 Supabase 載入…</div>}
          {!loading && filteredRecords.map((record) => <div key={record.id} className="data-row min-h-[58px] gap-3 px-5 py-3 text-xs" style={{ gridTemplateColumns: `repeat(${config.columns.length}, minmax(0, 1fr)) ${canShowActions ? '150px' : ''}` }}>{record.cells.map((cell, cellIndex) => <span key={`${cell}-${cellIndex}`} className="truncate" title={cell}>{cellIndex === record.cells.length - 1 ? <span className={`status-pill ${statusTone(cell)}`}>{cell}</span> : <span className={cellIndex === 0 ? 'font-semibold text-ink' : 'text-[#65716b]'}>{cell}</span>}</span>)}
            {moduleKey === 'inventory' && canEditInventory && <span className="flex items-center gap-2"><button onClick={() => openEdit(record)} className="text-xs font-semibold text-fern hover:underline">編輯品項</button></span>}
            {moduleKey === 'repairs' && canUpdateRepair && <span className="flex items-center gap-1"><select aria-label={`${record.cells[0]}維修狀態`} value={pendingValues[record.id] ?? record.editableValue} onChange={(event) => setPendingValues((current) => ({ ...current, [record.id]: event.target.value }))} className="h-8 min-w-0 rounded border-[#dfe5de] bg-white text-xs">{repairStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select><button disabled={savingId === record.id || (pendingValues[record.id] ?? record.editableValue) === record.editableValue} onClick={() => void saveRepairStatus(record)} className="text-xs font-semibold text-fern disabled:opacity-40">儲存</button></span>}
          </div>)}
          {!loading && !error && filteredRecords.length === 0 && <div className="px-5 py-14 text-center text-sm text-[#87918a]">目前沒有資料</div>}
          </div></div>
        <div className="flex items-center justify-between border-t border-[#edf0eb] px-5 py-3 text-[11px] text-[#87918a]"><span>{loading ? '等待資料' : `顯示 ${filteredRecords.length} 筆資料`}</span><span>來源：Supabase</span></div>
      </section>
      {notice && <div role="status" className="fixed bottom-5 right-5 z-50 rounded-md bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg">{notice}</div>}
      {modalOpen && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}><form onSubmit={form.handleSubmit((values) => submitForm(values))} noValidate className="my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"><div className="mb-5 flex items-start justify-between"><div><p className="eyebrow">{editing ? 'EDIT RECORD' : 'NEW RECORD'}</p><h2 className="mt-1 text-lg font-semibold">{editing ? '編輯資料' : config.addLabel}</h2></div><button type="button" onClick={() => setModalOpen(false)} aria-label="關閉" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div><div className="grid gap-4 sm:grid-cols-2">{config.fields.map((field) => { const fieldError = form.formState.errors[field.key]?.message; return <label key={field.key} className="text-xs font-semibold text-[#56635c]">{field.label}{field.type === 'select' ? <select {...form.register(field.key)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm"><option value="">請選擇</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input type={field.type} {...form.register(field.key)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm focus:border-fern focus:ring-fern" />}{fieldError && <span role="alert" className="mt-1 block text-[11px] text-coral">{String(fieldError)}</span>}</label>; })}</div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setModalOpen(false)} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">取消</button><button disabled={form.formState.isSubmitting} className="h-9 rounded-md bg-ink px-4 text-xs font-semibold text-white hover:bg-fern disabled:opacity-60">{editing ? '儲存變更' : '建立資料'}</button></div></form></div>}
    </div>
  );
}
