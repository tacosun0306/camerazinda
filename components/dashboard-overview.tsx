'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Clock3, Package, Wrench } from 'lucide-react';
import { useStaffProfile } from '@/components/app-shell';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { repairStatuses } from '@/lib/modules';

type DashboardData = {
  inventoryCount: number;
  lowStockCount: number;
  openRepairCount: number;
  urgentRepairCount: number;
  checkedInCount: number;
  scheduledCount: number;
  repairs: { id: string; case_number: string; customer_name: string; item_name: string; issue: string; due_at: string | null; status: string }[];
  shifts: { id: string; employee_id: string; starts_at: string; ends_at: string; employee: string; role: string }[];
  activities: { id: number; actor_id: string | null; created_at: string; action: string; entity_type: string; entity_id: string | null; actor: string }[];
};

const emptyData: DashboardData = {
  inventoryCount: 0,
  lowStockCount: 0,
  openRepairCount: 0,
  urgentRepairCount: 0,
  checkedInCount: 0,
  scheduledCount: 0,
  repairs: [],
  shifts: [],
  activities: [],
};

const statusLabels = new Map<string, string>(repairStatuses.map((status) => [status.value, status.label]));
const roleLabels: Record<string, string> = { admin: '系統管理員', manager: '店長', sales: '門市人員', technician: '維修技師' };
const timeLabel = (value: string) => new Date(value).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

export function DashboardOverview() {
  const profile = useStaffProfile();
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [todayLabel, setTodayLabel] = useState('STORE OPERATIONS');
  const canSeeTeamAttendance = profile?.role === 'admin' || profile?.role === 'manager';

  useEffect(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    setTodayLabel(now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: '2-digit', year: 'numeric' }).toUpperCase());

    async function load() {
      setLoading(true);
      setError('');
      const supabase = createSupabaseBrowserClient();
      const logsQuery = canSeeTeamAttendance
        ? supabase.from('audit_logs').select('id, actor_id, created_at, action, entity_type, entity_id').order('created_at', { ascending: false }).limit(4)
        : Promise.resolve({ data: [], error: null });
      const [inventoryResult, repairResult, shiftsResult, attendanceResult, profilesResult, logsResult] = await Promise.all([
        supabase.from('inventory_items').select('id, quantity, reorder_threshold'),
        supabase.from('repair_jobs').select('id, case_number, customer_name, item_name, issue, due_at, status').neq('status', 'picked_up').order('due_at', { ascending: true }).limit(50),
        supabase.from('shifts').select('id, employee_id, starts_at, ends_at').gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString()).neq('status', 'cancelled').order('starts_at'),
        supabase.from('attendance_records').select('employee_id, clocked_in_at, clocked_out_at').gte('clocked_in_at', start.toISOString()).lt('clocked_in_at', end.toISOString()),
        supabase.from('profiles').select('id, full_name, role').eq('active', true),
        logsQuery,
      ]);
      const firstError = inventoryResult.error ?? repairResult.error ?? shiftsResult.error ?? attendanceResult.error ?? profilesResult.error ?? logsResult.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }
      const employees = new Map((profilesResult.data ?? []).map((person) => [person.id, person]));
      const repairs = repairResult.data ?? [];
      const shifts = (shiftsResult.data ?? []).map((shift) => ({
        ...shift,
        employee: employees.get(shift.employee_id)?.full_name ?? '員工',
        role: employees.get(shift.employee_id)?.role ?? '',
      }));
      const attendance = attendanceResult.data ?? [];
      const visibleAttendance = canSeeTeamAttendance ? attendance : attendance.filter((record) => record.employee_id === profile?.id);
      const activities = (logsResult.data ?? []).map((item) => ({
        ...item,
        actor: employees.get(item.actor_id ?? '')?.full_name ?? '員工',
      }));
      setData({
        inventoryCount: inventoryResult.data?.length ?? 0,
        lowStockCount: inventoryResult.data?.filter((item) => item.quantity <= item.reorder_threshold).length ?? 0,
        openRepairCount: repairs.length,
        urgentRepairCount: repairs.filter((item) => item.due_at && item.due_at <= formatLocalDate(start)).length,
        checkedInCount: new Set(visibleAttendance.map((record) => record.employee_id)).size,
        scheduledCount: canSeeTeamAttendance ? shifts.length : shifts.filter((shift) => shift.employee_id === profile?.id).length,
        repairs: repairs.slice(0, 4),
        shifts: canSeeTeamAttendance ? shifts.slice(0, 5) : shifts.filter((shift) => shift.employee_id === profile?.id),
        activities,
      });
      setLoading(false);
    }
    void load();
  }, [canSeeTeamAttendance, profile?.id]);

  const metrics = [
    { label: '在庫品項', value: loading ? '—' : String(data.inventoryCount), change: loading ? '' : `${data.lowStockCount} 項低於安全庫存`, detail: '即時庫存', icon: Package, tone: 'text-fern bg-[#e6efe8]' },
    { label: '待處理維修', value: loading ? '—' : String(data.openRepairCount), change: loading ? '' : `${data.urgentRepairCount} 件到期或逾期`, detail: '待取件不含已完成', icon: Wrench, tone: 'text-[#bd5039] bg-[#fae8e2]' },
    { label: canSeeTeamAttendance ? '今日出勤' : '我的今日出勤', value: loading ? '—' : `${data.checkedInCount} / ${data.scheduledCount}`, change: loading ? '' : `${Math.max(0, data.scheduledCount - data.checkedInCount)} 人尚未打卡`, detail: '依今日班表及打卡', icon: Clock3, tone: 'text-[#816925] bg-[#f5eed9]' },
  ];

  return (
    <div className="space-y-7">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">{todayLabel}</p><h1 className="mt-2 font-display text-[32px] leading-tight">早安，{profile?.full_name ?? '員工'}<span className="text-coral">。</span></h1><p className="mt-2 text-sm text-[#77827c]">{profile?.store_name ?? '門市'}營運狀況即時摘要。</p></div>
        <div className="flex gap-2"><Link href="/repairs" className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3.5 text-xs font-semibold text-white transition hover:bg-fern"><Wrench size={15} />建立維修單</Link><Link href="/inventory" className="inline-flex h-10 items-center gap-2 rounded-md border border-[#dce2db] bg-white px-3.5 text-xs font-semibold hover:border-ink"><Package size={15} />新增庫存</Link></div>
      </section>

      {error && <div role="alert" className="rounded-md border border-[#f0c5b8] bg-[#fff8f5] px-4 py-3 text-sm text-[#a84834]">Dashboard 載入失敗：{error}</div>}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{metrics.map(({ label, value, change, detail, icon: Icon, tone }) => <div key={label} className="panel p-5"><div className="flex items-start justify-between"><span className="eyebrow">{label}</span><span className={`grid h-9 w-9 place-items-center rounded-lg ${tone}`}><Icon size={17} /></span></div><div className="mt-5 flex items-end justify-between"><span className="metric-value">{value}</span><span className="pb-1 text-right"><span className="block text-xs font-bold text-fern">{change}</span><span className="mt-1 block text-[10px] text-[#89928d]">{detail}</span></span></div></div>)}</section>

      <section className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#edf0eb] px-5 py-4"><div><p className="eyebrow">需要關注</p><h2 className="mt-1 text-base font-semibold">維修案件進度</h2></div><Link href="/repairs" className="inline-flex items-center gap-1 text-xs font-semibold text-fern hover:underline">全部案件 <ArrowRight size={14} /></Link></div>
          <div className="grid grid-cols-[1.4fr_1fr_auto] gap-3 bg-[#fafbf9] px-5 py-2.5 text-[10px] font-semibold text-[#87918a] sm:grid-cols-[1.4fr_1fr_72px_74px]"><span>案件 / 品項</span><span>客戶</span><span className="hidden sm:block">預計完成</span><span>狀態</span></div>
          {!loading && data.repairs.map((repair) => { const status = statusLabels.get(repair.status) ?? repair.status; return <div key={repair.id} className="grid grid-cols-[1.4fr_1fr_auto] items-center gap-3 border-b border-[#edf0eb] px-5 py-3.5 last:border-0 sm:grid-cols-[1.4fr_1fr_72px_74px]"><div className="min-w-0"><p className="truncate text-xs font-semibold">{repair.item_name}</p><p className="mt-1 truncate text-[10px] text-[#87918a]">{repair.case_number} · {repair.issue}</p></div><span className="truncate text-xs text-[#65716b]">{repair.customer_name}</span><span className="hidden text-xs text-[#65716b] sm:block">{repair.due_at ?? '未設定'}</span><span className="status-pill justify-self-start bg-[#f5eed9] text-[#816925]">{status}</span></div>; })}
          {!loading && data.repairs.length === 0 && <p className="px-5 py-10 text-center text-sm text-[#87918a]">目前沒有待處理維修案件</p>}
          {loading && <p className="px-5 py-10 text-center text-sm text-[#87918a]">正在載入資料…</p>}
          <div className="border-t border-[#edf0eb] px-5 py-3"><Link href="/repairs" className="text-xs font-semibold text-fern hover:underline">查看所有待處理案件 <ArrowRight size={13} className="ml-1 inline" /></Link></div>
        </div>

        <div className="space-y-4">
          <div className="panel p-5">
            <div className="flex items-center justify-between"><div><p className="eyebrow">今日班表</p><h2 className="mt-1 text-base font-semibold">門市人力</h2></div><Link href="/schedule" aria-label="查看排班" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><ArrowUpRight size={16} /></Link></div>
            <div className="mt-4 space-y-3">{data.shifts.map((shift) => <div key={shift.id} className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#e6efe8] text-xs font-bold text-fern">{shift.employee.slice(0, 1)}</span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{shift.employee}</span><span className="mt-0.5 block truncate text-[10px] text-[#87918a]">{roleLabels[shift.role] ?? shift.role} · {timeLabel(shift.starts_at)}–{timeLabel(shift.ends_at)}</span></span></div>)}</div>
            {!loading && data.shifts.length === 0 && <p className="mt-4 text-xs text-[#87918a]">今天尚未排班</p>}
            <Link href="/schedule" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-fern hover:underline">查看完整班表 <ArrowRight size={13} /></Link>
          </div>
          {(canSeeTeamAttendance || data.activities.length > 0) && <div className="panel p-5"><div className="flex items-center justify-between"><div><p className="eyebrow">最近動態</p><h2 className="mt-1 text-base font-semibold">操作紀錄</h2></div><Link href="/audit-logs" aria-label="查看操作紀錄" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><ArrowUpRight size={16} /></Link></div><div className="mt-4 space-y-4">{data.activities.map((activity) => <div key={activity.id} className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-fern" /><span className="min-w-0 flex-1"><span className="block text-xs leading-relaxed">{activity.action} · {activity.entity_type} {activity.entity_id ?? ''}</span><span className="mt-1 block text-[10px] text-[#87918a]">{new Date(activity.created_at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })} · {activity.actor}</span></span></div>)}</div>{!loading && data.activities.length === 0 && <p className="mt-4 text-xs text-[#87918a]">目前沒有操作紀錄</p>}</div>}
        </div>
      </section>

      {data.lowStockCount > 0 && <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-[#dfe9dd] px-5 py-4"><div><p className="text-sm font-semibold">庫存低於安全量</p><p className="mt-1 text-xs text-[#617268]">{data.lowStockCount} 項商品需要補貨。</p></div><Link href="/inventory" className="inline-flex items-center gap-2 rounded-md border border-[#c8d7c7] bg-white px-3 py-2 text-xs font-semibold hover:border-fern"><Package size={14} />查看低庫存</Link></section>}
    </div>
  );
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
