'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Package, Wrench } from 'lucide-react';
import { useStaffProfile } from '@/components/app-shell';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { repairStatuses } from '@/lib/modules';

type DashboardData = {
  inventoryCount: number;
  lowStockCount: number;
  openRepairCount: number;
  urgentRepairCount: number;
  repairs: { id: string; case_number: string; customer_name: string; item_name: string; issue: string; due_at: string | null; status: string }[];
};

const emptyData: DashboardData = {
  inventoryCount: 0,
  lowStockCount: 0,
  openRepairCount: 0,
  urgentRepairCount: 0,
  repairs: [],
};

const statusLabels = new Map<string, string>(repairStatuses.map((status) => [status.value, status.label]));

export function DashboardOverview() {
  const profile = useStaffProfile();
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [todayLabel, setTodayLabel] = useState('STORE OPERATIONS');

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
      const [inventoryResult, repairResult] = await Promise.all([
        supabase.from('inventory_items').select('id, quantity, reorder_threshold'),
        supabase.from('repair_jobs').select('id, case_number, customer_name, item_name, issue, due_at, status').neq('status', 'picked_up').order('due_at', { ascending: true }).limit(50),
      ]);
      const firstError = inventoryResult.error ?? repairResult.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }
      const repairs = repairResult.data ?? [];
      setData({
        inventoryCount: inventoryResult.data?.length ?? 0,
        lowStockCount: inventoryResult.data?.filter((item) => item.quantity <= item.reorder_threshold).length ?? 0,
        openRepairCount: repairs.length,
        urgentRepairCount: repairs.filter((item) => item.due_at && item.due_at <= formatLocalDate(start)).length,
        repairs: repairs.slice(0, 4),
      });
      setLoading(false);
    }
    void load();
  }, []);

  const metrics = [
    { label: '在庫品項', value: loading ? '—' : String(data.inventoryCount), change: loading ? '' : `${data.lowStockCount} 項低於安全庫存`, detail: '即時庫存', icon: Package, tone: 'text-fern bg-[#e6efe8]' },
    { label: '待處理維修', value: loading ? '—' : String(data.openRepairCount), change: loading ? '' : `${data.urgentRepairCount} 件到期或逾期`, detail: '待取件不含已完成', icon: Wrench, tone: 'text-[#bd5039] bg-[#fae8e2]' },
  ];

  return (
    <div className="space-y-7">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">{todayLabel}</p><h1 className="mt-2 font-display text-[32px] leading-tight">早安，{profile?.full_name ?? '員工'}<span className="text-coral">。</span></h1><p className="mt-2 text-sm text-[#77827c]">{profile?.store_name ?? '門市'}營運狀況即時摘要。</p></div>
      </section>

      {error && <div role="alert" className="rounded-md border border-[#f0c5b8] bg-[#fff8f5] px-4 py-3 text-sm text-[#a84834]">Dashboard 載入失敗：{error}</div>}
      <section className="grid gap-3 sm:grid-cols-2">{metrics.map(({ label, value, change, detail, icon: Icon, tone }) => <div key={label} className="panel p-5"><div className="flex items-start justify-between"><span className="eyebrow">{label}</span><span className={`grid h-9 w-9 place-items-center rounded-lg ${tone}`}><Icon size={17} /></span></div><div className="mt-5 flex items-end justify-between"><span className="metric-value">{value}</span><span className="pb-1 text-right"><span className="block text-xs font-bold text-fern">{change}</span><span className="mt-1 block text-[10px] text-[#89928d]">{detail}</span></span></div></div>)}</section>

      <section>
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#edf0eb] px-5 py-4"><div><p className="eyebrow">需要關注</p><h2 className="mt-1 text-base font-semibold">維修案件進度</h2></div><Link href="/repairs" className="inline-flex items-center gap-1 text-xs font-semibold text-fern hover:underline">全部案件 <ArrowRight size={14} /></Link></div>
          <div className="grid grid-cols-[1.4fr_1fr_auto] gap-3 bg-[#fafbf9] px-5 py-2.5 text-[10px] font-semibold text-[#87918a] sm:grid-cols-[1.4fr_1fr_72px_74px]"><span>案件 / 品項</span><span>客戶</span><span className="hidden sm:block">預計完成</span><span>狀態</span></div>
          {!loading && data.repairs.map((repair) => { const status = statusLabels.get(repair.status) ?? repair.status; return <div key={repair.id} className="grid grid-cols-[1.4fr_1fr_auto] items-center gap-3 border-b border-[#edf0eb] px-5 py-3.5 last:border-0 sm:grid-cols-[1.4fr_1fr_72px_74px]"><div className="min-w-0"><p className="truncate text-xs font-semibold">{repair.item_name}</p><p className="mt-1 truncate text-[10px] text-[#87918a]">{repair.case_number} · {repair.issue}</p></div><span className="truncate text-xs text-[#65716b]">{repair.customer_name}</span><span className="hidden text-xs text-[#65716b] sm:block">{repair.due_at ?? '未設定'}</span><span className="status-pill justify-self-start bg-[#f5eed9] text-[#816925]">{status}</span></div>; })}
          {!loading && data.repairs.length === 0 && <p className="px-5 py-10 text-center text-sm text-[#87918a]">目前沒有待處理維修案件</p>}
          {loading && <p className="px-5 py-10 text-center text-sm text-[#87918a]">正在載入資料…</p>}
          <div className="border-t border-[#edf0eb] px-5 py-3"><Link href="/repairs" className="text-xs font-semibold text-fern hover:underline">查看所有待處理案件 <ArrowRight size={13} className="ml-1 inline" /></Link></div>
        </div>
      </section>
    </div>
  );
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
