'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, Plus, Send, X } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useStaffProfile } from '@/components/app-shell';
import { addAuditLog } from '@/lib/data/workspaces';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type Shift = {
  id: string;
  employeeId: string;
  employee: string;
  date: string;
  start: string;
  end: string;
  role: string;
};

type ChangeRequest = {
  id: string;
  shiftId: string;
  employeeId: string;
  employee: string;
  date: string;
  requestedDate: string;
  requestedStart: string;
  requestedEnd: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
};

type Employee = { id: string; full_name: string; role: string; active: boolean };

const roleLabels: Record<string, string> = { admin: '系統管理員', manager: '店長', sales: '門市人員', technician: '維修技師' };
const shiftSchema = z.object({
  employeeId: z.string().uuid('請選擇有效員工'),
  date: z.string().min(1, '請選擇日期'),
  start: z.string().min(1, '請設定開始時間'),
  end: z.string().min(1, '請設定結束時間'),
}).refine((value) => value.end > value.start, { path: ['end'], message: '結束時間需晚於開始時間' });
const requestSchema = z.object({
  requestedDate: z.string().min(1, '請選擇希望調整的日期'),
  requestedStart: z.string().min(1, '請設定開始時間'),
  requestedEnd: z.string().min(1, '請設定結束時間'),
  reason: z.string().trim().min(2, '請簡述異動原因'),
}).refine((value) => value.requestedEnd > value.requestedStart, { path: ['requestedEnd'], message: '結束時間需晚於開始時間' });

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const weekDayLabels = ['日', '一', '二', '三', '四', '五', '六'];
const formatDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const displayDate = (date: string) => {
  const value = new Date(`${date}T00:00:00`);
  return `${value.getMonth() + 1}月${value.getDate()}日 週${weekDayLabels[value.getDay()]}`;
};
const toTime = (value: string) => new Date(value).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
const toTimestamp = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();

export function ScheduleCalendar() {
  const profile = useStaffProfile();
  const [visibleMonth, setVisibleMonth] = useState(() => { const date = new Date(); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'shift' | 'request' | null>(null);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [busyRequest, setBusyRequest] = useState('');
  const isManager = profile?.role === 'admin' || profile?.role === 'manager';

  const calendarDays = useMemo(() => {
    const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [visibleMonth]);

  const shiftForm = useForm<z.infer<typeof shiftSchema>>({ resolver: zodResolver(shiftSchema) });
  const requestForm = useForm<z.infer<typeof requestSchema>>({ resolver: zodResolver(requestSchema) });
  const pendingRequests = requests.filter((request) => request.status === 'pending');
  const monthShifts = shifts.filter((shift) => {
    const date = new Date(`${shift.date}T00:00:00`);
    return date.getFullYear() === visibleMonth.getFullYear() && date.getMonth() === visibleMonth.getMonth();
  });

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const supabase = createSupabaseBrowserClient();
      const firstDay = calendarDays[0];
      const afterLastDay = new Date(calendarDays[41]);
      afterLastDay.setDate(afterLastDay.getDate() + 1);
      const [shiftResult, employeeResult, requestResult] = await Promise.all([
        supabase.from('shifts').select('id, employee_id, starts_at, ends_at, status').gte('starts_at', firstDay.toISOString()).lt('starts_at', afterLastDay.toISOString()).neq('status', 'cancelled').order('starts_at'),
        supabase.from('profiles').select('id, full_name, role, active').eq('active', true).order('full_name'),
        supabase.from('shift_change_requests').select('id, shift_id, employee_id, requested_starts_at, requested_ends_at, reason, status').order('created_at', { ascending: false }).limit(100),
      ]);
      if (shiftResult.error) throw shiftResult.error;
      if (employeeResult.error) throw employeeResult.error;
      if (requestResult.error) throw requestResult.error;
      const employeeById = new Map((employeeResult.data ?? []).map((employee) => [employee.id, employee]));
      setEmployees(employeeResult.data ?? []);
      setShifts((shiftResult.data ?? []).flatMap((shift) => {
        const employee = employeeById.get(shift.employee_id);
        if (!employee) return [];
        return [{ id: shift.id, employeeId: shift.employee_id, employee: employee.full_name, role: roleLabels[employee.role] ?? employee.role, date: formatDate(new Date(shift.starts_at)), start: toTime(shift.starts_at), end: toTime(shift.ends_at) }];
      }));
      setRequests((requestResult.data ?? []).flatMap((request) => {
        const employee = employeeById.get(request.employee_id);
        if (!employee) return [];
        return [{
          id: request.id,
          shiftId: request.shift_id,
          employeeId: request.employee_id,
          employee: employee.full_name,
          date: '',
          requestedDate: formatDate(new Date(request.requested_starts_at)),
          requestedStart: toTime(request.requested_starts_at),
          requestedEnd: toTime(request.requested_ends_at),
          reason: request.reason,
          status: request.status,
        } as ChangeRequest];
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '無法載入排班資料');
      setShifts([]);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [visibleMonth]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  }

  async function createShift(values: z.infer<typeof shiftSchema>) {
    if (!profile?.id) return;
    setError('');
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: insertError } = await supabase.from('shifts').insert({
        employee_id: values.employeeId,
        starts_at: toTimestamp(values.date, values.start),
        ends_at: toTimestamp(values.date, values.end),
        status: 'scheduled',
      }).select('id').single();
      if (insertError) throw insertError;
      await addAuditLog(supabase, profile.id, 'shift_created', 'shift', data.id, { employee_id: values.employeeId, date: values.date });
      shiftForm.reset();
      setModal(null);
      await refresh();
      flash('班別已加入月曆');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '排班失敗，請確認店長權限');
    }
  }

  async function submitRequest(values: z.infer<typeof requestSchema>) {
    if (!selectedShift || !profile?.id) return;
    setError('');
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: insertError } = await supabase.from('shift_change_requests').insert({
        shift_id: selectedShift.id,
        employee_id: profile.id,
        requested_starts_at: toTimestamp(values.requestedDate, values.requestedStart),
        requested_ends_at: toTimestamp(values.requestedDate, values.requestedEnd),
        reason: values.reason,
      });
      if (insertError) throw insertError;
      await addAuditLog(supabase, profile.id, 'shift_change_requested', 'shift', selectedShift.id, { requested_date: values.requestedDate });
      requestForm.reset();
      setSelectedShift(null);
      setModal(null);
      await refresh();
      flash('異動申請已送出，待店長確認');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '申請送出失敗');
    }
  }

  async function reviewRequest(requestId: string, approved: boolean) {
    if (!profile?.id) return;
    setBusyRequest(requestId);
    setError('');
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: reviewError } = await supabase.rpc('review_shift_change_request', { p_request_id: requestId, p_approved: approved });
      if (reviewError) throw reviewError;
      await refresh();
      flash(approved ? '已核准，月曆班表已更新' : '已婉拒異動申請');
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : '審核失敗，請確認店長權限');
    } finally {
      setBusyRequest('');
    }
  }

  function changeMonth(amount: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }

  function openRequest(shift: Shift) {
    setSelectedShift(shift);
    requestForm.reset({ requestedDate: shift.date, requestedStart: shift.start, requestedEnd: shift.end, reason: '' });
    setModal('request');
  }

  function openShiftForm() {
    const employeeId = employees.find((employee) => employee.id === profile?.id)?.id ?? '';
    const date = formatDate(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1));
    shiftForm.reset({ employeeId, date, start: '10:00', end: '18:30' });
    setModal('shift');
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">TEAM SCHEDULING</p><h1 className="mt-2 font-display text-[32px] leading-tight">排班月曆</h1><p className="mt-2 text-sm text-[#77827c]">所有員工可查看班表；員工異動申請須由店長核准。</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-[#dce2db] bg-white px-3 py-2 text-xs font-semibold">{profile ? roleLabels[profile.role] : '載入員工身分…'}</span>
          {isManager && <button onClick={openShiftForm} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3.5 text-xs font-semibold text-white hover:bg-fern"><Plus size={15} />安排班別</button>}
        </div>
      </section>

      {error && <div role="alert" className="rounded-md border border-[#f0c5b8] bg-[#fff8f5] px-4 py-3 text-sm text-[#a84834]">{error}</div>}
      {loading && <p className="text-xs text-[#78827c]">正在載入 Supabase 排班資料…</p>}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] px-4 py-4 sm:px-5">
            <div><p className="eyebrow">MONTHLY ROSTER</p><h2 className="mt-1 text-lg font-semibold">{visibleMonth.getFullYear()} 年 {visibleMonth.getMonth() + 1} 月</h2></div>
            <div className="flex items-center gap-1"><button onClick={() => changeMonth(-1)} aria-label="上個月" className="grid h-9 w-9 place-items-center rounded-md hover:bg-canvas"><ArrowLeft size={17} /></button><button onClick={() => { const date = new Date(); setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1)); }} className="h-9 rounded-md border border-[#dce2db] px-3 text-xs font-semibold hover:border-ink">本月</button><button onClick={() => changeMonth(1)} aria-label="下個月" className="grid h-9 w-9 place-items-center rounded-md hover:bg-canvas"><ArrowRight size={17} /></button></div>
          </div>
          <div className="grid grid-cols-7 border-b border-[#edf0eb] bg-[#fafbf9]">{weekdays.map((day, index) => <div key={day} className={`py-2.5 text-center text-xs font-semibold ${index > 4 ? 'text-coral' : 'text-[#77827c]'}`}>{day}<span className="hidden sm:inline">曜日</span></div>)}</div>
          <div className="grid grid-cols-7">
            {calendarDays.map((date) => {
              const key = formatDate(date);
              const dayShifts = shifts.filter((shift) => shift.date === key);
              const inMonth = date.getMonth() === visibleMonth.getMonth();
              const today = key === formatDate(new Date());
              return <div key={key} className={`min-h-[92px] border-b border-r border-[#edf0eb] p-1.5 sm:min-h-[128px] sm:p-2 ${inMonth ? 'bg-white' : 'bg-[#fafbf9]'}`}>
                <div className="mb-1 flex items-center justify-between"><span className={`grid h-7 w-7 place-items-center rounded-full text-xs ${today ? 'bg-ink font-bold text-white' : inMonth ? 'text-ink' : 'text-[#b3bbb5]'}`}>{date.getDate()}</span>{dayShifts.length > 0 && <span className="text-[10px] text-[#88938b]">{dayShifts.length}<span className="hidden sm:inline"> 班</span></span>}</div>
                <div className="space-y-1">{dayShifts.slice(0, 3).map((shift) => <button key={shift.id} onClick={() => isManager ? setSelectedShift(shift) : shift.employeeId === profile?.id ? openRequest(shift) : undefined} disabled={!isManager && shift.employeeId !== profile?.id} title={isManager ? `${shift.employee} ${shift.start}–${shift.end}` : shift.employeeId === profile?.id ? '點選提出異動' : shift.employee} className={`block w-full truncate rounded border-l-2 px-1.5 py-1 text-left text-[10px] leading-tight disabled:cursor-default sm:text-xs ${shift.employeeId === profile?.id ? 'border-fern bg-[#e6efe8] text-fern' : 'border-[#5b8294] bg-[#e7f0f3] text-[#355f71]'}`}><span className="font-semibold">{shift.employee}</span><span className="hidden sm:inline"> · {shift.start}</span></button>)}{dayShifts.length > 3 && <span className="block px-1 text-[10px] text-[#77827c]">另有 {dayShifts.length - 3} 班</span>}</div>
              </div>;
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-3 text-[11px] text-[#65716b] sm:px-5"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-fern" />我的班別</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#5b8294]" />其他同仁</span></div>
        </div>

        <aside className="space-y-4">
          <div className="panel p-4 sm:p-5">
            <div className="flex items-start justify-between"><div><p className="eyebrow">{visibleMonth.getMonth() + 1} 月概況</p><h2 className="mt-1 text-base font-semibold">本月班表</h2></div><CalendarDays size={18} className="text-fern" /></div>
            <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-md bg-[#f3f5f0] p-3"><span className="block text-xs text-[#77827c]">排定班次</span><span className="mt-1 block font-display text-2xl">{monthShifts.length}</span></div><div className="rounded-md bg-[#f3f5f0] p-3"><span className="block text-xs text-[#77827c]">排班人員</span><span className="mt-1 block font-display text-2xl">{new Set(monthShifts.map((shift) => shift.employeeId)).size}</span></div></div>
            <div className="mt-4 space-y-2">{employees.map((employee) => <div key={employee.id} className="flex items-center justify-between text-xs"><span className="text-[#56635c]">{employee.full_name}</span><span className="font-semibold">{monthShifts.filter((shift) => shift.employeeId === employee.id).length} 班</span></div>)}</div>
          </div>

          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#edf0eb] px-4 py-4"><div><p className="eyebrow">SHIFT CHANGES</p><h2 className="mt-1 text-base font-semibold">異動申請</h2></div>{pendingRequests.length > 0 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[#fae8e2] px-1.5 text-xs font-bold text-[#bd5039]">{pendingRequests.length}</span>}</div>
            <div className="divide-y divide-[#edf0eb]">{requests.length === 0 && <p className="px-4 py-6 text-center text-xs text-[#87918a]">目前沒有異動申請</p>}{requests.map((request) => <div key={request.id} className="space-y-3 px-4 py-4">
              <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold">{request.employee}<span className="ml-2 text-xs font-normal text-[#77827c]">{request.date ? displayDate(request.date) : '班別異動'}</span></p><p className="mt-1 text-xs text-[#65716b]">{request.reason}</p></div><span className={`status-pill ${request.status === 'pending' ? 'bg-[#f5eed9] text-[#816925]' : request.status === 'approved' ? 'bg-[#e6efe8] text-fern' : 'bg-[#fae8e2] text-[#bd5039]'}`}>{request.status === 'pending' ? '待店長確認' : request.status === 'approved' ? '已核准' : '已婉拒'}</span></div>
              <div className="rounded-md bg-[#f7f8f5] px-3 py-2 text-xs text-[#65716b]"><span>{request.date ? `${displayDate(request.date)} · 原班表` : '原班表'}</span><span className="mx-2">→</span><span className="font-semibold text-ink">{displayDate(request.requestedDate)} · {request.requestedStart}–{request.requestedEnd}</span></div>
              {isManager && request.status === 'pending' && <div className="flex justify-end gap-2"><button disabled={busyRequest === request.id} onClick={() => void reviewRequest(request.id, false)} className="h-8 rounded-md border border-[#dce2db] px-3 text-xs font-semibold hover:bg-white disabled:opacity-40">婉拒</button><button disabled={busyRequest === request.id} onClick={() => void reviewRequest(request.id, true)} className="inline-flex h-8 items-center gap-1 rounded-md bg-fern px-3 text-xs font-semibold text-white hover:bg-[#25493c] disabled:opacity-40"><Check size={14} />核准異動</button></div>}
            </div>)}</div>
          </div>
          <div className="rounded-md border border-[#dce2db] bg-[#f8faf6] p-4"><div className="flex gap-2"><Clock3 size={16} className="mt-0.5 shrink-0 text-fern" /><p className="text-xs leading-5 text-[#65716b]">店員提出異動後，原班表會維持不變；店長核准後才更新月曆。</p></div></div>
        </aside>
      </section>

      {selectedShift && !modal && <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedShift(null); }}><div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"><div className="flex items-start justify-between"><div><p className="eyebrow">SHIFT DETAILS</p><h2 className="mt-1 text-lg font-semibold">{selectedShift.employee}</h2></div><button aria-label="關閉" onClick={() => setSelectedShift(null)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div><p className="mt-4 text-sm">{displayDate(selectedShift.date)}</p><p className="mt-1 text-sm text-[#65716b]">{selectedShift.role} · {selectedShift.start}–{selectedShift.end}</p></div></div>}
      {modal && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><form onSubmit={modal === 'shift' ? shiftForm.handleSubmit(createShift) : requestForm.handleSubmit(submitRequest)} noValidate className="my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"><div className="mb-5 flex items-start justify-between"><div><p className="eyebrow">{modal === 'shift' ? 'MANAGER SCHEDULING' : 'SHIFT CHANGE REQUEST'}</p><h2 className="mt-1 text-lg font-semibold">{modal === 'shift' ? '安排新班別' : '提出班別異動'}</h2>{selectedShift && <p className="mt-1 text-xs text-[#77827c]">{selectedShift.employee} · {displayDate(selectedShift.date)} · {selectedShift.start}–{selectedShift.end}</p>}</div><button type="button" aria-label="關閉" onClick={() => setModal(null)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div>
          <div className="grid gap-4 sm:grid-cols-2">{modal === 'shift' ? <label className="text-xs font-semibold text-[#56635c]">排班人員<select {...shiftForm.register('employeeId')} defaultValue="" className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm"><option value="" disabled>選擇員工</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select>{shiftForm.formState.errors.employeeId && <span className="mt-1 block text-[11px] text-coral">{shiftForm.formState.errors.employeeId.message}</span>}</label> : <div className="rounded-md bg-[#f3f5f0] p-3 text-xs text-[#56635c]">異動人員：<span className="font-semibold">{profile?.full_name}</span></div>}
            <label className="text-xs font-semibold text-[#56635c]">{modal === 'shift' ? '排班日期' : '希望調整日期'}<input type="date" {...(modal === 'shift' ? shiftForm.register('date') : requestForm.register('requestedDate'))} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" />{(modal === 'shift' ? shiftForm.formState.errors.date : requestForm.formState.errors.requestedDate) && <span className="mt-1 block text-[11px] text-coral">請選擇日期</span>}</label>
            <label className="text-xs font-semibold text-[#56635c]">開始時間<input type="time" {...(modal === 'shift' ? shiftForm.register('start') : requestForm.register('requestedStart'))} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" />{(modal === 'shift' ? shiftForm.formState.errors.start : requestForm.formState.errors.requestedStart) && <span className="mt-1 block text-[11px] text-coral">請設定開始時間</span>}</label>
            <label className="text-xs font-semibold text-[#56635c]">結束時間<input type="time" {...(modal === 'shift' ? shiftForm.register('end') : requestForm.register('requestedEnd'))} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" />{(modal === 'shift' ? shiftForm.formState.errors.end : requestForm.formState.errors.requestedEnd) && <span className="mt-1 block text-[11px] text-coral">結束時間需晚於開始時間</span>}</label>
            {modal === 'request' && <label className="text-xs font-semibold text-[#56635c] sm:col-span-2">異動原因<textarea rows={3} {...requestForm.register('reason')} placeholder="請簡述需要調整班別的原因" className="mt-1.5 w-full rounded-md border-[#dfe5de] text-sm focus:border-fern focus:ring-fern" />{requestForm.formState.errors.reason && <span className="mt-1 block text-[11px] text-coral">{requestForm.formState.errors.reason.message}</span>}</label>}
          </div>
          <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setModal(null)} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">取消</button><button className="inline-flex h-9 items-center gap-2 rounded-md bg-ink px-4 text-xs font-semibold text-white hover:bg-fern">{modal === 'shift' ? <><Plus size={14} />加入班表</> : <><Send size={14} />送出申請</>}</button></div>
        </form></div>}
      {notice && <div role="status" className="fixed bottom-5 right-5 z-[60] rounded-md bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg">{notice}</div>}
    </div>
  );
}
