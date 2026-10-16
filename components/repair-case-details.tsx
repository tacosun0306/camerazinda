'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { repairStatuses } from '@/lib/modules';

type Role = 'admin' | 'manager' | 'sales' | 'technician';
export type RepairJobDetails = {
  id: string;
  case_number: string;
  customer_name: string;
  customer_phone: string;
  brand: string | null;
  item_name: string;
  model: string | null;
  serial_number: string | null;
  issue: string;
  due_at: string | null;
  status: string;
  priority: string;
  priority_reason: string | null;
  priority_due_at: string | null;
  priority_assigned_to: string | null;
  store_name: string;
  created_by: string;
  created_at: string;
  customer_confirmation_status: string;
  quote_version: number;
  [key: string]: unknown;
};
type Profile = { id: string; full_name: string; role: Role };
type QuoteItem = { item_name: string; quantity: string; unit_price: string; notes: string };
type Quote = {
  id: string;
  version: number;
  quote_status: string;
  customer_decision: string;
  total_amount: number | string;
  estimated_days: number | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  submitted_at: string;
  responded_by: string | null;
  responded_at: string | null;
  response_note: string | null;
};
type QuoteLine = { id: string; quote_id: string; line_number: number; item_name: string; quantity: number | string; unit_price: number | string; subtotal: number | string; notes: string | null };
type Event = { id: string; event_type: string; summary: string; before_values: Record<string, unknown>; after_values: Record<string, unknown>; actor_id: string | null; created_at: string };
type RepairNotification = { id: string; notification_type: string; recipient_id: string | null; recipient_role: string | null; status: string; created_at: string; resolved_at: string | null };

const currency = new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 });
const fieldLabels: Record<string, string> = {
  customer_name: '客戶姓名', customer_phone: '聯絡電話', brand: '品牌', item_name: '品項', model: '型號',
  serial_number: '序號', issue: '故障描述', due_at: '預計完成日期', accessories: '隨附配件',
  appearance_condition: '外觀狀況', inspection_person_id: '檢測人員', inspection_at: '檢測日期',
  fault_cause: '故障原因', inspection_result: '檢測結果', recommended_repair: '建議維修方式',
  inspection_notes: '檢測備註', actual_repair_items: '實際維修項目', replacement_parts: '更換零件',
  repair_result: '維修結果', repaired_at: '完修日期', repaired_by: '維修人員',
};
const basicFields = ['customer_name', 'customer_phone', 'brand', 'item_name', 'model', 'serial_number', 'issue', 'due_at', 'accessories', 'appearance_condition'];
const inspectionFields = ['inspection_person_id', 'inspection_at', 'fault_cause', 'inspection_result', 'recommended_repair', 'inspection_notes'];
const repairFields = ['actual_repair_items', 'replacement_parts', 'repair_result', 'repaired_at', 'repaired_by'];
const terminalStatuses = ['picked_up', 'repair_cancelled', 'unrepairable'];
const statusLabel = (value: string) => repairStatuses.find((item) => item.value === value)?.label ?? value;
const localDateTime = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const formatDateTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-TW') : '—';
const displayValue = (value: unknown) => value == null || value === '' ? '—' : String(value);

function nextStatuses(role: Role, job: RepairJobDetails) {
  if (role === 'sales') {
    const transitions: Record<string, string[]> = {
      store_created: ['store_shipped', 'repair_cancelled'],
      returned_to_store: ['store_received'],
      store_received: ['customer_notified'],
      customer_notified: ['picked_up'],
    };
    return transitions[job.status] ?? [];
  }
  if (role === 'technician') {
    const transitions: Record<string, string[]> = {
      store_shipped: ['repair_received'],
      repair_received: ['diagnosing'],
      quote_pending_customer: job.customer_confirmation_status === 'approved' ? ['repairing'] : [],
      repairing: ['paused', 'repair_completed', 'unrepairable'],
      paused: ['repairing', 'repair_cancelled', 'unrepairable'],
      repair_completed: ['returned_to_store'],
    };
    return transitions[job.status] ?? [];
  }
  if (role === 'admin' || role === 'manager') {
    const transitions: Record<string, string[]> = {
      store_created: ['store_shipped'],
      store_shipped: ['repair_received'],
      repair_received: ['diagnosing'],
      quote_pending_customer: job.customer_confirmation_status === 'approved' ? ['repairing'] : [],
      repairing: ['paused', 'repair_completed', 'unrepairable'],
      paused: ['repairing', 'unrepairable'],
      repair_completed: ['returned_to_store'],
      returned_to_store: ['store_received'],
      store_received: ['customer_notified'],
      customer_notified: ['picked_up'],
    };
    const next = transitions[job.status] ?? [];
    return terminalStatuses.includes(job.status) ? next : [...new Set([...next, 'repair_cancelled'])];
  }
  return [];
}

export function RepairCaseDetails({ job, role, onClose, onSaved }: { job: RepairJobDetails; role: Role; onClose: () => void; onSaved: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteLines, setQuoteLines] = useState<QuoteLine[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [notifications, setNotifications] = useState<RepairNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [priority, setPriority] = useState(job.priority ?? 'normal');
  const [priorityReason, setPriorityReason] = useState(job.priority_reason ?? '');
  const [priorityDueAt, setPriorityDueAt] = useState(localDateTime(job.priority_due_at));
  const [priorityAssignee, setPriorityAssignee] = useState(job.priority_assigned_to ?? '');
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([{ item_name: '', quantity: '1', unit_price: '0', notes: '' }]);
  const [estimatedDays, setEstimatedDays] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [quoteRequestKey, setQuoteRequestKey] = useState('');
  const [responseNote, setResponseNote] = useState('');
  const [transitionTarget, setTransitionTarget] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [notificationMethod, setNotificationMethod] = useState('phone');
  const [notificationResult, setNotificationResult] = useState('');

  const editableFields = useMemo(() => {
    if (role === 'sales') return new Set(basicFields);
    if (role === 'technician') return new Set([...inspectionFields, ...repairFields]);
    return new Set([...basicFields, ...inspectionFields, ...repairFields]);
  }, [role]);
  const latestQuote = quotes[0];
  const itemsByQuote = useMemo(() => {
    const result = new Map<string, QuoteLine[]>();
    quoteLines.forEach((line) => result.set(line.quote_id, [...(result.get(line.quote_id) ?? []), line]));
    return result;
  }, [quoteLines]);
  const quoteTotal = quoteItems.reduce((total, item) => total + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0);
  const allowedNextStatuses = nextStatuses(role, job);
  const canQuote = ['admin', 'manager', 'technician'].includes(role) && ['diagnosing', 'quoting', 'quote_pending_customer', 'waiting_customer', 'repairing'].includes(job.status);
  const canRespond = ['admin', 'manager', 'sales'].includes(role) && latestQuote?.quote_status === 'submitted' && latestQuote.customer_decision === 'pending';

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;
    async function loadDetail() {
      setLoading(true);
      setError('');
      const [profileResult, quoteResult, eventResult, notificationResult] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role').eq('active', true).order('full_name'),
        supabase.from('repair_quotes').select('id, version, quote_status, customer_decision, total_amount, estimated_days, notes, created_by, created_at, submitted_at, responded_by, responded_at, response_note').eq('repair_job_id', job.id).order('version', { ascending: false }),
        supabase.from('repair_job_events').select('id, event_type, summary, before_values, after_values, actor_id, created_at').eq('repair_job_id', job.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('repair_notifications').select('id, notification_type, recipient_id, recipient_role, status, created_at, resolved_at').eq('repair_job_id', job.id).order('created_at', { ascending: false }),
      ]);
      const firstError = profileResult.error ?? quoteResult.error ?? eventResult.error ?? notificationResult.error;
      if (firstError) {
        if (active) setError(firstError.message);
        setLoading(false);
        return;
      }
      const quoteIds = (quoteResult.data ?? []).map((quote) => quote.id);
      const linesResult = quoteIds.length
        ? await supabase.from('repair_quote_items').select('id, quote_id, line_number, item_name, quantity, unit_price, subtotal, notes').in('quote_id', quoteIds).order('line_number')
        : { data: [], error: null };
      if (linesResult.error) {
        if (active) setError(linesResult.error.message);
      } else if (active) {
        setProfiles((profileResult.data ?? []) as Profile[]);
        setQuotes((quoteResult.data ?? []) as Quote[]);
        setQuoteLines((linesResult.data ?? []) as QuoteLine[]);
        setEvents((eventResult.data ?? []) as Event[]);
        setNotifications((notificationResult.data ?? []) as RepairNotification[]);
      }
      if (active) setLoading(false);
    }
    const initialValues: Record<string, string> = {};
    [...basicFields, ...inspectionFields, ...repairFields].forEach((key) => {
      const value = job[key];
      initialValues[key] = key === 'due_at'
        ? typeof value === 'string' ? value.slice(0, 10) : ''
        : key.endsWith('_at') ? localDateTime(typeof value === 'string' ? value : null) : displayValue(value) === '—' ? '' : String(value);
    });
    setValues(initialValues);
    setPriority(job.priority ?? 'normal');
    setPriorityReason(job.priority_reason ?? '');
    setPriorityDueAt(localDateTime(job.priority_due_at));
    setPriorityAssignee(job.priority_assigned_to ?? '');
    void loadDetail();
    return () => { active = false; };
  }, [job]);

  function setField(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function updateQuoteItem(index: number, patch: Partial<QuoteItem>) {
    setQuoteRequestKey('');
    setQuoteItems((items) => items.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  async function saveChanges(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const changes = Object.fromEntries([...editableFields].map((key) => [
        key,
        key !== 'due_at' && key.endsWith('_at') && values[key] ? new Date(values[key]).toISOString() : values[key] ?? '',
      ]));
      const { error: updateError } = await createSupabaseBrowserClient().rpc('update_repair_job', { p_repair_job_id: job.id, p_changes: changes });
      if (updateError) throw updateError;
      setNotice('案件資料已儲存並記錄歷程');
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '案件儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  async function savePriority(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { error: priorityError } = await createSupabaseBrowserClient().rpc('set_repair_priority', {
        p_repair_job_id: job.id,
        p_priority: priority,
        p_reason: priorityReason,
        p_due_at: priorityDueAt ? new Date(priorityDueAt).toISOString() : null,
        p_assigned_to: priorityAssignee || null,
      });
      if (priorityError) throw priorityError;
      setNotice('急件資訊已更新');
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '急件資訊儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  async function submitQuote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const requestKey = quoteRequestKey || crypto.randomUUID();
    setQuoteRequestKey(requestKey);
    try {
      const cleanItems = quoteItems.map((item) => ({ ...item, quantity: Number(item.quantity), unit_price: Number(item.unit_price) }));
      const { error: quoteError } = await createSupabaseBrowserClient().rpc('submit_repair_quote', {
        p_repair_job_id: job.id,
        p_request_key: requestKey,
        p_items: cleanItems,
        p_estimated_days: estimatedDays ? Number(estimatedDays) : null,
        p_notes: quoteNotes,
      });
      if (quoteError) throw quoteError;
      setQuoteItems([{ item_name: '', quantity: '1', unit_price: '0', notes: '' }]);
      setQuoteRequestKey('');
      setNotice('報價已提交，舊版本保留於歷程');
      await onSaved();
      await reloadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '報價提交失敗');
    } finally {
      setSaving(false);
    }
  }

  async function respondToQuote(decision: 'approved' | 'declined' | 'cancelled') {
    if (!latestQuote) return;
    setSaving(true);
    setError('');
    try {
      const { error: responseError } = await createSupabaseBrowserClient().rpc('respond_repair_quote', {
        p_quote_id: latestQuote.id,
        p_decision: decision,
        p_note: responseNote,
      });
      if (responseError) throw responseError;
      setNotice('客戶決定已記錄於案件歷程');
      await onSaved();
      await reloadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '客戶決定儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transitionTarget) return;
    setSaving(true);
    setError('');
    const payload: Record<string, string> = {};
    if (transitionTarget === 'store_shipped' || transitionTarget === 'returned_to_store') payload.tracking_number = trackingNumber;
    if (transitionTarget === 'customer_notified') {
      payload.notification_method = notificationMethod;
      payload.notification_result = notificationResult;
    }
    try {
      const { error: transitionError } = await createSupabaseBrowserClient().rpc('transition_repair_job', {
        p_repair_job_id: job.id,
        p_target_status: transitionTarget,
        p_payload: payload,
      });
      if (transitionError) throw transitionError;
      setNotice('狀態已更新並記錄歷程');
      setTrackingNumber('');
      setNotificationResult('');
      setTransitionTarget('');
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '狀態更新失敗');
    } finally {
      setSaving(false);
    }
  }

  async function reloadDetail() {
    const supabase = createSupabaseBrowserClient();
    const [quotesResult, eventsResult, notificationResult] = await Promise.all([
      supabase.from('repair_quotes').select('id, version, quote_status, customer_decision, total_amount, estimated_days, notes, created_by, created_at, submitted_at, responded_by, responded_at, response_note').eq('repair_job_id', job.id).order('version', { ascending: false }),
      supabase.from('repair_job_events').select('id, event_type, summary, before_values, after_values, actor_id, created_at').eq('repair_job_id', job.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('repair_notifications').select('id, notification_type, recipient_id, recipient_role, status, created_at, resolved_at').eq('repair_job_id', job.id).order('created_at', { ascending: false }),
    ]);
    if (quotesResult.error || eventsResult.error || notificationResult.error) {
      setError(quotesResult.error?.message ?? eventsResult.error?.message ?? notificationResult.error?.message ?? '更新詳情失敗');
      return;
    }
    const quoteIds = (quotesResult.data ?? []).map((quote) => quote.id);
    const linesResult = quoteIds.length
      ? await supabase.from('repair_quote_items').select('id, quote_id, line_number, item_name, quantity, unit_price, subtotal, notes').in('quote_id', quoteIds).order('line_number')
      : { data: [], error: null };
    if (linesResult.error) { setError(linesResult.error.message); return; }
    setQuotes((quotesResult.data ?? []) as Quote[]);
    setQuoteLines((linesResult.data ?? []) as QuoteLine[]);
    setEvents((eventsResult.data ?? []) as Event[]);
    setNotifications((notificationResult.data ?? []) as RepairNotification[]);
  }

  function renderField(key: string) {
    const isEditable = editableFields.has(key);
    const isPerson = key === 'inspection_person_id' || key === 'repaired_by';
    const isLongText = ['issue', 'accessories', 'appearance_condition', 'fault_cause', 'inspection_result', 'recommended_repair', 'inspection_notes', 'actual_repair_items', 'replacement_parts', 'repair_result'].includes(key);
    const commonClass = `mt-1.5 w-full rounded-md border-[#dfe5de] text-sm ${isEditable ? 'bg-white' : 'bg-[#f7f8f6] text-[#68746d]'}`;
    const value = values[key] ?? '';
    return <label key={key} className="text-xs font-semibold text-[#56635c]">{fieldLabels[key]}{isPerson ? <select disabled={!isEditable} value={value} onChange={(event) => setField(key, event.target.value)} className={`${commonClass} h-10`}><option value="">未指定</option>{profiles.map((person) => <option key={person.id} value={person.id}>{person.full_name} · {person.role}</option>)}</select> : isLongText ? <textarea disabled={!isEditable} rows={2} value={value} onChange={(event) => setField(key, event.target.value)} className={`${commonClass} resize-y`} /> : <input disabled={!isEditable} type={key === 'due_at' ? 'date' : key.endsWith('_at') ? 'datetime-local' : 'text'} value={value} onChange={(event) => setField(key, event.target.value)} className={`${commonClass} h-10`} />}</label>;
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-2 sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="repair-detail-title" className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-[#f7f8f6] shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-[#e2e7e0] bg-white px-5 py-4 sm:px-7"><div><p className="eyebrow">REPAIR CASE · {job.case_number}</p><h2 id="repair-detail-title" className="mt-1 font-display text-xl">{job.customer_name} · {job.item_name}</h2><p className="mt-1 text-xs text-[#78827c]">{job.store_name} · {statusLabel(job.status)} · {job.priority === 'urgent' ? '急件' : job.priority === 'priority' ? '優先' : '一般'}</p></div><button type="button" onClick={onClose} aria-label="關閉案件詳情" className="grid h-9 w-9 shrink-0 place-items-center rounded-md hover:bg-[#f3f5f0]"><X size={18} /></button></header>
      <div className="overflow-y-auto p-4 sm:p-6">
        {error && <p role="alert" className="mb-4 rounded-md border border-[#f0c5b8] bg-[#fff8f5] px-4 py-3 text-sm text-[#a84834]">{error}</p>}
        {notice && <p role="status" className="mb-4 rounded-md border border-[#cbdccf] bg-[#eaf2e9] px-4 py-3 text-sm text-fern">{notice}</p>}
        <div className="grid gap-4 xl:grid-cols-2">
          <form onSubmit={saveChanges} className="panel space-y-5 p-4 sm:p-5">
            <section><h3 className="text-sm font-semibold">A. 基本資料</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><ReadOnly label="案件編號" value={job.case_number} /><ReadOnly label="建立時間" value={formatDateTime(job.created_at)} /><ReadOnly label="建立人員" value={profiles.find((person) => person.id === job.created_by)?.full_name ?? job.created_by} /><ReadOnly label="門市" value={job.store_name} />{basicFields.map(renderField)}</div></section>
            <section><h3 className="text-sm font-semibold">B. 檢測紀錄</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{inspectionFields.map(renderField)}</div></section>
            <section><h3 className="text-sm font-semibold">D. 維修紀錄</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{repairFields.map(renderField)}</div></section>
            {editableFields.size > 0 && <div className="flex justify-end border-t border-[#edf0eb] pt-4"><button disabled={saving || loading} className="h-9 rounded-md bg-ink px-4 text-xs font-semibold text-white disabled:opacity-50">儲存案件資料</button></div>}
          </form>

          <div className="space-y-4">
            <form onSubmit={savePriority} className="panel space-y-3 p-4 sm:p-5"><div><p className="eyebrow">PRIORITY</p><h3 className="mt-1 text-sm font-semibold">E. 急件與指派</h3></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">急件等級<select value={priority} onChange={(event) => setPriority(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm"><option value="normal">一般</option><option value="priority">優先</option><option value="urgent">急件</option></select></label><label className="text-xs font-semibold">指定處理人員<select value={priorityAssignee} onChange={(event) => setPriorityAssignee(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm"><option value="">依角色待辦</option>{profiles.map((person) => <option key={person.id} value={person.id}>{person.full_name} · {person.role}</option>)}</select></label><label className="text-xs font-semibold">希望完成時間<input type="datetime-local" value={priorityDueAt} onChange={(event) => setPriorityDueAt(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" /></label><label className="text-xs font-semibold">急件原因<input value={priorityReason} onChange={(event) => setPriorityReason(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" /></label><ReadOnly label="急件建立人員" value={profiles.find((person) => person.id === job.priority_created_by)?.full_name ?? job.priority_created_by} /><ReadOnly label="急件建立時間" value={formatDateTime(typeof job.priority_created_at === 'string' ? job.priority_created_at : null)} /></div><button disabled={saving} className="h-9 rounded-md border border-[#dce2db] bg-white px-3 text-xs font-semibold disabled:opacity-50">儲存急件設定</button><p className="text-[11px] text-[#78827c]">系統會建立可追蹤的站內待辦，不會假稱已寄送外部訊息。</p></form>

            <section className="panel p-4 sm:p-5"><div><p className="eyebrow">QUOTE</p><h3 className="mt-1 text-sm font-semibold">C. 維修報價明細</h3></div>
              {quotes.map((quote) => <div key={quote.id} className="mt-3 rounded-md border border-[#e5e9e3] bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold">報價 v{quote.version} · {quote.customer_decision === 'pending' ? '待確認' : quote.customer_decision === 'approved' ? '同意維修' : quote.customer_decision === 'declined' ? '不同意維修' : '取消維修'}</p><p className="mt-1 text-[10px] text-[#78827c]">{formatDateTime(quote.created_at)} · {profiles.find((person) => person.id === quote.created_by)?.full_name ?? '員工'} · 預估 {quote.estimated_days ?? '—'} 天</p></div><strong className="text-sm">{currency.format(Number(quote.total_amount))}</strong></div><ul className="mt-2 space-y-1">{(itemsByQuote.get(quote.id) ?? []).map((item) => <li key={item.id} className="flex justify-between gap-3 text-[11px] text-[#65716b]"><span>{item.item_name} × {item.quantity}{item.notes ? ` · ${item.notes}` : ''}</span><span>{currency.format(Number(item.subtotal))}</span></li>)}</ul>{quote.notes && <p className="mt-2 text-[11px] text-[#65716b]">{quote.notes}</p>}</div>)}
              {canQuote && <form onSubmit={submitQuote} className="mt-4 space-y-3 border-t border-[#edf0eb] pt-4"><p className="text-xs font-semibold">新增報價版本 {job.quote_version + 1}</p><div className="space-y-2 overflow-x-auto">{quoteItems.map((item, index) => <div key={index} className="grid min-w-[560px] grid-cols-[1.2fr_.55fr_.7fr_1fr_auto] gap-2"><input aria-label="報價項目名稱" placeholder="項目名稱" value={item.item_name} onChange={(event) => updateQuoteItem(index, { item_name: event.target.value })} className="h-9 min-w-0 rounded-md border-[#dfe5de] text-xs" /><input aria-label="數量" type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => updateQuoteItem(index, { quantity: event.target.value })} className="h-9 min-w-0 rounded-md border-[#dfe5de] text-xs" /><input aria-label="單價" type="number" min="0" step="1" value={item.unit_price} onChange={(event) => updateQuoteItem(index, { unit_price: event.target.value })} className="h-9 min-w-0 rounded-md border-[#dfe5de] text-xs" /><input aria-label="報價項目備註" placeholder="備註（選填）" value={item.notes} onChange={(event) => updateQuoteItem(index, { notes: event.target.value })} className="h-9 min-w-0 rounded-md border-[#dfe5de] text-xs" /><button type="button" aria-label="刪除此報價項目" disabled={quoteItems.length === 1} onClick={() => { setQuoteRequestKey(''); setQuoteItems((items) => items.filter((_, lineIndex) => lineIndex !== index)); }} className="grid h-9 w-9 place-items-center rounded-md border border-[#dfe5de] disabled:opacity-40"><X size={14} /></button></div>)}</div><button type="button" onClick={() => { setQuoteRequestKey(''); setQuoteItems((items) => [...items, { item_name: '', quantity: '1', unit_price: '0', notes: '' }]); }} className="inline-flex items-center gap-1 text-xs font-semibold text-fern"><Plus size={14} />新增項目</button><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-semibold">預估工期（天）<input type="number" min="0" value={estimatedDays} onChange={(event) => { setQuoteRequestKey(''); setEstimatedDays(event.target.value); }} className="mt-1 h-9 w-full rounded-md border-[#dfe5de] text-xs" /></label><label className="text-xs font-semibold">報價備註<input value={quoteNotes} onChange={(event) => { setQuoteRequestKey(''); setQuoteNotes(event.target.value); }} className="mt-1 h-9 w-full rounded-md border-[#dfe5de] text-xs" /></label></div><div className="flex items-center justify-between border-t border-[#edf0eb] pt-3"><span className="text-xs text-[#65716b]">合計</span><strong className="text-sm">{currency.format(quoteTotal)}</strong></div><button disabled={saving || quoteItems.some((item) => !item.item_name.trim() || Number(item.quantity) <= 0 || Number(item.unit_price) < 0)} className="h-9 rounded-md bg-ink px-3 text-xs font-semibold text-white disabled:opacity-50">提交並建立版本</button></form>}
              {canRespond && <div className="mt-4 space-y-2 border-t border-[#edf0eb] pt-4"><label className="text-xs font-semibold">客戶決定備註<input value={responseNote} onChange={(event) => setResponseNote(event.target.value)} className="mt-1 h-9 w-full rounded-md border-[#dfe5de] text-xs" /></label><div className="flex flex-wrap gap-2"><button disabled={saving} onClick={() => void respondToQuote('approved')} className="h-9 rounded-md bg-fern px-3 text-xs font-semibold text-white">同意維修</button><button disabled={saving} onClick={() => void respondToQuote('declined')} className="h-9 rounded-md border border-[#dce2db] bg-white px-3 text-xs font-semibold">不同意維修</button><button disabled={saving} onClick={() => void respondToQuote('cancelled')} className="h-9 rounded-md border border-[#f0c5b8] bg-white px-3 text-xs font-semibold text-[#bd5039]">取消維修</button></div></div>}
              {quotes.length === 0 && !canQuote && <p className="mt-3 text-xs text-[#78827c]">尚無報價版本。</p>}
            </section>

            <section className="panel space-y-3 p-4 sm:p-5"><div><p className="eyebrow">LOGISTICS</p><h3 className="mt-1 text-sm font-semibold">E. 寄送、取件與通知紀錄</h3></div><div className="grid gap-2 sm:grid-cols-2"><ReadOnly label="門市寄出" value={formatDateTime(typeof job.store_shipped_at === 'string' ? job.store_shipped_at : null)} /><ReadOnly label="門市寄出單號" value={job.store_tracking_number} /><ReadOnly label="維修部收件" value={formatDateTime(typeof job.repair_received_at === 'string' ? job.repair_received_at : null)} /><ReadOnly label="維修部寄回" value={formatDateTime(typeof job.repair_shipped_back_at === 'string' ? job.repair_shipped_back_at : null)} /><ReadOnly label="寄回單號" value={job.return_tracking_number} /><ReadOnly label="門市收件" value={formatDateTime(typeof job.store_received_at === 'string' ? job.store_received_at : null)} /><ReadOnly label="通知客戶" value={formatDateTime(typeof job.customer_notified_at === 'string' ? job.customer_notified_at : null)} /><ReadOnly label="通知方式／結果" value={[job.notification_method, job.notification_result].filter(Boolean).join(' · ')} /><ReadOnly label="客戶取件" value={formatDateTime(typeof job.picked_up_at === 'string' ? job.picked_up_at : null)} /></div></section>
            <form onSubmit={changeStatus} className="panel space-y-3 p-4 sm:p-5"><div><p className="eyebrow">WORKFLOW</p><h3 className="mt-1 text-sm font-semibold">F. 案件狀態</h3></div><p className="text-xs text-[#65716b]">目前：{statusLabel(job.status)}{job.customer_confirmation_status === 'approved' ? ' · 客戶已同意' : job.customer_confirmation_status === 'declined' ? ' · 客戶不同意' : job.customer_confirmation_status === 'cancelled' ? ' · 客戶取消' : ''}</p>{allowedNextStatuses.length > 0 ? <><label className="text-xs font-semibold">下一步<select required value={transitionTarget} onChange={(event) => setTransitionTarget(event.target.value)} className="mt-1 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm"><option value="">選擇允許的下一狀態</option>{allowedNextStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>{['store_shipped', 'returned_to_store'].includes(transitionTarget) && <label className="text-xs font-semibold">物流單號（選填）<input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} className="mt-1 h-9 w-full rounded-md border-[#dfe5de] text-xs" /></label>}{transitionTarget === 'customer_notified' && <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-semibold">通知方式<select value={notificationMethod} onChange={(event) => setNotificationMethod(event.target.value)} className="mt-1 h-9 w-full rounded-md border-[#dfe5de] bg-white text-xs"><option value="phone">電話</option><option value="sms">簡訊</option><option value="in_person">當面通知</option><option value="other">其他（自行記錄）</option></select></label><label className="text-xs font-semibold">通知結果<input value={notificationResult} onChange={(event) => setNotificationResult(event.target.value)} className="mt-1 h-9 w-full rounded-md border-[#dfe5de] text-xs" /></label></div>}<button disabled={saving || !transitionTarget} className="h-9 rounded-md bg-ink px-3 text-xs font-semibold text-white disabled:opacity-50">確認狀態變更</button></> : <p className="text-xs text-[#78827c]">目前角色沒有可執行的狀態操作。</p>}</form>

            <section className="panel p-4 sm:p-5"><div><p className="eyebrow">HISTORY</p><h3 className="mt-1 text-sm font-semibold">G. 案件歷程</h3></div>{loading ? <p className="mt-3 text-xs text-[#78827c]">載入歷程…</p> : events.length ? <ol className="mt-4 space-y-4">{events.map((event) => <li key={event.id} className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-fern" /><div className="min-w-0"><p className="text-xs font-semibold">{event.summary}</p><p className="mt-1 text-[10px] text-[#78827c]">{formatDateTime(event.created_at)} · {profiles.find((person) => person.id === event.actor_id)?.full_name ?? '系統'} · {event.event_type}</p><details className="mt-1 text-[10px] text-[#65716b]"><summary className="cursor-pointer">查看修改前後</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify({ before: event.before_values, after: event.after_values }, null, 2)}</pre></details></div></li>)}</ol> : <p className="mt-3 text-xs text-[#78827c]">尚無歷程。</p>}<div className="mt-4 border-t border-[#edf0eb] pt-3"><p className="text-xs font-semibold">站內待辦通知</p>{notifications.length ? <ul className="mt-2 space-y-2">{notifications.map((notification) => <li key={notification.id} className="flex justify-between gap-3 text-[10px] text-[#65716b]"><span>{notification.notification_type} · {notification.recipient_role ?? profiles.find((person) => person.id === notification.recipient_id)?.full_name ?? '處理人員'}</span><span>{notification.status === 'pending' ? '待處理' : '已完成'} · {formatDateTime(notification.created_at)}</span></li>)}</ul> : <p className="mt-2 text-[10px] text-[#78827c]">目前沒有待辦通知。</p>}</div></section>
          </div>
        </div>
      </div>
    </section>
  </div>;
}

function ReadOnly({ label, value }: { label: string; value: unknown }) {
  return <label className="text-xs font-semibold text-[#56635c]">{label}<input readOnly value={displayValue(value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-[#f7f8f6] text-sm text-[#68746d]" /></label>;
}