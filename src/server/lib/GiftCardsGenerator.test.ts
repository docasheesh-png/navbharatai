import { describe, it, expect, afterAll } from 'vitest';

import { generateGiftCardsIntegration, GIFTCARDS_SERVICE_SOURCE } from './GiftCardsGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateGiftCardsIntegration (wiring)', () => {
  it('emits the gift-card service, routes and README', () => {
    const out = generateGiftCardsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/giftcards/giftCardService.ts');
    expect(paths).toContain('server/giftcards/routes.ts');
    expect(paths).toContain('server/giftcards/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/giftcards/routes.ts']).toContain('export const giftCardRouter');
    expect(out.files['server/giftcards/routes.ts']).toContain('/redeem');
  });
});

// Materialize + execute the emitted domain logic — the no-overdraw + exact-remainder rules are real business
// rules, verified against the actual emitted code.
describe('emitted GiftCardService — balance integrity (no overdraw, exact remainder) (real logic)', () => {
  const emitted = emitModule('giftcards', GIFTCARDS_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  interface Redemption { amountMinor: number; at: string; note: string }
  interface GiftCard { code: string; originalMinor: number; balanceMinor: number; currency: string; active: boolean; expiresAt: string | null; createdAt: string; redemptions: Redemption[] }
  interface Service {
    issue(amountMinor: number, opts?: { currency?: string; expiresAt?: string | null }, now?: Date): GiftCard;
    get(code: string): GiftCard | undefined;
    balance(code: string): number | null;
    redeem(code: string, amountMinor: number, note?: string, now?: Date): GiftCard;
    setActive(code: string, active: boolean): GiftCard;
    list(): GiftCard[];
  }
  interface Emitted { GiftCardService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('issues a unique card with the full balance and validates the amount', async () => {
    const { GiftCardService } = await load();
    const svc = new GiftCardService();
    const a = svc.issue(50000); // ₹500.00
    const b = svc.issue(50000);
    expect(a.code).not.toBe(b.code);
    expect(a.code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(a.balanceMinor).toBe(50000);
    expect(a.originalMinor).toBe(50000);
    expect(() => svc.issue(0)).toThrow(/positive integer/);
    expect(() => svc.issue(-100)).toThrow(/positive integer/);
  });

  it('THE INVARIANT: partial redemptions debit exactly and never overdraw; sum(redemptions)+balance===original', async () => {
    const { GiftCardService } = await load();
    const svc = new GiftCardService();
    const card = svc.issue(10000); // ₹100.00
    svc.redeem(card.code, 3000, 'order-1'); // -30
    let c = svc.get(card.code) as GiftCard;
    expect(c.balanceMinor).toBe(7000);
    svc.redeem(card.code, 7000, 'order-2'); // -70 -> exactly zero
    c = svc.get(card.code) as GiftCard;
    expect(c.balanceMinor).toBe(0);
    // sum of redemptions + remaining balance === original
    expect(c.redemptions.reduce((s, r) => s + r.amountMinor, 0) + c.balanceMinor).toBe(c.originalMinor);
    // a spent card can't be redeemed further
    expect(() => svc.redeem(card.code, 1, 'x')).toThrow(/insufficient balance/);
  });

  it('rejects a redemption larger than the remaining balance (no overdraw)', async () => {
    const { GiftCardService } = await load();
    const svc = new GiftCardService();
    const card = svc.issue(5000);
    expect(() => svc.redeem(card.code, 5001)).toThrow(/insufficient balance/); // 1 paisa over
    expect(svc.balance(card.code)).toBe(5000); // unchanged after the rejected redeem
    expect(() => svc.redeem(card.code, 0)).toThrow(/positive integer/);
  });

  it('an inactive or expired card is not redeemable', async () => {
    const { GiftCardService } = await load();
    const svc = new GiftCardService();
    const T0 = new Date('2026-01-01T00:00:00Z');
    const card = svc.issue(5000, { expiresAt: '2026-02-01T00:00:00Z' }, T0);
    // before expiry -> ok
    expect(svc.redeem(card.code, 1000, '', new Date('2026-01-15T00:00:00Z')).balanceMinor).toBe(4000);
    // after expiry -> refused
    expect(() => svc.redeem(card.code, 1000, '', new Date('2026-03-01T00:00:00Z'))).toThrow(/not redeemable/);
    // deactivate -> refused even before expiry
    const card2 = svc.issue(5000);
    svc.setActive(card2.code, false);
    expect(() => svc.redeem(card2.code, 100)).toThrow(/not redeemable/);
    svc.setActive(card2.code, true);
    expect(svc.redeem(card2.code, 100).balanceMinor).toBe(4900);
  });

  it('balance() and get() are case-insensitive on the code; unknown -> null/undefined', async () => {
    const { GiftCardService } = await load();
    const svc = new GiftCardService();
    const card = svc.issue(2500);
    expect(svc.balance(card.code.toLowerCase())).toBe(2500); // lower-case still resolves
    expect(svc.balance('NOPE-NOPE-NOPE')).toBeNull();
    expect(svc.get('nope')).toBeUndefined();
    expect(() => svc.redeem('NOPE-NOPE-NOPE', 100)).toThrow(/not redeemable/);
  });
});
