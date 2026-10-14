'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckSquare, ChevronLeft, ChevronRight, Printer, Search, Square, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { inventoryUnitQrValue } from '@/lib/inventory-qr';

type LabelUnit = {
  id: string;
  product_id: string;
  unit_code: string;
  name: string;
  model: string | null;
  sku: string;
  category: string;
  store_name: string;
};
type SelectedLabel = { unit: LabelUnit; copies: number };
type LabelSize = '30x20' | '40x30' | 'custom';
type Orientation = 'landscape' | 'portrait';

const PAGE_SIZE = 25;
const RPC_PAGE_SIZE = 200;
const MAX_SELECT = 5000;
const MAX_PRINT_COPIES = 300;
const MAX_COPIES_PER_ITEM = 100;

export function ProductLabelPrint() {
  const [items, setItems] = useState<LabelUnit[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, SelectedLabel>>({});
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [size, setSize] = useState<LabelSize>('30x20');
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [customWidth, setCustomWidth] = useState(30);
  const [customHeight, setCustomHeight] = useState(20);
  const [margin, setMargin] = useState(1);
  const [contentGap, setContentGap] = useState(1);
  const [scale, setScale] = useState(100);
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLabels, setPreviewLabels] = useState<LabelUnit[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadCategories() {
      const { data, error: queryError } = await createSupabaseBrowserClient().rpc('search_unit_product_categories');
      if (cancelled) return;
      if (queryError) {
        setError(queryError.message);
        return;
      }
      setCategories((data ?? []).map((row: { category: string }) => row.category));
    }
    void loadCategories();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPage() {
      setLoading(true);
      setError('');
      try {
        const { data, error: queryError } = await createSupabaseBrowserClient().rpc('search_inventory_label_items', {
          p_search: search || null,
          p_category: category || null,
          p_offset: page * PAGE_SIZE,
          p_page_size: PAGE_SIZE,
        });
        if (queryError) throw queryError;
        const rows = data ?? [];
        if (cancelled) return;
        setItems(rows.map((row: LabelUnit & { total_count: number }) => ({
          id: row.id,
          product_id: row.product_id,
          unit_code: row.unit_code,
          name: row.name,
          model: row.model,
          sku: row.sku,
          category: row.category,
          store_name: row.store_name,
        })));
        setTotal(rows[0]?.total_count ?? 0);
        setSelected((current) => {
          const next = { ...current };
          rows.forEach((row: LabelUnit & { total_count: number }) => {
            if (next[row.id]) next[row.id] = { ...next[row.id], unit: row };
          });
          return next;
        });
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '無法載入商品');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadPage();
    return () => { cancelled = true; };
  }, [search, category, page]);

  const selectedItems = useMemo(() => Object.values(selected), [selected]);
  const selectedCount = selectedItems.length;
  const totalCopies = selectedItems.reduce((sum, selection) => sum + selection.copies, 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allPageSelected = items.length > 0 && items.every((unit) => Boolean(selected[unit.id]));
  const pageWidth = size === 'custom' ? customWidth : size === '30x20' ? 30 : 40;
  const pageHeight = size === 'custom' ? customHeight : size === '30x20' ? 20 : 30;
  const labelWidth = orientation === 'landscape' ? Math.max(pageWidth, pageHeight) : Math.min(pageWidth, pageHeight);
  const labelHeight = orientation === 'landscape' ? Math.min(pageWidth, pageHeight) : Math.max(pageWidth, pageHeight);
  const qrSizeMm = Math.max(8, Math.min(labelWidth * 0.46, labelHeight - margin * 2) * scale / 100);
  const qrSizePx = Math.round(qrSizeMm * 10);

  function setPageItem(unit: LabelUnit, checked: boolean) {
    if (checked && !selected[unit.id] && selectedCount >= MAX_SELECT) {
      setError(`單次最多選取 ${MAX_SELECT} 項商品，請縮小搜尋範圍。`);
      return;
    }
    setSelected((current) => {
      const next = { ...current };
      if (checked) next[unit.id] = next[unit.id] ?? { unit, copies: 1 };
      else delete next[unit.id];
      return next;
    });
  }

  function setPageSelection(checked: boolean) {
    const newSelectionCount = items.filter((unit) => checked ? !selected[unit.id] : Boolean(selected[unit.id])).length;
    if (checked && selectedCount + newSelectionCount > MAX_SELECT) {
      setError(`選取後會超過 ${MAX_SELECT} 項上限，請縮小範圍或分批列印。`);
      return;
    }
    setSelected((current) => {
      const next = { ...current };
      items.forEach((unit) => {
        if (checked) next[unit.id] = next[unit.id] ?? { unit, copies: 1 };
        else delete next[unit.id];
      });
      return next;
    });
  }

  function setCopies(unit: LabelUnit, rawValue: string) {
    const value = Math.min(MAX_COPIES_PER_ITEM, Math.max(1, Number(rawValue) || 1));
    setSelected((current) => ({ ...current, [unit.id]: { unit, copies: value } }));
  }

  async function selectSearchResults() {
    setBulkLoading(true);
    setError('');
    setNotice('');
    try {
      const client = createSupabaseBrowserClient();
          const firstPage = await client.rpc('search_inventory_label_items', {
        p_search: search || null, p_category: category || null, p_offset: 0, p_page_size: RPC_PAGE_SIZE,
      });
      if (firstPage.error) throw firstPage.error;
      const matchCount = firstPage.data?.[0]?.total_count ?? 0;
      if (matchCount > MAX_SELECT) throw new Error(`符合條件商品有 ${matchCount} 項；單次最多選取 ${MAX_SELECT} 項，請縮小搜尋範圍。`);
      const allRows = [...(firstPage.data ?? [])] as LabelUnit[];
      for (let offset = RPC_PAGE_SIZE; offset < matchCount; offset += RPC_PAGE_SIZE) {
        const { data, error: queryError } = await client.rpc('search_inventory_label_items', {
          p_search: search || null, p_category: category || null, p_offset: offset, p_page_size: RPC_PAGE_SIZE,
        });
        if (queryError) throw queryError;
        allRows.push(...((data ?? []) as LabelUnit[]));
      }
      const addedCount = allRows.filter((unit) => !selected[unit.id]).length;
      if (selectedCount + addedCount > MAX_SELECT) {
        throw new Error(`加入搜尋結果後會超過 ${MAX_SELECT} 項選取上限，請先取消部分選取。`);
      }
      setSelected((current) => {
        const next = { ...current };
        allRows.forEach((unit) => { next[unit.id] = next[unit.id] ?? { unit, copies: 1 }; });
        return next;
      });
      setNotice(`已選取目前搜尋結果中的 ${allRows.length} 件在庫實體商品`);
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : '無法選取搜尋結果');
    } finally {
      setBulkLoading(false);
    }
  }

  async function preparePreview() {
    if (selectedCount === 0) {
      setError('請先選取商品');
      return;
    }
    if (totalCopies > MAX_PRINT_COPIES) {
      setError(`總列印張數為 ${totalCopies}，超過單次上限 ${MAX_PRINT_COPIES} 張，請調整選取項目或張數。`);
      return;
    }
    setPreviewLoading(true);
    setError('');
    try {
      const client = createSupabaseBrowserClient();
      const ids = selectedItems.map(({ unit }) => unit.id);
      const { data, error: queryError } = await client.rpc('validate_inventory_label_units', { p_unit_ids: ids });
      if (queryError) throw queryError;
      const latestUnits = (data ?? []) as LabelUnit[];
      const activeMap = new Map(latestUnits.map((unit) => [unit.id, unit]));
      if (activeMap.size !== ids.length) {
        throw new Error('部分實體商品已售出、停用或不存在；請重新選取後再列印。');
      }
      const refreshed = selectedItems.map(({ unit, copies }) => ({ unit: activeMap.get(unit.id)!, copies }));
      setSelected(Object.fromEntries(refreshed.map(({ unit, copies }) => [unit.id, { unit, copies }])));
      setPreviewLabels(refreshed.flatMap(({ unit, copies }) => Array.from({ length: copies }, () => unit)));
      setPreviewOpen(true);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : '無法準備標籤預覽');
    } finally {
      setPreviewLoading(false);
    }
  }

  function openPrintDialog() {
    try {
      window.print();
    } catch {
      setError('無法開啟系統列印視窗，請確認瀏覽器允許列印。');
    }
  }

  return (
    <div className="space-y-6">
      <style>{`@media print { @page { size: ${labelWidth}mm ${labelHeight}mm; margin: 0; } }`}</style>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">INVENTORY LABELS</p><h1 className="mt-2 font-display text-[32px] leading-tight">商品標籤列印</h1><p className="mt-2 text-sm text-[#77827c]">只列印啟用商品；QR 綁定既有商品 ID，不會建立新商品或 SKU。</p></div>
        <Link href="/inventory" className="inline-flex h-10 items-center gap-2 rounded-md border border-[#dce2db] bg-white px-3.5 text-xs font-semibold hover:border-ink"><ArrowLeft size={15} />返回庫存</Link>
      </section>

      {error && <div role="alert" className="rounded-md border border-[#f0c5b8] bg-[#fff8f5] px-4 py-3 text-sm text-[#a84834]">{error}</div>}
      {notice && <div role="status" className="rounded-md border border-[#cbdccf] bg-[#eaf2e9] px-4 py-3 text-sm text-fern">{notice}</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-semibold text-[#65716b]">標籤尺寸<select value={size} onChange={(event) => setSize(event.target.value as LabelSize)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white"><option value="30x20">30 × 20 mm</option><option value="40x30">40 × 30 mm</option><option value="custom">自訂尺寸</option></select></label>
        <label className="text-xs font-semibold text-[#65716b]">方向<select value={orientation} onChange={(event) => setOrientation(event.target.value as Orientation)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white"><option value="landscape">橫向</option><option value="portrait">直向</option></select></label>
        <label className="text-xs font-semibold text-[#65716b]">邊界（mm）<input type="number" min="0" max="6" step="0.5" value={margin} onChange={(event) => setMargin(Number(event.target.value))} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de]" /></label>
        <label className="text-xs font-semibold text-[#65716b]">內容間距（mm）<input type="number" min="0" max="8" step="0.5" value={contentGap} onChange={(event) => setContentGap(Number(event.target.value))} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de]" /></label>
        {size === 'custom' && <><label className="text-xs font-semibold text-[#65716b]">寬度（mm）<input type="number" min="15" max="100" value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de]" /></label><label className="text-xs font-semibold text-[#65716b]">高度（mm）<input type="number" min="15" max="100" value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de]" /></label></>}
        <label className="text-xs font-semibold text-[#65716b]">縮放比例 {scale}%<input type="range" min="60" max="100" step="5" value={scale} onChange={(event) => setScale(Number(event.target.value))} className="mt-2 block w-full accent-[#30594b]" /></label>
      </section>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#edf0eb] px-4 py-4 md:px-5">
          <div><p className="eyebrow">啟用商品 {total.toLocaleString('zh-TW')} 項</p><h2 className="mt-1 text-base font-semibold">選取商品</h2></div>
          <form onSubmit={(event) => { event.preventDefault(); setPage(0); setSearch(searchDraft.trim()); }} className="flex flex-wrap gap-2">
            <label className="flex h-9 min-w-[220px] items-center gap-2 rounded-md border border-[#dfe5de] bg-white px-3"><Search size={14} className="text-[#89928d]" /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜尋名稱、型號、SKU、序號" className="w-full border-0 bg-transparent p-0 text-xs outline-none focus:ring-0" /></label>
            <select value={category} onChange={(event) => { setPage(0); setCategory(event.target.value); }} aria-label="依分類篩選" className="h-9 rounded-md border-[#dfe5de] bg-white text-xs"><option value="">所有分類</option>{categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select>
            <button className="h-9 rounded-md border border-[#dce2db] bg-white px-3 text-xs font-semibold">搜尋</button>
          </form>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] px-4 py-3 md:px-5">
          <div className="flex flex-wrap gap-2"><button disabled={bulkLoading || items.length === 0} onClick={() => setPageSelection(!allPageSelected)} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#dce2db] px-3 text-xs font-semibold disabled:opacity-50">{allPageSelected ? <CheckSquare size={14} /> : <Square size={14} />}{allPageSelected ? '取消本頁' : '選取本頁'}</button><button disabled={bulkLoading || total === 0} onClick={() => void selectSearchResults()} className="h-9 rounded-md border border-[#dce2db] px-3 text-xs font-semibold disabled:opacity-50">{bulkLoading ? '載入全部符合商品…' : `選取目前搜尋結果（${total}）`}</button><button disabled={selectedCount === 0 || bulkLoading} onClick={() => setSelected({})} className="h-9 rounded-md px-3 text-xs font-semibold text-[#bd5039] disabled:opacity-40">取消全選</button></div>
          <div className="text-xs font-semibold">已選 <span className="text-fern">{selectedCount}</span> 項 · 共 <span className={totalCopies > MAX_PRINT_COPIES ? 'text-[#bd5039]' : 'text-fern'}>{totalCopies}</span> 張</div>
        </div>
        {error && <div role="alert" className="border-b border-[#f0c5b8] bg-[#fff8f5] px-5 py-3 text-xs text-[#a84834]">{error}</div>}
        <div className="overflow-x-auto"><div className="min-w-[900px]">
          <div className="data-row grid grid-cols-[44px_1.3fr_1fr_1fr_1fr_1fr_64px_100px] gap-3 bg-[#fafbf9] px-5 py-3 text-[10px] font-semibold text-[#87918a]"><span>選取</span><span>商品</span><span>SKU</span><span>內部序號</span><span>分類</span><span>型號／分店</span><span>QR</span><span>張數</span></div>
          {loading && <div className="px-5 py-12 text-center text-sm text-[#87918a]">載入商品中…</div>}
          {!loading && items.map((item) => {
            const copies = selected[item.id]?.copies ?? 1;
            const checked = Boolean(selected[item.id]);
            return <div key={item.id} className="data-row grid min-h-[58px] grid-cols-[44px_1.3fr_1fr_1fr_1fr_1fr_64px_100px] gap-3 px-5 py-3 text-xs">
              <span><input type="checkbox" checked={checked} onChange={(event) => { setError(''); setPageItem(item, event.target.checked); }} aria-label={`選取${item.name} ${item.unit_code}`} className="h-4 w-4 accent-[#30594b]" /></span>
              <span className="min-w-0"><span className="block truncate font-semibold">{item.name}</span><span className="mt-1 block truncate text-[10px] text-[#87918a]">{item.product_id}</span></span>
              <span className="truncate font-mono">{item.sku}</span><span className="truncate font-mono">{item.unit_code}</span><span className="truncate">{item.category}</span><span className="min-w-0 truncate">{item.model || '—'} · {item.store_name}</span>
              <span aria-label={`${item.unit_code} QR Code`}><QRCodeSVG value={inventoryUnitQrValue(item.id)} size={48} level="M" includeMargin /></span>
              <input type="number" min="1" max={MAX_COPIES_PER_ITEM} step="1" value={copies} disabled={!checked} onChange={(event) => setCopies(item, event.target.value)} aria-label={`${item.unit_code}標籤張數`} className="h-8 w-20 rounded-md border-[#dfe5de] text-xs disabled:bg-[#f3f5f0] disabled:text-[#9aa39c]" />
            </div>;
          })}
          {!loading && items.length === 0 && <div className="px-5 py-12 text-center text-sm text-[#87918a]">沒有符合條件的啟用商品</div>}
        </div></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0eb] px-4 py-3 md:px-5">
          <span className="text-[11px] text-[#87918a]">第 {page + 1} / {pageCount} 頁 · 每頁 {PAGE_SIZE} 項 · 單次最多選取 {MAX_SELECT} 項</span>
          <div className="flex gap-2"><button disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))} aria-label="上一頁" className="grid h-8 w-8 place-items-center rounded-md border border-[#dce2db] disabled:opacity-40"><ChevronLeft size={15} /></button><button disabled={page + 1 >= pageCount || loading} onClick={() => setPage((current) => current + 1)} aria-label="下一頁" className="grid h-8 w-8 place-items-center rounded-md border border-[#dce2db] disabled:opacity-40"><ChevronRight size={15} /></button></div>
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-[#dce2db] bg-white px-4 py-4">
        <p className="text-sm">已選 <strong>{selectedCount}</strong> 項商品，共 <strong>{totalCopies}</strong> 張標籤（單次上限 {MAX_PRINT_COPIES} 張）</p>
        <button disabled={previewLoading || selectedCount === 0 || totalCopies > MAX_PRINT_COPIES} onClick={() => void preparePreview()} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-xs font-semibold text-white disabled:opacity-50"><Printer size={15} />{previewLoading ? '驗證商品中…' : '預覽批次列印'}</button>
      </section>

      {previewOpen && <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/55 p-4"><section className="batch-label-print mx-auto max-w-4xl rounded-md bg-white p-5 shadow-xl">
        <div className="no-print mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">PRINT PREVIEW</p><h2 className="mt-1 text-lg font-semibold">列印預覽 · {previewLabels.length} 張</h2><p className="mt-1 text-xs text-[#78827c]">請在系統列印視窗確認標籤機、紙張尺寸與縮放；本頁無法判定印表機是否實際完成列印。</p></div><button onClick={() => setPreviewOpen(false)} aria-label="關閉預覽" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div>
        <div className="no-print mb-4 flex flex-wrap gap-2"><button onClick={openPrintDialog} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-xs font-semibold text-white"><Printer size={15} />確認並開啟列印視窗</button><button onClick={() => setPreviewOpen(false)} className="h-10 rounded-md border border-[#dce2db] px-3 text-xs font-semibold">返回調整</button></div>
        <div className="batch-label-preview grid justify-center gap-3 bg-[#f3f5f0] p-4" style={{ '--label-width': `${labelWidth}mm`, '--label-height': `${labelHeight}mm` } as React.CSSProperties}>
          {previewLabels.map((unit, index) => <article key={`${unit.id}-${index}`} className="batch-label flex items-center overflow-hidden bg-white text-black" style={{ width: `${labelWidth}mm`, height: `${labelHeight}mm`, padding: `${margin}mm`, gap: `${contentGap}mm`, transform: `scale(${scale / 100})`, transformOrigin: 'center', fontSize: `${7 * scale / 100}pt` }}>
            <QRCodeSVG value={inventoryUnitQrValue(unit.id)} size={qrSizePx} level="M" includeMargin bgColor="#ffffff" fgColor="#000000" style={{ width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm`, flex: '0 0 auto' }} />
            <div className="min-w-0 flex-1 overflow-hidden text-left leading-tight"><p className="line-clamp-2 break-all font-semibold">{unit.name}</p><p className="mt-1 break-all font-mono">{unit.sku}</p><p className="mt-1 break-all">{unit.model || '—'}</p><p className="mt-1 break-all font-mono">{unit.unit_code}</p></div>
          </article>)}
        </div>
      </section></div>}
    </div>
  );
}