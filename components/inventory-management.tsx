'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, Camera, PackagePlus, Pencil, Plus, Printer, QrCode, RefreshCw, Search, ShoppingBag, Store, X } from 'lucide-react';
import { useStaffProfile } from '@/components/app-shell';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { inventoryItemIdFromQr, inventoryUnitIdFromQr } from '@/lib/inventory-qr';

type StoreLocation = { id: string; name: string };
type ItemStock = { storeId: string; storeName: string; quantity: number };
type InventoryUnit = {
  id: string;
  product_id: string;
  unit_code: string;
  store_id: string;
  status: 'in_stock' | 'sold' | 'disabled';
  sold_at: string | null;
  manufacturer_serial: string | null;
  product_name: string;
  model: string | null;
  sku: string;
  category: string;
  product_active: boolean;
  store_name: string;
};
type UnitOption = { id: string; unit_code: string; store_id: string; store_name: string; manufacturer_serial: string | null };
type InventoryItem = {
  id: string;
  name: string;
  model: string | null;
  sku: string;
  barcode: string | null;
  serial_number: string | null;
  category: string;
  quantity: number;
  reorder_threshold: number;
  stocks: ItemStock[];
};
type InventoryMovement = {
  id: number;
  item_id: string;
  unit_id: string | null;
  action: 'created' | 'updated' | 'received' | 'sale' | 'transfer' | 'disabled';
  quantity: number | null;
  from_store_id: string | null;
  to_store_id: string | null;
  actor_name: string;
  actor_role: string;
  note: string | null;
  created_at: string;
  item_name: string;
  sku: string;
  unit_code: string;
  from_store: string;
  to_store: string;
};
type ProductForm = {
  name: string;
  model: string;
  barcode: string;
  serial_number: string;
  category: string;
  reorder_threshold: string;
  initial_quantity: string;
  store_id: string;
};
type DialogMode = 'actions' | 'create' | 'edit' | 'unit' | 'unit-operation' | 'receive' | 'sale' | 'transfer' | 'store' | null;

const emptyProduct: ProductForm = {
  name: '', model: '', barcode: '', serial_number: '', category: '',
  reorder_threshold: '1', initial_quantity: '0', store_id: '',
};

const roleLabels: Record<string, string> = {
  admin: '系統管理員', manager: '店長', sales: '門市人員', technician: '維修技師',
};
const inventoryCategories = [
  { value: '相機', label: '相機' },
  { value: '鏡頭', label: '鏡頭' },
  { value: '攝影機', label: '攝影機' },
  { value: '拍立得', label: '拍立得' },
  { value: '記憶卡', label: '記憶卡' },
  { value: '原廠電池', label: '原廠電池' },
];
const movementLabels: Record<InventoryMovement['action'], string> = {
  created: '新增主檔', updated: '編輯商品', received: '入庫實體商品', sale: '出售實體商品', transfer: '調撥實體商品', disabled: '停用實體商品',
};

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSaveErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error !== 'object' || error === null) return '儲存失敗，請檢查商品資料';
  const fields = error as { message?: unknown; details?: unknown; hint?: unknown };
  const message = [fields.message, fields.details, fields.hint]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  return message.length ? message.join(' ') : '儲存失敗，請檢查商品資料';
}

export function InventoryManagement() {
  const profile = useStaffProfile();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [movementsError, setMovementsError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<InventoryUnit | null>(null);
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([]);
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [unitOperation, setUnitOperation] = useState<'sale' | 'transfer'>('sale');
  const [unitLoading, setUnitLoading] = useState(false);
  const [unitTargetStoreId, setUnitTargetStoreId] = useState('');
  const [receiveStoreId, setReceiveStoreId] = useState('');
  const [receiveQuantity, setReceiveQuantity] = useState('1');
  const [productForm, setProductForm] = useState<ProductForm>(emptyProduct);
  const [saleStoreId, setSaleStoreId] = useState('');
  const [saleQuantity, setSaleQuantity] = useState('1');
  const [saleNote, setSaleNote] = useState('');
  const [fromStoreId, setFromStoreId] = useState('');
  const [toStoreId, setToStoreId] = useState('');
  const [transferQuantity, setTransferQuantity] = useState('1');
  const [transferNote, setTransferNote] = useState('');
  const [storeName, setStoreName] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const [movementFrom, setMovementFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 29);
    return localDateValue(date);
  });
  const [movementTo, setMovementTo] = useState(() => localDateValue(new Date()));
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const client = createSupabaseBrowserClient();
      const [itemsResult, stocksResult, storesResult] = await Promise.all([
        client.from('inventory_items').select('id, name, model, active, sku, barcode, serial_number, category, quantity, reorder_threshold').order('name'),
        client.from('inventory_stocks').select('item_id, store_id, quantity'),
        client.from('store_locations').select('id, name').eq('active', true).order('name'),
      ]);
      const loadError = itemsResult.error ?? stocksResult.error ?? storesResult.error;
      if (loadError) throw loadError;
      const nextStores = storesResult.data ?? [];
      const storeNames = new Map(nextStores.map((store) => [store.id, store.name]));
      const stockRows = stocksResult.data ?? [];
      setStores(nextStores);
      setItems((itemsResult.data ?? []).map((item) => ({
        ...item,
        stocks: stockRows
          .filter((stock) => stock.item_id === item.id)
          .map((stock) => ({ storeId: stock.store_id, storeName: storeNames.get(stock.store_id) ?? '其他分店', quantity: stock.quantity })),
      })));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '無法載入庫存資料');
    } finally {
      setLoading(false);
    }
  }

  async function loadMovements() {
    setMovementsLoading(true);
    setMovementsError('');
    try {
      const start = new Date(`${movementFrom}T00:00:00`);
      const end = new Date(`${movementTo}T00:00:00`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
        throw new Error('請確認日期範圍，起日不可晚於迄日');
      }
      end.setDate(end.getDate() + 1);
      const client = createSupabaseBrowserClient();
      const { data, error: queryError } = await client
        .from('inventory_movements')
        .select('id, item_id, unit_id, action, quantity, from_store_id, to_store_id, actor_name, actor_role, note, created_at')
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
        .order('created_at', { ascending: false })
        .limit(500);
      if (queryError) throw queryError;
      const rows = data ?? [];
      const itemIds = [...new Set(rows.map((row) => row.item_id))];
      const unitIds = [...new Set(rows.map((row) => row.unit_id).filter((id): id is string => Boolean(id)))];
      const storeIds = [...new Set(rows.flatMap((row) => [row.from_store_id, row.to_store_id]).filter((id): id is string => Boolean(id)))];
      const [itemsResult, storesResult, unitsResult] = await Promise.all([
        itemIds.length ? client.from('inventory_items').select('id, name, sku').in('id', itemIds) : Promise.resolve({ data: [], error: null }),
        storeIds.length ? client.from('store_locations').select('id, name').in('id', storeIds) : Promise.resolve({ data: [], error: null }),
        unitIds.length ? client.from('product_units').select('id, unit_code').in('id', unitIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (itemsResult.error) throw itemsResult.error;
      if (storesResult.error) throw storesResult.error;
      if (unitsResult.error) throw unitsResult.error;
      const itemMap = new Map((itemsResult.data ?? []).map((item) => [item.id, item]));
      const storeMap = new Map((storesResult.data ?? []).map((store) => [store.id, store.name]));
      const unitCodes = new Map((unitsResult.data ?? []).map((unit) => [unit.id, unit.unit_code]));
      setMovements(rows.map((row) => ({
        ...row,
        item_name: itemMap.get(row.item_id)?.name ?? '商品已不存在',
        sku: itemMap.get(row.item_id)?.sku ?? '—',
        unit_code: row.unit_id ? unitCodes.get(row.unit_id) ?? '—' : '',
        from_store: row.from_store_id ? storeMap.get(row.from_store_id) ?? '—' : '',
        to_store: row.to_store_id ? storeMap.get(row.to_store_id) ?? '—' : '',
      })));
    } catch (loadError) {
      setMovementsError(loadError instanceof Error ? loadError.message : '無法載入庫存異動紀錄');
    } finally {
      setMovementsLoading(false);
    }
  }

  useEffect(() => { void refresh(); void loadMovements(); }, []);

  async function loadInventoryUnit(unitId: string): Promise<InventoryUnit> {
    const { data, error: unitError } = await createSupabaseBrowserClient().rpc('get_inventory_unit', { p_unit_id: unitId });
    if (unitError) throw unitError;
    const unit = (data ?? [])[0] as InventoryUnit | undefined;
    if (!unit) throw new Error('找不到這件實體商品');
    return unit;
  }

  async function loadInventoryItem(itemId: string): Promise<InventoryItem> {
    const client = createSupabaseBrowserClient();
    const { data: item, error: itemError } = await client
      .from('inventory_items')
      .select('id, name, model, active, sku, barcode, serial_number, category, quantity, reorder_threshold')
      .eq('id', itemId)
      .single();
    if (itemError) throw itemError;
    const [{ data: stocks, error: stockError }, { data: locationRows, error: locationError }] = await Promise.all([
      client.from('inventory_stocks').select('store_id, quantity').eq('item_id', itemId),
      client.from('store_locations').select('id, name'),
    ]);
    if (stockError) throw stockError;
    if (locationError) throw locationError;
    const names = new Map((locationRows ?? []).map((location) => [location.id, location.name]));
    return {
      ...item,
      stocks: (stocks ?? []).map((stock) => ({
        storeId: stock.store_id,
        storeName: names.get(stock.store_id) ?? '其他分店',
        quantity: stock.quantity,
      })),
    };
  }

  async function handleScannedCode(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;
    setScanInput('');
    setError('');
    try {
      const scannedUnitId = inventoryUnitIdFromQr(code);
      if (scannedUnitId) {
        const unit = await loadInventoryUnit(scannedUnitId);
        setSelectedUnit(unit);
        setUnitTargetStoreId(stores.find((store) => store.id !== unit.store_id)?.id ?? '');
        setDialog('unit');
        return;
      }
      const client = createSupabaseBrowserClient();
      for (const field of ['unit_code', 'manufacturer_serial'] as const) {
        const { data, error: unitLookupError } = await client
          .from('product_units')
          .select('id')
          .eq(field, code)
          .maybeSingle();
        if (unitLookupError) throw unitLookupError;
        if (data) {
          const unit = await loadInventoryUnit(data.id);
          setSelectedUnit(unit);
          setUnitTargetStoreId(stores.find((store) => store.id !== unit.store_id)?.id ?? '');
          setDialog('unit');
          return;
        }
      }
      const qrItemId = inventoryItemIdFromQr(code);
      let itemId = qrItemId;
      if (!itemId) {
        for (const field of ['barcode', 'sku', 'serial_number'] as const) {
          const { data, error: lookupError } = await client
            .from('inventory_items')
            .select('id')
            .eq(field, code)
            .maybeSingle();
          if (lookupError) throw lookupError;
          if (data) {
            itemId = data.id;
            break;
          }
        }
      }
      if (itemId) {
        setSelectedItem(await loadInventoryItem(itemId));
        setDialog('actions');
        return;
      }
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : '無法查詢掃描商品');
      return;
    }
    setProductForm({ ...emptyProduct, barcode: code, store_id: stores[0]?.id ?? '' });
    setSelectedItem(null);
    setDialog('create');
  }

  const scanHandlerRef = useRef(handleScannedCode);
  scanHandlerRef.current = handleScannedCode;

  useEffect(() => {
    const scannedUrl = new URL(window.location.href);
    if (!scannedUrl.searchParams.has('unit')) return;
    void handleScannedCode(scannedUrl.toString()).finally(() => {
      scannedUrl.searchParams.delete('unit');
      window.history.replaceState(null, '', `${scannedUrl.pathname}${scannedUrl.search}`);
    });
  }, []);

  useEffect(() => {
    if (!scannerOpen) return;
    let cancelled = false;
    let controls: { stop: () => void } | null = null;
    async function startScanner() {
      try {
        const video = videoRef.current;
        if (!video) return;
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
          if (result) {
            const code = result.getText();
            setScannerOpen(false);
            scanHandlerRef.current(code);
          }
        });
        if (cancelled) controls.stop();
        else scannerControlsRef.current = controls;
      } catch (scanError) {
        setScannerError(scanError instanceof Error ? scanError.message : '無法啟動相機，請檢查瀏覽器權限');
      }
    }
    void startScanner();
    return () => {
      cancelled = true;
      controls?.stop();
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [scannerOpen]);

  const filteredItems = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return items;
    return items.filter((item) => [item.name, item.sku, item.barcode, item.serial_number, item.category]
      .some((value) => value?.toLocaleLowerCase().includes(search)));
  }, [items, query]);
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  const lowStockItems = items.filter((item) => item.quantity <= item.reorder_threshold).length;
  const canManage = profile && ['admin', 'manager', 'sales'].includes(profile.role);

  function openEdit(item: InventoryItem) {
    setSelectedItem(item);
    setProductForm({
      name: item.name,
      model: item.model ?? '',
      barcode: item.barcode ?? '',
      serial_number: item.serial_number ?? '',
      category: item.category,
      reorder_threshold: String(item.reorder_threshold),
      initial_quantity: '0',
      store_id: '',
    });
    setDialog('edit');
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError('');
    try {
      const client = createSupabaseBrowserClient();
      if (dialog === 'edit' && selectedItem) {
        const { error: updateError } = await client.rpc('update_inventory_item_details_with_model', {
          p_item_id: selectedItem.id,
          p_name: productForm.name,
          p_barcode: productForm.barcode || null,
          p_serial_number: productForm.serial_number || null,
          p_category: productForm.category,
          p_reorder_threshold: Number(productForm.reorder_threshold),
          p_model: productForm.model || null,
        });
        if (updateError) throw updateError;
        setNotice('商品資料已更新');
      } else {
        const { data, error: createError } = await client.rpc('create_inventory_item_with_model', {
          p_name: productForm.name.trim(),
          p_barcode: productForm.barcode || null,
          p_serial_number: productForm.serial_number || null,
          p_category: productForm.category,
          p_reorder_threshold: Number(productForm.reorder_threshold),
          p_initial_quantity: Number(productForm.initial_quantity),
          p_store_id: productForm.store_id,
          p_model: productForm.model || null,
        });
        if (createError) throw createError;
        const createdUnitCount = Array.isArray(data.units) ? data.units.length : 0;
        setNotice(`商品已新增，SKU：${data.sku}，建立 ${createdUnitCount} 件實體商品；可至批次標籤列印。`);
      }
      setDialog(null);
      await refresh();
      await loadMovements();
    } catch (saveError) {
      setError(getSaveErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function recordSale(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || selectedUnitIds.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const { error: saleError } = await createSupabaseBrowserClient().rpc('record_inventory_units_sale', {
        p_unit_ids: selectedUnitIds,
        p_note: saleNote || null,
      });
      if (saleError) throw saleError;
      setDialog(null);
      setSelectedUnitIds([]);
      setNotice(`已出售 ${selectedUnitIds.length} 件實體商品`);
      await refresh();
      await loadMovements();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '出售登記失敗');
    } finally {
      setSaving(false);
    }
  }

  async function transferStock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || selectedUnitIds.length === 0 || !unitTargetStoreId) return;
    setSaving(true);
    setError('');
    try {
      const { error: transferError } = await createSupabaseBrowserClient().rpc('transfer_inventory_units', {
        p_unit_ids: selectedUnitIds,
        p_to_store_id: unitTargetStoreId,
        p_note: transferNote || null,
      });
      if (transferError) throw transferError;
      setDialog(null);
      setSelectedUnitIds([]);
      setNotice(`已調撥 ${selectedUnitIds.length} 件實體商品`);
      await refresh();
      await loadMovements();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '轉倉失敗，請確認來源庫存');
    } finally {
      setSaving(false);
    }
  }

  async function createStore(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!['admin', 'manager'].includes(profile?.role ?? '')) return;
    setSaving(true);
    setError('');
    try {
      const { error: storeError } = await createSupabaseBrowserClient().rpc('create_inventory_store', { p_name: storeName });
      if (storeError) throw storeError;
      setStoreName('');
      setDialog(null);
      setNotice('分店已新增');
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '新增分店失敗');
    } finally {
      setSaving(false);
    }
  }

  function openSale(item: InventoryItem) {
    setSelectedItem(item);
    setUnitOperation('sale');
    setSaleNote('');
    void loadUnitOptions(item);
  }

  async function loadUnitOptions(item: InventoryItem) {
    setUnitLoading(true);
    setError('');
    setUnitOptions([]);
    setSelectedUnitIds([]);
    try {
      const { data, error: queryError, count } = await createSupabaseBrowserClient()
        .from('product_units')
        .select('id, unit_code, store_id, manufacturer_serial', { count: 'exact' })
        .eq('product_id', item.id)
        .eq('status', 'in_stock')
        .order('unit_code')
        .limit(500);
      if (queryError) throw queryError;
      if ((count ?? 0) > 500) throw new Error('此商品超過 500 件在庫單位，請改用 unit QR Code 逐件操作。');
      const locationNames = new Map(stores.map((store) => [store.id, store.name]));
      setUnitOptions((data ?? []).map((unit) => ({
        ...unit,
        store_name: locationNames.get(unit.store_id) ?? '其他分店',
      })));
      setDialog('unit-operation');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '無法載入實體商品清單');
    } finally {
      setUnitLoading(false);
    }
  }

  function toggleUnitSelection(unitId: string, checked: boolean) {
    setSelectedUnitIds((current) => checked
      ? current.includes(unitId) ? current : [...current, unitId]
      : current.filter((id) => id !== unitId));
  }

  async function receiveExistingUnits(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !selectedItem) return;
    setSaving(true);
    setError('');
    try {
      const { data, error: receiveError } = await createSupabaseBrowserClient().rpc('receive_existing_product_units', {
        p_product_id: selectedItem.id,
        p_store_id: receiveStoreId,
        p_quantity: Number(receiveQuantity),
      });
      if (receiveError) throw receiveError;
      setDialog(null);
      setNotice(`${selectedItem.name} 已新增 ${Array.isArray(data) ? data.length : 0} 件實體商品`);
      await refresh();
      await loadMovements();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '入庫失敗');
    } finally {
      setSaving(false);
    }
  }

  async function sellScannedUnit() {
    if (!canManage || !selectedUnit || selectedUnit.status !== 'in_stock' || !selectedUnit.product_active) return;
    setSaving(true);
    setError('');
    try {
      const { error: saleError } = await createSupabaseBrowserClient().rpc('record_inventory_unit_sale', {
        p_unit_id: selectedUnit.id,
        p_note: null,
      });
      if (saleError) throw saleError;
      setSelectedUnit(await loadInventoryUnit(selectedUnit.id));
      setNotice(`${selectedUnit.unit_code} 已售出`);
      await refresh();
      await loadMovements();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '出售失敗');
    } finally {
      setSaving(false);
    }
  }

  async function transferScannedUnit() {
    if (!canManage || !selectedUnit || selectedUnit.status !== 'in_stock' || !unitTargetStoreId) return;
    setSaving(true);
    setError('');
    try {
      const { error: transferError } = await createSupabaseBrowserClient().rpc('transfer_inventory_unit', {
        p_unit_id: selectedUnit.id,
        p_to_store_id: unitTargetStoreId,
        p_note: null,
      });
      if (transferError) throw transferError;
      setSelectedUnit(await loadInventoryUnit(selectedUnit.id));
      setNotice(`${selectedUnit.unit_code} 已調撥`);
      await refresh();
      await loadMovements();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '調撥失敗');
    } finally {
      setSaving(false);
    }
  }

  function openReceive(item: InventoryItem) {
    setSelectedItem(item);
    setReceiveStoreId(item.stocks.find((stock) => stock.quantity > 0)?.storeId ?? stores[0]?.id ?? '');
    setReceiveQuantity('1');
    setDialog('receive');
  }

  function openTransfer(item: InventoryItem) {
    setSelectedItem(item);
    setUnitOperation('transfer');
    setTransferNote('');
    setUnitTargetStoreId(stores.find((store) => store.id !== item.stocks.find((stock) => stock.quantity > 0)?.storeId)?.id ?? '');
    void loadUnitOptions(item);
  }

  function storeStock(item: InventoryItem, storeId: string) {
    return item.stocks.find((stock) => stock.storeId === storeId)?.quantity ?? 0;
  }

  const closeDialog = () => { setDialog(null); setSelectedItem(null); setSelectedUnit(null); setSelectedUnitIds([]); };

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">STORE OPERATIONS</p>
          <h1 className="mt-2 font-display text-[32px] leading-tight">庫存管理</h1>
          <p className="mt-2 text-sm text-[#77827c]">掃碼建檔、出售扣庫存，或將商品轉至其他分店。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory/labels" className="inline-flex h-10 items-center gap-2 rounded-md border border-[#dce2db] bg-white px-3 text-xs font-semibold hover:border-ink"><Printer size={15} />標籤列印</Link>
          {['admin', 'manager'].includes(profile?.role ?? '') && <button onClick={() => { setStoreName(''); setDialog('store'); }} className="inline-flex h-10 items-center gap-2 rounded-md border border-[#dce2db] bg-white px-3 text-xs font-semibold hover:border-ink"><Store size={15} />新增分店</button>}
          <button onClick={() => { setScannerError(''); setScannerOpen(true); }} className="inline-flex h-10 items-center gap-2 rounded-md border border-[#dce2db] bg-white px-3 text-xs font-semibold hover:border-ink"><Camera size={15} />掃描 QR</button>
          <button onClick={() => { setSelectedItem(null); setProductForm({ ...emptyProduct, store_id: stores[0]?.id ?? '' }); setDialog('create'); }} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3.5 text-xs font-semibold text-white hover:bg-fern"><PackagePlus size={15} />新增商品</button>
          <button onClick={() => void refresh()} aria-label="重新載入庫存" className="grid h-10 w-10 place-items-center rounded-md border border-[#dce2db] bg-white hover:border-ink"><RefreshCw size={15} /></button>
        </div>
      </section>

      {error && <div role="alert" className="rounded-md border border-[#f0c5b8] bg-[#fff8f5] px-4 py-3 text-sm text-[#a84834]">{error}</div>}
      {notice && <div role="status" className="rounded-md border border-[#cbdccf] bg-[#eaf2e9] px-4 py-3 text-sm text-fern">{notice}</div>}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-4"><p className="eyebrow">商品品項</p><p className="metric-value mt-4">{loading ? '—' : items.length}</p></div>
        <div className="panel p-4"><p className="eyebrow">各店總庫存</p><p className="metric-value mt-4">{loading ? '—' : totalUnits.toLocaleString('zh-TW')}</p></div>
        <div className="panel p-4"><p className="eyebrow">低於安全庫存</p><p className="metric-value mt-4">{loading ? '—' : lowStockItems}</p></div>
      </section>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] px-4 py-4 md:px-5">
          <div><p className="eyebrow">{loading ? '讀取中' : `${filteredItems.length} 個品項 · ${stores.length} 間分店`}</p><h2 className="mt-1 text-base font-semibold">商品與分店庫存</h2></div>
          <div className="flex w-full max-w-[420px] gap-2">
            <form onSubmit={(event) => { event.preventDefault(); handleScannedCode(scanInput); }} className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-[#dfe5de] bg-white px-3 focus-within:border-fern">
              <QrCode size={15} className="shrink-0 text-[#89928d]" />
              <input value={scanInput} onChange={(event) => setScanInput(event.target.value)} placeholder="掃描槍輸入 QR、SKU 或序號" className="w-full border-0 bg-transparent p-0 text-xs outline-none focus:ring-0" />
              <button aria-label="查找掃描碼" className="grid h-7 w-7 shrink-0 place-items-center rounded hover:bg-canvas"><Search size={14} /></button>
            </form>
            <label className="flex h-9 w-[150px] items-center gap-2 rounded-md border border-[#dfe5de] bg-white px-3 focus-within:border-fern sm:w-[190px]"><Search size={14} className="shrink-0 text-[#89928d]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋商品..." className="w-full border-0 bg-transparent p-0 text-xs outline-none focus:ring-0" /></label>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[850px]">
            <div className="data-row grid grid-cols-[1.5fr_1fr_1.2fr_90px_235px] gap-3 bg-[#fafbf9] px-5 py-3 text-[10px] font-semibold text-[#87918a]"><span>商品</span><span>SKU / QR 碼</span><span>分店庫存</span><span>總數</span><span>操作</span></div>
            {loading && <div className="px-5 py-12 text-center text-sm text-[#87918a]">正在從 Supabase 載入…</div>}
            {!loading && filteredItems.map((item) => <div key={item.id} className="data-row grid min-h-[70px] grid-cols-[1.5fr_1fr_1.2fr_90px_235px] gap-3 px-5 py-3 text-xs">
              <span className="min-w-0"><span className="block truncate font-semibold text-ink">{item.name}</span><span className="mt-1 block truncate text-[11px] text-[#87918a]">{item.model || '型號未設定'} · {item.category}{item.serial_number ? ` · ${item.serial_number}` : ''}</span></span>
              <span className="min-w-0"><span className="block truncate text-[#526159]">{item.sku}</span><span className="mt-1 block truncate text-[11px] text-[#87918a]">{item.barcode || '未設定 QR / 條碼'}</span></span>
              <span className="flex flex-wrap gap-1.5">{item.stocks.map((stock) => <span key={stock.storeId} className="rounded bg-[#f3f5f0] px-2 py-1 text-[11px] text-[#526159]">{stock.storeName} {stock.quantity}</span>)}{item.stocks.length === 0 && <span className="text-[#87918a]">尚未分配分店</span>}</span>
              <span><span className={`status-pill ${item.quantity === 0 ? 'bg-[#fae8e2] text-[#bd5039]' : item.quantity <= item.reorder_threshold ? 'bg-[#f5eed9] text-[#816925]' : 'bg-[#e6efe8] text-fern'}`}>{item.quantity}</span></span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1"><button onClick={() => openEdit(item)} aria-label={`編輯${item.name}`} className="inline-flex items-center gap-1 font-semibold text-fern hover:underline"><Pencil size={13} />編輯</button><button onClick={() => openReceive(item)} disabled={!canManage} className="inline-flex items-center gap-1 font-semibold text-fern hover:underline disabled:opacity-40"><PackagePlus size={13} />入庫</button><button onClick={() => openSale(item)} disabled={!canManage} className="inline-flex items-center gap-1 font-semibold text-ink hover:underline disabled:opacity-40"><ShoppingBag size={13} />出售</button><button onClick={() => openTransfer(item)} disabled={!canManage} className="inline-flex items-center gap-1 font-semibold text-ink hover:underline disabled:opacity-40"><ArrowLeftRight size={13} />轉倉</button></span>
            </div>)}
            {!loading && !error && filteredItems.length === 0 && <div className="px-5 py-14 text-center text-sm text-[#87918a]">{query ? '找不到符合的商品' : '目前沒有商品；可掃描新商品 QR 碼開始建檔'}</div>}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[#edf0eb] px-5 py-3 text-[11px] text-[#87918a]"><span>庫存異動會記錄操作人員與時間</span><span>來源：Supabase</span></div>
      </section>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#edf0eb] px-4 py-4 md:px-5">
          <div><p className="eyebrow">{movementsLoading ? '查詢中' : `${movements.length} 筆異動`}</p><h2 className="mt-1 text-base font-semibold">庫存異動紀錄</h2></div>
          <form onSubmit={(event) => { event.preventDefault(); void loadMovements(); }} className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] font-semibold text-[#65716b]">起日<input required type="date" value={movementFrom} max={movementTo} onChange={(event) => setMovementFrom(event.target.value)} className="mt-1 block h-9 rounded-md border-[#dfe5de] bg-white px-2 text-xs" /></label>
            <label className="text-[11px] font-semibold text-[#65716b]">迄日<input required type="date" value={movementTo} min={movementFrom} onChange={(event) => setMovementTo(event.target.value)} className="mt-1 block h-9 rounded-md border-[#dfe5de] bg-white px-2 text-xs" /></label>
            <button disabled={movementsLoading} className="h-9 rounded-md bg-ink px-3 text-xs font-semibold text-white hover:bg-fern disabled:opacity-60">{movementsLoading ? '查詢中…' : '查詢'}</button>
          </form>
        </div>
        {movementsError && <div role="alert" className="border-b border-[#f0c5b8] bg-[#fff8f5] px-5 py-3 text-xs text-[#a84834]">{movementsError}</div>}
        <div className="overflow-x-auto">
          <div className="min-w-[940px]">
            <div className="data-row grid grid-cols-[145px_1.3fr_90px_80px_1.15fr_1fr_1.2fr] gap-3 bg-[#fafbf9] px-5 py-3 text-[10px] font-semibold text-[#87918a]"><span>時間</span><span>商品</span><span>異動</span><span>數量</span><span>分店</span><span>操作人員</span><span>備註</span></div>
            {movementsLoading && <div className="px-5 py-10 text-center text-sm text-[#87918a]">正在查詢異動紀錄…</div>}
            {!movementsLoading && movements.map((movement) => <div key={movement.id} className="data-row grid min-h-[58px] grid-cols-[145px_1.3fr_90px_80px_1.15fr_1fr_1.2fr] gap-3 px-5 py-3 text-xs">
              <span className="text-[#65716b]">{new Date(movement.created_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
              <span className="min-w-0"><span className="block truncate font-semibold">{movement.item_name}</span><span className="mt-1 block truncate font-[10px] text-[#87918a]">{movement.sku}{movement.unit_code ? ` · ${movement.unit_code}` : ''}</span></span>
              <span><span className={`status-pill ${movement.action === 'sale' ? 'bg-[#fae8e2] text-[#bd5039]' : movement.action === 'transfer' ? 'bg-[#f5eed9] text-[#816925]' : 'bg-[#e6efe8] text-fern'}`}>{movementLabels[movement.action]}</span></span>
              <span>{movement.quantity == null ? '—' : `${movement.quantity} 件`}</span>
              <span className="min-w-0 truncate" title={movement.action === 'transfer' ? `${movement.from_store} → ${movement.to_store}` : movement.action === 'sale' ? movement.from_store : movement.to_store}>{movement.action === 'transfer' ? `${movement.from_store} → ${movement.to_store}` : movement.action === 'sale' ? movement.from_store : movement.to_store || '—'}</span>
              <span className="min-w-0"><span className="block truncate font-medium">{movement.actor_name}</span><span className="mt-1 block truncate text-[10px] text-[#87918a]">{roleLabels[movement.actor_role] ?? movement.actor_role}</span></span>
              <span className="truncate text-[#65716b]" title={movement.note ?? ''}>{movement.note || '—'}</span>
            </div>)}
            {!movementsLoading && !movementsError && movements.length === 0 && <div className="px-5 py-12 text-center text-sm text-[#87918a]">此日期範圍沒有庫存異動</div>}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[#edf0eb] px-5 py-3 text-[11px] text-[#87918a]"><span>{movements.length === 500 ? '目前最多顯示 500 筆，請縮小日期範圍' : `查詢範圍：${movementFrom} 至 ${movementTo}`}</span><span>操作人員與職務依異動當下記錄</span></div>
      </section>

      {scannerOpen && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setScannerOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="scanner-title" className="my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"><div className="mb-4 flex items-start justify-between"><div><p className="eyebrow">CAMERA SCANNER</p><h2 id="scanner-title" className="mt-1 text-lg font-semibold">掃描商品 QR / 條碼</h2></div><button onClick={() => setScannerOpen(false)} aria-label="關閉掃描器" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div><video ref={videoRef} className="aspect-video w-full rounded-md bg-ink object-cover" muted playsInline />{scannerError && <p role="alert" className="mt-3 rounded-md bg-[#fff8f5] p-3 text-xs text-[#a84834]">{scannerError}</p>}<p className="mt-3 text-xs text-[#78827c]">掃到已建檔商品會開啟操作；新 QR 碼會帶入新增商品表單。</p></section></div>}

      {dialog && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
        {dialog === 'unit-operation' && selectedItem && <section role="dialog" aria-modal="true" aria-labelledby="unit-operation-title" className="my-auto w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
          <div className="mb-4 flex items-start justify-between"><div><p className="eyebrow">{unitOperation === 'sale' ? 'SELECT UNITS TO SELL' : 'SELECT UNITS TO TRANSFER'}</p><h2 id="unit-operation-title" className="mt-1 text-lg font-semibold">{selectedItem.name}</h2><p className="mt-1 text-xs text-[#78827c]">SKU {selectedItem.sku} · 勾選要操作的實體商品</p></div><button onClick={closeDialog} aria-label="關閉" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div>
          {unitLoading ? <p className="py-8 text-center text-sm text-[#87918a]">載入實體單位…</p> : unitOptions.length === 0 ? <p className="py-8 text-center text-sm text-[#87918a]">此商品目前沒有在庫實體單位</p> : <>
            <div className="mb-3 flex items-center justify-between text-xs"><button onClick={() => setSelectedUnitIds(selectedUnitIds.length === unitOptions.length ? [] : unitOptions.map((unit) => unit.id))} className="font-semibold text-fern">{selectedUnitIds.length === unitOptions.length ? '取消全選' : '全選在庫單位'}</button><span>已選 {selectedUnitIds.length} / {unitOptions.length} 件</span></div>
            <div className="max-h-[42vh] divide-y divide-[#edf0eb] overflow-y-auto border-y border-[#edf0eb]">{unitOptions.map((unit) => <label key={unit.id} className="flex cursor-pointer items-center gap-3 py-3 text-xs"><input type="checkbox" checked={selectedUnitIds.includes(unit.id)} onChange={(event) => setSelectedUnitIds((current) => event.target.checked ? [...current, unit.id] : current.filter((id) => id !== unit.id))} className="h-4 w-4 accent-[#30594b]" /><span className="min-w-0 flex-1"><span className="block font-mono font-semibold">{unit.unit_code}</span><span className="mt-1 block text-[10px] text-[#87918a]">{unit.store_name}{unit.manufacturer_serial ? ` · 原廠序號 ${unit.manufacturer_serial}` : ''}</span></span></label>)}</div>
            <form onSubmit={(event) => void (unitOperation === 'sale' ? recordSale(event) : transferStock(event))} className="mt-4 space-y-3">{unitOperation === 'transfer' && <label className="block text-xs font-semibold">目的分店<select required value={unitTargetStoreId} onChange={(event) => setUnitTargetStoreId(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white"><option value="">請選擇目的地</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>}<label className="block text-xs font-semibold">備註（選填）<input maxLength={200} value={unitOperation === 'sale' ? saleNote : transferNote} onChange={(event) => unitOperation === 'sale' ? setSaleNote(event.target.value) : setTransferNote(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" /></label><div className="flex justify-end gap-2"><button type="button" onClick={closeDialog} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">取消</button><button disabled={!canManage || saving || selectedUnitIds.length === 0 || selectedUnitIds.length > 500 || (unitOperation === 'transfer' && !unitTargetStoreId)} className="h-9 rounded-md bg-ink px-4 text-xs font-semibold text-white disabled:opacity-50">{saving ? '處理中…' : unitOperation === 'sale' ? `確認出售 ${selectedUnitIds.length} 件` : `確認調撥 ${selectedUnitIds.length} 件`}</button></div></form>
          </>}
        </section>}

        {dialog === 'receive' && selectedItem && <form onSubmit={(event) => void receiveExistingUnits(event)} className="my-auto w-full max-w-md rounded-lg bg-white p-5 shadow-xl"><div className="mb-5 flex items-start justify-between"><div><p className="eyebrow">RECEIVE UNITS</p><h2 className="mt-1 text-lg font-semibold">同款商品入庫</h2><p className="mt-1 text-xs text-[#78827c]">{selectedItem.name} · SKU {selectedItem.sku}</p></div><button type="button" onClick={closeDialog} aria-label="關閉" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div><label className="block text-xs font-semibold">入庫分店<select required value={receiveStoreId} onChange={(event) => setReceiveStoreId(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white"><option value="">選擇分店</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label className="mt-4 block text-xs font-semibold">新增數量<input required type="number" min="1" max="5000" step="1" value={receiveQuantity} onChange={(event) => setReceiveQuantity(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de]" /></label><p className="mt-3 text-[11px] text-[#78827c]">每件建立固定 UUID 與內部序號；主檔與 SKU 沿用既有資料。</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={closeDialog} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">取消</button><button disabled={saving || !canManage || !receiveStoreId} className="h-9 rounded-md bg-ink px-4 text-xs font-semibold text-white disabled:opacity-50">{saving ? '建立實體商品中…' : '確認入庫'}</button></div></form>}

        {dialog === 'unit' && selectedUnit && <section role="dialog" aria-modal="true" aria-labelledby="physical-unit-title" className="my-auto w-full max-w-md rounded-lg bg-white p-5 shadow-xl"><div className="mb-5 flex items-start justify-between"><div><p className="eyebrow">PHYSICAL UNIT</p><h2 id="physical-unit-title" className="mt-1 text-lg font-semibold">{selectedUnit.product_name}</h2><p className="mt-1 text-xs text-[#78827c]">SKU {selectedUnit.sku} · {selectedUnit.model || '型號未設定'}</p></div><button onClick={closeDialog} aria-label="關閉" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div><dl className="grid grid-cols-[100px_1fr] gap-y-2 border-y border-[#edf0eb] py-4 text-xs"><dt className="text-[#78827c]">內部序號</dt><dd className="font-mono font-semibold">{selectedUnit.unit_code}</dd><dt className="text-[#78827c]">目前分店</dt><dd>{selectedUnit.store_name}</dd><dt className="text-[#78827c]">狀態</dt><dd className={selectedUnit.status === 'in_stock' ? 'font-semibold text-fern' : 'font-semibold text-[#bd5039]'}>{selectedUnit.status === 'in_stock' ? '在庫' : selectedUnit.status === 'sold' ? `已售出${selectedUnit.sold_at ? ` · ${new Date(selectedUnit.sold_at).toLocaleString('zh-TW')}` : ''}` : '停用'}</dd></dl>{selectedUnit.status === 'in_stock' && selectedUnit.product_active && <div className="mt-4 space-y-3"><button disabled={!canManage || saving} onClick={() => void sellScannedUnit()} className="h-10 w-full rounded-md bg-ink text-xs font-semibold text-white disabled:opacity-50">{saving ? '處理中…' : '出售此件'}</button><div className="flex gap-2"><select value={unitTargetStoreId} onChange={(event) => setUnitTargetStoreId(event.target.value)} className="h-10 min-w-0 flex-1 rounded-md border-[#dfe5de] bg-white text-xs"><option value="">選擇調撥目的分店</option>{stores.filter((store) => store.id !== selectedUnit.store_id).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select><button disabled={!canManage || saving || !unitTargetStoreId} onClick={() => void transferScannedUnit()} className="h-10 rounded-md border border-[#dce2db] px-3 text-xs font-semibold disabled:opacity-40">調撥此件</button></div></div>}{!selectedUnit.product_active && <p className="mt-4 text-xs text-[#bd5039]">商品主檔已停用，不能出售或調撥。</p>}<p className="mt-4 text-[11px] text-[#87918a]">QR 識別此實體單位；重新列印不會變更 UUID 或內部序號。</p></section>}

        {(dialog === 'create' || dialog === 'edit') && <form onSubmit={(event) => void saveProduct(event)} className="my-auto w-full max-w-xl rounded-lg bg-white p-5 shadow-xl">
          <div className="mb-5 flex items-start justify-between"><div><p className="eyebrow">{dialog === 'edit' ? 'EDIT PRODUCT' : 'NEW PRODUCT'}</p><h2 className="mt-1 text-lg font-semibold">{dialog === 'edit' ? '編輯商品' : '新增商品'}</h2></div><button type="button" onClick={closeDialog} aria-label="關閉" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold">商品名稱<input required maxLength={120} value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm focus:border-fern focus:ring-fern" /></label>
              <label className="text-xs font-semibold">型號（選填）<input maxLength={120} value={productForm.model} onChange={(event) => setProductForm({ ...productForm, model: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm focus:border-fern focus:ring-fern" /></label>
              <label className="text-xs font-semibold">序號（選填）<input maxLength={120} value={productForm.serial_number} onChange={(event) => setProductForm({ ...productForm, serial_number: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm focus:border-fern focus:ring-fern" /></label>
              <label className="text-xs font-semibold">分類<select required value={productForm.category} onChange={(event) => setProductForm({ ...productForm, category: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm focus:border-fern focus:ring-fern"><option value="">請選擇分類</option>{!inventoryCategories.some((category) => category.value === productForm.category) && productForm.category && <option value={productForm.category}>{productForm.category}（既有分類）</option>}{inventoryCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
              <label className="text-xs font-semibold">安全庫存<input required type="number" min="0" step="1" value={productForm.reorder_threshold} onChange={(event) => setProductForm({ ...productForm, reorder_threshold: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm focus:border-fern focus:ring-fern" /></label>
              {dialog === 'create' && <><label className="text-xs font-semibold">初始數量<input required type="number" min="0" step="1" value={productForm.initial_quantity} onChange={(event) => setProductForm({ ...productForm, initial_quantity: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm focus:border-fern focus:ring-fern" /></label><label className="text-xs font-semibold">所屬分店<select required value={productForm.store_id} onChange={(event) => setProductForm({ ...productForm, store_id: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm"><option value="">請選擇分店</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label></>}
            </div>
            <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={closeDialog} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">取消</button><button disabled={saving || !canManage || (dialog === 'create' && stores.length === 0)} className="h-9 rounded-md bg-ink px-4 text-xs font-semibold text-white hover:bg-fern disabled:opacity-60">{saving ? '儲存中…' : dialog === 'edit' ? '儲存變更' : '建立商品'}</button></div>
        </form>}

        {dialog === 'sale' && selectedItem && <form onSubmit={(event) => void recordSale(event)} className="my-auto w-full max-w-md rounded-lg bg-white p-5 shadow-xl"><div className="mb-5 flex items-start justify-between"><div><p className="eyebrow">RECORD SALE</p><h2 className="mt-1 text-lg font-semibold">登記出售</h2><p className="mt-1 text-xs text-[#78827c]">{selectedItem.name}</p></div><button type="button" onClick={closeDialog} aria-label="關閉" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div><div className="space-y-4"><label className="block text-xs font-semibold">出售分店<select required value={saleStoreId} onChange={(event) => setSaleStoreId(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm"><option value="">請選擇分店</option>{selectedItem.stocks.map((stock) => <option key={stock.storeId} value={stock.storeId}>{stock.storeName}（庫存 {stock.quantity}）</option>)}</select></label><label className="block text-xs font-semibold">出售數量<input required type="number" min="1" max={storeStock(selectedItem, saleStoreId)} step="1" value={saleQuantity} onChange={(event) => setSaleQuantity(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" /></label><label className="block text-xs font-semibold">備註（選填）<input maxLength={200} value={saleNote} onChange={(event) => setSaleNote(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" /></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={closeDialog} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">取消</button><button disabled={saving || !canManage || !saleStoreId || Number(saleQuantity) > storeStock(selectedItem, saleStoreId)} className="h-9 rounded-md bg-ink px-4 text-xs font-semibold text-white disabled:opacity-50">{saving ? '處理中…' : '確認出售並扣庫存'}</button></div></form>}

        {dialog === 'transfer' && selectedItem && <form onSubmit={(event) => void transferStock(event)} className="my-auto w-full max-w-md rounded-lg bg-white p-5 shadow-xl"><div className="mb-5 flex items-start justify-between"><div><p className="eyebrow">TRANSFER STOCK</p><h2 className="mt-1 text-lg font-semibold">轉倉至其他分店</h2><p className="mt-1 text-xs text-[#78827c]">{selectedItem.name}</p></div><button type="button" onClick={closeDialog} aria-label="關閉" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div><div className="space-y-4"><label className="block text-xs font-semibold">來源分店<select required value={fromStoreId} onChange={(event) => setFromStoreId(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm"><option value="">請選擇來源</option>{selectedItem.stocks.map((stock) => <option key={stock.storeId} value={stock.storeId}>{stock.storeName}（庫存 {stock.quantity}）</option>)}</select></label><label className="block text-xs font-semibold">目的分店<select required value={toStoreId} onChange={(event) => setToStoreId(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm"><option value="">請選擇目的地</option>{stores.filter((store) => store.id !== fromStoreId).map((store) => <option key={store.id} value={store.id}>{store.name}（現有 {storeStock(selectedItem, store.id)}）</option>)}</select></label><label className="block text-xs font-semibold">轉倉數量<input required type="number" min="1" max={storeStock(selectedItem, fromStoreId)} step="1" value={transferQuantity} onChange={(event) => setTransferQuantity(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" /></label><label className="block text-xs font-semibold">備註（選填）<input maxLength={200} value={transferNote} onChange={(event) => setTransferNote(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" /></label></div><div className="mt-6 flex flex-wrap justify-between gap-2"><button type="button" onClick={() => { setStoreName(''); setDialog('store'); }} className="inline-flex h-9 items-center gap-1.5 text-xs font-semibold text-fern"><Plus size={14} />新增分店</button><div className="flex gap-2"><button type="button" onClick={closeDialog} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">取消</button><button disabled={saving || !canManage || !fromStoreId || !toStoreId || fromStoreId === toStoreId || Number(transferQuantity) > storeStock(selectedItem, fromStoreId)} className="h-9 rounded-md bg-ink px-4 text-xs font-semibold text-white disabled:opacity-50">{saving ? '處理中…' : '確認轉倉'}</button></div></div></form>}

        {dialog === 'store' && <form onSubmit={(event) => void createStore(event)} className="my-auto w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"><div className="mb-5 flex items-start justify-between"><div><p className="eyebrow">NEW LOCATION</p><h2 className="mt-1 text-lg font-semibold">新增分店</h2></div><button type="button" onClick={() => setDialog(null)} aria-label="關閉" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas"><X size={17} /></button></div><label className="block text-xs font-semibold">分店名稱<input required maxLength={120} value={storeName} onChange={(event) => setStoreName(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" placeholder="例如：台中門市" /></label><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">取消</button><button disabled={saving || !['admin', 'manager'].includes(profile?.role ?? '')} className="h-9 rounded-md bg-ink px-4 text-xs font-semibold text-white disabled:opacity-50">{saving ? '儲存中…' : '新增分店'}</button></div></form>}
      </div>}
    </div>
  );
}