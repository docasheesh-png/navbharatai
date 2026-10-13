/**
 * Go-live PR 14 — the wallet page's three doors and the intent deep link.
 *
 * WALLET_V2_UI (default OFF) shows exactly three primary buttons: Add Money, Buy Services,
 * Usage & Bills. A link such as `/wallet?intent=buy&sku=addon.server` (the chat card's Buy, PR 13)
 * opens the right door with the SKU pre-selected. PURE: parsing only, no navigation, no money.
 * An unknown intent or SKU falls back to the default door, never to a purchase.
 */
import { skuById } from './catalogue';

export const WALLET_DOORS = ['add_money', 'buy_services', 'usage_bills'] as const;
export type WalletDoor = (typeof WALLET_DOORS)[number];

export const WALLET_DOOR_LABEL: Readonly<Record<WalletDoor, string>> = Object.freeze({
  add_money: 'Add Money',
  buy_services: 'Buy Services',
  usage_bills: 'Usage & Bills',
});

export interface WalletIntent {
  door: WalletDoor;
  /** Pre-selected SKU for Buy Services; null when absent or unknown. */
  skuId: string | null;
  /** Suggested top-up in whole rupees for Add Money; null when absent or invalid. */
  amountInr: number | null;
}

const INTENT_DOOR: Record<string, WalletDoor> = {
  topup: 'add_money', add: 'add_money', add_money: 'add_money',
  buy: 'buy_services', buy_services: 'buy_services',
  usage: 'usage_bills', bills: 'usage_bills', usage_bills: 'usage_bills',
};

export function parseWalletIntent(search: string | null | undefined): WalletIntent {
  let q: URLSearchParams;
  try { q = new URLSearchParams(search ?? ''); } catch { q = new URLSearchParams(); }
  const door = INTENT_DOOR[(q.get('intent') ?? '').toLowerCase()] ?? 'add_money';
  const sku = q.get('sku');
  const skuId = door === 'buy_services' && sku && skuById(sku) ? sku : null;
  const amt = Number(q.get('amount'));
  const amountInr = door === 'add_money' && Number.isInteger(amt) && amt >= 1 && amt <= 100_000 ? amt : null;
  return { door, skuId, amountInr };
}

export function walletIntentSearch(i: Partial<WalletIntent> & { door: WalletDoor }): string {
  const q = new URLSearchParams({ intent: i.door });
  if (i.skuId) q.set('sku', i.skuId);
  if (i.amountInr) q.set('amount', String(i.amountInr));
  return `?${q.toString()}`;
}
