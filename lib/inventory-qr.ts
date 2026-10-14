const inventoryQrPrefix = 'camera-store-os:item:';
const inventoryUnitUrl = 'https://camerazinda.vercel.app/inventory';

export function inventoryQrValue(itemId: string) {
  return `${inventoryQrPrefix}${itemId}`;
}

export function inventoryUnitQrValue(unitId: string) {
  const url = new URL(inventoryUnitUrl);
  url.searchParams.set('unit', unitId);
  return url.toString();
}

export function inventoryItemIdFromQr(value: string) {
  const match = value.trim().match(/^camera-store-os:item:([0-9a-f-]{36})$/i);
  return match?.[1] ?? null;
}

export function inventoryUnitIdFromQr(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.pathname !== '/inventory') return null;
    const unitId = url.searchParams.get('unit');
    return unitId && /^[0-9a-f-]{36}$/i.test(unitId) ? unitId : null;
  } catch {
    const match = value.trim().match(/^camera-store-os:unit:([0-9a-f-]{36})$/i);
    return match?.[1] ?? null;
  }
}