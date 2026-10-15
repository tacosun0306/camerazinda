'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ClipboardCheck, History, ListChecks, Play } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type StoreOption = { id: string; name: string };
type StocktakeStatus = 'in_progress' | 'submitted' | 'completed';
type StocktakeSession = {
  id: string;
  store_id: string;
  status: StocktakeStatus;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  note: string | null;
};
type StocktakeLine = {
  id: string;
  stocktake_id: string;
  product_id: string;
  unit_id: string | null;
  count_method: 'unit' | 'quantity';
  expected_quantity: number;
  counted_quantity: number | null;
  reviewed_quantity: number | null;
  count_note: string | null;
  review_note: string | null;
  counted_at: string | null;
  reviewed_at: string | null;
  product_name: string;
  brand: string | null;
  sku: string;
  category: string;
  model: string | null;
  unit_code: string | null;
  manufacturer_serial: string | null;
};
type StocktakeView = 'overview' | 'execute' | 'review' | 'history';

const unitCountCategories = new Set(['相機', '鏡頭', '攝影機', '拍立得', '記憶卡', '原廠電池']);
const statusLabels: Record<StocktakeStatus, string> = {
  in_progress: '盤點中',
  submitted: '待差異審核',
  completed: '已完成',
};

export function InventoryStocktake({ stores, role }: { stores: StoreOption[]; role: string | undefined }) {
  const [view, setView] = useState<StocktakeView>('overview');
  const [sessions, setSessions] = useState<StocktakeSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [lines, setLines] = useState<StocktakeLine[]>([]);
  const [countDrafts, setCountDrafts] = useState<Record<string, string>>({});
  const [countNotes, setCountNotes] = useState<Record<string, string>>({});
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [storeId, setStoreId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyLine, setBusyLine] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canManage = role === 'admin' || role === 'manager' || role === 'sales';
  const canReview = role === 'admin' || role === 'manager';

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const differences = useMemo(
    () => lines.filter((line) => line.counted_quantity !== null && line.counted_quantity !== line.expected_quantity),
    [lines],
  );
  const pendingReviews = differences.filter((line) => !line.reviewed_at);

  async function loadSessions() {
    const client = createSupabaseBrowserClient();
    const { data, error: queryError } = await client
      .from('inventory_stocktakes')
      .select('id, store_id, status, created_at, submitted_at, reviewed_at, note')
      .order('created_at', { ascending: false })
      .limit(100);
    if (queryError) throw queryError;
    setSessions((data ?? []) as StocktakeSession[]);
  }

  async function loadLines(sessionId: string) {
    const client = createSupabaseBrowserClient();
    const { data: lineRows, error: lineError } = await client
      .from('inventory_stocktake_lines')
      .select('id, stocktake_id, product_id, unit_id, count_method, expected_quantity, counted_quantity, reviewed_quantity, count_note, review_note, counted_at, reviewed_at')
      .eq('stocktake_id', sessionId)
      .order('product_id')
      .order('unit_id');
    if (lineError) throw lineError;
    const rows = lineRows ?? [];
    const productIds = [...new Set(rows.map((line) => line.product_id))];
    const unitIds = [...new Set(rows.map((line) => line.unit_id).filter((id): id is string => Boolean(id)))];
    const [productsResult, unitsResult] = await Promise.all([
      productIds.length
        ? client.from('inventory_items').select('id, name, brand, sku, category, model').in('id', productIds)
        : Promise.resolve({ data: [], error: null }),
      unitIds.length
        ? client.from('product_units').select('id, unit_code, manufacturer_serial').in('id', unitIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (productsResult.error) throw productsResult.error;
    if (unitsResult.error) throw unitsResult.error;
    const productMap = new Map((productsResult.data ?? []).map((item) => [item.id, item]));
    const unitMap = new Map((unitsResult.data ?? []).map((unit) => [unit.id, unit]));
    const nextLines = rows.map((line) => ({
      ...line,
      product_name: productMap.get(line.product_id)?.name ?? '商品已不存在',
      brand: productMap.get(line.product_id)?.brand ?? null,
      sku: productMap.get(line.product_id)?.sku ?? '—',
      category: productMap.get(line.product_id)?.category ?? '—',
      model: productMap.get(line.product_id)?.model ?? null,
      unit_code: line.unit_id ? unitMap.get(line.unit_id)?.unit_code ?? null : null,
      manufacturer_serial: line.unit_id ? unitMap.get(line.unit_id)?.manufacturer_serial ?? null : null,
    })) as StocktakeLine[];
    setLines(nextLines);
    setCountDrafts(Object.fromEntries(nextLines.map((line) => [line.id, line.counted_quantity == null ? '' : String(line.counted_quantity)])));
    setCountNotes(Object.fromEntries(nextLines.map((line) => [line.id, line.count_note ?? ''])));
    setReviewDrafts(Object.fromEntries(nextLines.map((line) => [line.id, String(line.reviewed_quantity ?? line.counted_quantity ?? '')])));
    setReviewNotes(Object.fromEntries(nextLines.map((line) => [line.id, line.review_note ?? ''])));
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const client = createSupabaseBrowserClient();
        const { data, error: queryError } = await client
          .from('inventory_stocktakes')
          .select('id, store_id, status, created_at, submitted_at, reviewed_at, note')
          .order('created_at', { ascending: false })
          .limit(100);
        if (queryError) throw queryError;
        if (!cancelled) setSessions((data ?? []) as StocktakeSession[]);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '無法載入盤點紀錄');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  async function openSession(session: StocktakeSession, nextView: StocktakeView) {
    setError('');
    setNotice('');
    setSelectedSessionId(session.id);
    setLoading(true);
    try {
      await loadLines(session.id);
      setView(nextView);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '無法載入盤點明細');
    } finally {
      setLoading(false);
    }
  }

  async function startStocktake() {
    if (!storeId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data, error: createError } = await createSupabaseBrowserClient().rpc('create_inventory_stocktake', { p_store_id: storeId });
      if (createError) throw createError;
      await loadSessions();
      const session = { id: data as string, store_id: storeId, status: 'in_progress' as const, created_at: new Date().toISOString(), submitted_at: null, reviewed_at: null, note: null };
      await openSession(session, 'execute');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '無法開始盤點');
    } finally {
      setSaving(false);
    }
  }

  async function saveCount(line: StocktakeLine) {
    const value = Number(countDrafts[line.id]);
    if (!Number.isInteger(value) || value < 0 || value > 5000 || (line.count_method === 'unit' && value > 1)) {
      setError(line.count_method === 'unit' ? '單件盤點數量只能是 0 或 1' : '盤點數量需介於 0 到 5000');
      return;
    }
    setBusyLine(line.id);
    setError('');
    setNotice('');
    try {
      const { error: saveError } = await createSupabaseBrowserClient().rpc('set_inventory_stocktake_count', {
        p_line_id: line.id,
        p_counted_quantity: value,
        p_note: countNotes[line.id] || null,
      });
      if (saveError) throw saveError;
      setLines((current) => current.map((entry) => entry.id === line.id ? { ...entry, counted_quantity: value, count_note: countNotes[line.id] || null } : entry));
      setNotice('盤點數量已儲存');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '無法儲存盤點數量');
    } finally {
      setBusyLine('');
    }
  }

  async function submitStocktake() {
    if (!selectedSession) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: submitError } = await createSupabaseBrowserClient().rpc('submit_inventory_stocktake', { p_stocktake_id: selectedSession.id });
      if (submitError) throw submitError;
      await loadSessions();
      await openSession({ ...selectedSession, status: 'submitted', submitted_at: new Date().toISOString() }, canReview ? 'review' : 'overview');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '無法送出盤點');
    } finally {
      setSaving(false);
    }
  }

  async function saveReview(line: StocktakeLine) {
    const value = Number(reviewDrafts[line.id]);
    if (!Number.isInteger(value) || value < 0 || value > 5000 || (line.count_method === 'unit' && value > 1)) {
      setError(line.count_method === 'unit' ? '單件覆核數量只能是 0 或 1' : '覆核數量需介於 0 到 5000');
      return;
    }
    setBusyLine(line.id);
    setError('');
    setNotice('');
    try {
      const { error: reviewError } = await createSupabaseBrowserClient().rpc('review_inventory_stocktake_line', {
        p_line_id: line.id,
        p_reviewed_quantity: value,
        p_note: reviewNotes[line.id] || null,
      });
      if (reviewError) throw reviewError;
      setLines((current) => current.map((entry) => entry.id === line.id ? { ...entry, reviewed_quantity: value, review_note: reviewNotes[line.id] || null, reviewed_at: new Date().toISOString() } : entry));
      setNotice('差異覆核已儲存');
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : '無法儲存差異覆核');
    } finally {
      setBusyLine('');
    }
  }

  async function finalizeStocktake() {
    if (!selectedSession) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: finalizeError } = await createSupabaseBrowserClient().rpc('finalize_inventory_stocktake', { p_stocktake_id: selectedSession.id });
      if (finalizeError) throw finalizeError;
      await loadSessions();
      await openSession({ ...selectedSession, status: 'completed', reviewed_at: new Date().toISOString() }, 'history');
      setNotice('盤點已完成，庫存差異已套用');
    } catch (finalizeError) {
      setError(finalizeError instanceof Error ? finalizeError.message : '無法完成盤點');
    } finally {
      setSaving(false);
    }
  }

  function storeName(storeId: string) {
    return stores.find((store) => store.id === storeId)?.name ?? '門市已不存在';
  }

  const statusBadge = (status: StocktakeStatus) => <span className={`status-pill ${status === 'completed' ? 'bg-[#e6efe8] text-fern' : status === 'submitted' ? 'bg-[#f5eed9] text-[#816925]' : 'bg-[#fae8e2] text-[#bd5039]'}`}>{statusLabels[status]}</span>;

  return <div className="space-y-5">
    <section className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] pb-4">
      <div><p className="eyebrow">ONLINE STOCKTAKE</p><h2 className="mt-1 text-lg font-semibold">線上盤點</h2><p className="mt-1 text-xs text-[#78827c]">相機類逐件核對 unit；配件按數量盤點。</p></div>
      {view !== 'overview' && <button onClick={() => { setView('overview'); setSelectedSessionId(''); setLines([]); }} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold"><ArrowLeft size={14} />盤點總覽</button>}
    </section>
    {error && <p role="alert" className="rounded-md border border-[#f0c5b8] bg-[#fff8f5] px-3 py-2 text-xs text-[#a84834]">{error}</p>}
    {notice && <p role="status" className="rounded-md border border-[#cbdccf] bg-[#eaf2e9] px-3 py-2 text-xs text-fern">{notice}</p>}

    {view === 'overview' && <>
      <section className="flex flex-wrap items-end justify-between gap-3 border-b border-[#edf0eb] pb-4">
        <label className="min-w-[220px] text-xs font-semibold">盤點分店<select value={storeId} onChange={(event) => setStoreId(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white"><option value="">選擇分店</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <div className="flex gap-2"><button onClick={() => { setView('history'); setSelectedSessionId(''); }} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold"><History size={14} />歷史紀錄</button><button disabled={!canManage || !storeId || saving} onClick={() => void startStocktake()} className="inline-flex h-9 items-center gap-2 rounded-md bg-ink px-3 text-xs font-semibold text-white disabled:opacity-50"><Play size={14} />{saving ? '建立中…' : '開始盤點'}</button></div>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">最近盤點</h3>
        {loading ? <p className="py-6 text-center text-sm text-[#87918a]">載入盤點紀錄…</p> : sessions.length === 0 ? <p className="py-8 text-center text-sm text-[#87918a]">尚無盤點紀錄</p> : sessions.map((session) => <article key={session.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] py-3 text-sm"><div className="flex flex-wrap items-center gap-3">{statusBadge(session.status)}<span className="font-medium">{storeName(session.store_id)}</span><span className="text-xs text-[#78827c]">{new Date(session.created_at).toLocaleString('zh-TW')}</span></div><button onClick={() => void openSession(session, session.status === 'in_progress' ? 'execute' : session.status === 'submitted' && canReview ? 'review' : 'history')} className="h-8 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">{session.status === 'in_progress' ? '繼續盤點' : session.status === 'submitted' && canReview ? '差異審核' : '查看紀錄'}</button></article>)}
      </section>
    </>}

    {view === 'execute' && selectedSession && <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">執行盤點 · {storeName(selectedSession.store_id)}</p><h3 className="mt-1 text-base font-semibold">逐項輸入實際數量</h3></div><button disabled={saving || lines.some((line) => line.counted_quantity === null)} onClick={() => void submitStocktake()} className="h-9 rounded-md bg-ink px-3 text-xs font-semibold text-white disabled:opacity-50">{saving ? '送出中…' : '送出盤點'} </button></div>
      {loading ? <p className="py-8 text-center text-sm text-[#87918a]">載入盤點項目…</p> : lines.length === 0 ? <p className="py-8 text-center text-sm text-[#87918a]">此分店目前沒有啟用商品可盤點</p> : lines.map((line) => <article key={line.id} className="grid gap-3 border-b border-[#edf0eb] py-4 sm:grid-cols-[1fr_170px_auto] sm:items-end"><div className="min-w-0"><p className="truncate text-sm font-semibold">{line.product_name}{line.unit_code ? ` · ${line.unit_code}` : ''}</p><p className="mt-1 truncate text-xs text-[#78827c]">{line.brand ? `${line.brand} · ` : ''}{line.sku} · {line.category}{line.manufacturer_serial ? ` · 原廠序號 ${line.manufacturer_serial}` : ''}</p><p className="mt-1 text-[11px] text-[#78827c]">盤點方式：{line.count_method === 'unit' ? '逐件核對' : '數量盤點'} · 系統數量 {line.expected_quantity}</p></div><label className="text-xs font-semibold">實際數量<input type="number" min="0" max={line.count_method === 'unit' ? 1 : 5000} step="1" value={countDrafts[line.id] ?? ''} onChange={(event) => setCountDrafts((current) => ({ ...current, [line.id]: event.target.value }))} placeholder="尚未盤點" className="mt-1.5 h-9 w-full rounded-md border-[#dfe5de]" /></label><button disabled={busyLine === line.id || countDrafts[line.id] === ''} onClick={() => void saveCount(line)} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold disabled:opacity-50">{busyLine === line.id ? '儲存中…' : '儲存數量'}</button><label className="text-xs font-medium text-[#78827c] sm:col-span-3">備註（選填）<input value={countNotes[line.id] ?? ''} onChange={(event) => setCountNotes((current) => ({ ...current, [line.id]: event.target.value }))} className="mt-1 h-9 w-full rounded-md border-[#dfe5de] text-xs" /></label></article>)}
    </section>}

    {view === 'review' && selectedSession && <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">差異審核 · {storeName(selectedSession.store_id)}</p><h3 className="mt-1 text-base font-semibold">確認差異並決定入帳數量</h3></div><button disabled={!canReview || saving || pendingReviews.length > 0} onClick={() => void finalizeStocktake()} className="h-9 rounded-md bg-ink px-3 text-xs font-semibold text-white disabled:opacity-50">{saving ? '套用中…' : pendingReviews.length > 0 ? `待審核 ${pendingReviews.length} 項` : '確認並完成盤點'}</button></div>
      {differences.length === 0 ? <p className="py-8 text-center text-sm text-[#78827c]">盤點結果與系統數量一致，無差異</p> : differences.map((line) => <article key={line.id} className="grid gap-3 border-b border-[#edf0eb] py-4 sm:grid-cols-[1fr_130px_130px_auto] sm:items-end"><div><p className="text-sm font-semibold">{line.product_name}{line.unit_code ? ` · ${line.unit_code}` : ''}</p><p className="mt-1 text-xs text-[#78827c]">{line.sku} · {line.category} · 系統 {line.expected_quantity} / 盤點 {line.counted_quantity}</p></div><label className="text-xs font-semibold">核准數量<input type="number" min="0" max={line.count_method === 'unit' ? 1 : 5000} value={reviewDrafts[line.id] ?? ''} onChange={(event) => setReviewDrafts((current) => ({ ...current, [line.id]: event.target.value }))} className="mt-1 h-9 w-full rounded-md border-[#dfe5de]" /></label><label className="text-xs font-medium text-[#78827c]">審核備註<input value={reviewNotes[line.id] ?? ''} onChange={(event) => setReviewNotes((current) => ({ ...current, [line.id]: event.target.value }))} className="mt-1 h-9 w-full rounded-md border-[#dfe5de] text-xs" /></label><button disabled={!canReview || busyLine === line.id} onClick={() => void saveReview(line)} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold disabled:opacity-50">{busyLine === line.id ? '儲存中…' : line.reviewed_at ? '更新審核' : '核准差異'}</button></article>)}
    </section>}

    {view === 'history' && <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">歷史紀錄</h3><span className="text-xs text-[#78827c]">最近 100 次盤點</span></div>{sessions.filter((session) => session.status === 'completed').length === 0 ? <p className="py-8 text-center text-sm text-[#87918a]">尚無已完成盤點</p> : sessions.filter((session) => session.status === 'completed').map((session) => <article key={session.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] py-3 text-sm"><div className="flex flex-wrap items-center gap-3">{statusBadge(session.status)}<span className="font-medium">{storeName(session.store_id)}</span><span className="text-xs text-[#78827c]">{new Date(session.created_at).toLocaleString('zh-TW')}</span></div><button onClick={() => void openSession(session, 'history')} className="h-8 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">查看明細</button></article>)}</section>}

    {view === 'history' && selectedSession && <section className="space-y-3"><h3 className="text-sm font-semibold">{storeName(selectedSession.store_id)} · {new Date(selectedSession.created_at).toLocaleString('zh-TW')}</h3>{loading ? <p className="py-6 text-center text-sm text-[#87918a]">載入盤點明細…</p> : lines.map((line) => <article key={line.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] py-3 text-sm"><div><p className="font-semibold">{line.product_name}{line.unit_code ? ` · ${line.unit_code}` : ''}</p><p className="mt-1 text-xs text-[#78827c]">{line.brand ? `${line.brand} · ` : ''}{line.sku} · {line.category}</p></div><span className="text-xs">系統 {line.expected_quantity} · 盤點 {line.counted_quantity} · 核准 {line.reviewed_quantity ?? line.counted_quantity}</span></article>)}</section>}
  </div>;
}