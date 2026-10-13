import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WalletDoors } from './WalletDoors';
import { parseWalletIntent, walletIntentSearch } from '../../lib/walletIntent';

describe('wallet v2 doors (PR 14)', () => {
  it('renders exactly three primary buttons with the agreed labels', () => {
    const html = renderToStaticMarkup(<WalletDoors active="add_money" onSelect={() => {}} />);
    expect(html.match(/<button/g)?.length).toBe(3);
    for (const l of ['Add Money', 'Buy Services', 'Usage &amp; Bills']) expect(html).toContain(l);
  });
  it('the chat card Buy link opens Buy Services with the SKU', () => {
    expect(parseWalletIntent('?intent=buy&sku=addon.server')).toEqual({ door: 'buy_services', skuId: 'addon.server', amountInr: null });
  });
  it('unknown intent/SKU/amount fall back safely', () => {
    expect(parseWalletIntent('?intent=hack&sku=x')).toEqual({ door: 'add_money', skuId: null, amountInr: null });
    expect(parseWalletIntent('?intent=buy&sku=nope').skuId).toBeNull();
    expect(parseWalletIntent('?intent=topup&amount=-5').amountInr).toBeNull();
    expect(parseWalletIntent('?intent=topup&amount=500').amountInr).toBe(500);
    expect(parseWalletIntent(undefined).door).toBe('add_money');
  });
  it('round-trips', () => {
    const i = { door: 'buy_services' as const, skuId: 'byo.supabase', amountInr: null };
    expect(parseWalletIntent(walletIntentSearch(i))).toEqual(i);
  });
});
