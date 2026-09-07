import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { purchaseRail, packBreakdown, purchaseMessage, type StoreConfig, type StorePack } from '../src/lib/storePurchase';
import { outcomeForNativeStatus } from '../src/lib/playBillingNative';
import { DEFAULT_STORE_PACKS } from '../src/server/lib/storeBilling';

/**
 * Google Play Billing — the client's pure decision layer. This is money code that runs on a device
 * no test can hold, so every rule that decides WHICH RAIL a user buys on, and WHAT NUMBER they are
 * shown before paying, is proven here instead.
 */

const pack = (over: Partial<StorePack> = {}): StorePack => ({
  productId: 'nbai.tokens.99', priceInr: 119, creditInr: 99, label: '₹99 of credit', ...over,
});
const config = (over: Partial<StoreConfig> = {}): StoreConfig => ({
  enabled: true, apple: false, google: true, packs: [pack()], ...over,
});

describe('purchaseRail — the fallback is always the WORKING path, never an error', () => {
  it('uses the Play rail only when native, plugin-ready, enabled, google-configured and stocked', () => {
    expect(purchaseRail({ isNative: true, config: config(), pluginReady: true })).toBe('play-billing');
  });

  it('keeps the web gateway on the web, whatever the server says', () => {
    expect(purchaseRail({ isNative: false, config: config(), pluginReady: true })).toBe('web-gateway');
  });

  it('keeps the web gateway on an older shell whose build has no native plugin', () => {
    // Shipping this feature must not strand a user who has not updated their app.
    expect(purchaseRail({ isNative: true, config: config(), pluginReady: false })).toBe('web-gateway');
  });

  it('keeps the web gateway when the server flag is off — the flag IS the migration switch', () => {
    expect(purchaseRail({ isNative: true, config: config({ enabled: false }), pluginReady: true })).toBe('web-gateway');
  });

  it('keeps the web gateway when Google verification is not configured', () => {
    // Offering a purchase the server could never verify would take money it could not credit.
    expect(purchaseRail({ isNative: true, config: config({ google: false }), pluginReady: true })).toBe('web-gateway');
  });

  it('keeps the web gateway when there is nothing to sell', () => {
    expect(purchaseRail({ isNative: true, config: config({ packs: [] }), pluginReady: true })).toBe('web-gateway');
  });

  it('keeps the web gateway when the config request failed entirely (fails CLOSED)', () => {
    expect(purchaseRail({ isNative: true, config: null, pluginReady: true })).toBe('web-gateway');
  });
});

describe('packBreakdown — the bill line the user reads before paying', () => {
  it('splits the real catalogue pack into credit + fee = price', () => {
    const b = packBreakdown(pack());
    expect(b.creditInr).toBe(99);
    expect(b.storeFeeInr).toBe(20);
    expect(b.priceInr).toBe(119);
    expect(b.creditInr + b.storeFeeInr).toBe(b.priceInr); // the line must always add up
  });

  it('adds up for EVERY pack the server actually ships', () => {
    // The numbers a user sees are arithmetic on the server's own catalogue, never typed in — so if
    // a pack's price is ever retuned, this test proves the displayed line still reconciles.
    for (const p of DEFAULT_STORE_PACKS) {
      const b = packBreakdown(p);
      expect(b.creditInr + b.storeFeeInr).toBe(b.priceInr);
      expect(b.storeFeeInr).toBeGreaterThanOrEqual(0);
    }
  });

  it('never renders a NEGATIVE fee (which would read as a discount we are not giving)', () => {
    const b = packBreakdown(pack({ priceInr: 99, creditInr: 149 }));
    expect(b.storeFeeInr).toBe(0);
    expect(b.feeFree).toBe(true);
    expect(b.creditInr).toBeLessThanOrEqual(b.priceInr); // can never credit more than was paid
  });

  it('flags a fee-free pack so the fee line is hidden rather than shown as ₹0', () => {
    expect(packBreakdown(pack({ priceInr: 99, creditInr: 99 })).feeFree).toBe(true);
    expect(packBreakdown(pack()).feeFree).toBe(false);
  });

  it('survives a malformed pack without producing NaN on screen', () => {
    const b = packBreakdown({ productId: 'x', priceInr: NaN, creditInr: NaN, label: '' });
    expect(Number.isFinite(b.priceInr)).toBe(true);
    expect(Number.isFinite(b.creditInr)).toBe(true);
    expect(Number.isFinite(b.storeFeeInr)).toBe(true);
  });
});

describe('purchaseMessage — a money message must never mis-state whether the user was charged', () => {
  it('says plainly that a cancelled purchase was not charged', () => {
    expect(purchaseMessage('cancelled')).toMatch(/not been charged/i);
  });

  it('says plainly that a failed purchase was not charged', () => {
    expect(purchaseMessage('failed')).toMatch(/not been charged/i);
  });

  it('NEVER claims "not charged" when Google took the money but we could not credit yet', () => {
    const msg = purchaseMessage('paid-not-verified');
    expect(msg).not.toMatch(/not been charged/i);
    expect(msg).toMatch(/automatically/i);          // tells them it self-heals
    expect(msg).toMatch(/not be charged twice/i);   // and that a retry is safe
  });

  it('every outcome has a real sentence', () => {
    for (const o of ['credited', 'already-credited', 'cancelled', 'paid-not-verified', 'failed', 'unavailable'] as const) {
      expect(purchaseMessage(o).length).toBeGreaterThan(10);
    }
  });
});

describe('outcomeForNativeStatus — only statuses the device alone can decide', () => {
  it('maps the device-decidable statuses', () => {
    expect(outcomeForNativeStatus('cancelled')).toBe('cancelled');
    expect(outcomeForNativeStatus('failed')).toBe('failed');
    expect(outcomeForNativeStatus('unavailable')).toBe('unavailable');
  });

  it('refuses to decide `purchased` — only the SERVER may say a wallet was credited', () => {
    // A device claiming success is exactly the thing the server-side verification exists to distrust.
    expect(outcomeForNativeStatus('purchased')).toBeNull();
  });

  it('refuses to decide `pending` — deferred payment has not arrived yet', () => {
    expect(outcomeForNativeStatus('pending')).toBeNull();
  });
});

describe('the native wiring exists and its ORDER is the safety property', () => {
  // These read the real source files, the same cheap structural technique tests/storeBilling.test.ts
  // already uses on the payment route — it locks invariants that no unit test can reach because
  // they only exist on a device we cannot hold in CI.
  const read = (p: string) => readFileSync(p, 'utf8');

  it('MainActivity registers the Play Billing plugin (without it the web side sees nothing)', () => {
    const activity = read('android/app/src/main/java/com/navbharatai/app/MainActivity.java');
    expect(activity).toContain('registerPlugin(PlayBillingPlugin.class)');
  });

  it('the Play Billing library is a real gradle dependency, at v7+ (Google\'s floor for new submissions)', () => {
    const gradle = read('android/app/build.gradle');
    const m = gradle.match(/com\.android\.billingclient:billing:(\d+)\./);
    expect(m, 'billing dependency missing from android/app/build.gradle').not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(7);
  });

  it('🔒 the wallet is CREDITED BEFORE the purchase is consumed', () => {
    // THE bug this guards: consuming first erases Google's record of a purchase the user paid for —
    // unrecoverable. Crediting first and failing to consume merely leaves it replayable, which the
    // idempotent server route absorbs. One order can lose a user's money; the other cannot.
    const hook = read('src/hooks/usePaymentEngine.ts');
    const credit = hook.indexOf('await creditPlayPurchase(');
    const consume = hook.indexOf('await consumePlayPurchase(');
    expect(credit, 'creditPlayPurchase call not found').toBeGreaterThan(-1);
    expect(consume, 'consumePlayPurchase call not found').toBeGreaterThan(-1);
    expect(credit).toBeLessThan(consume);
  });

  it('a purchase is consumed ONLY inside a credited branch, never unconditionally', () => {
    const hook = read('src/hooks/usePaymentEngine.ts');
    // Every consume must be guarded by having seen a credited/already-credited outcome first.
    for (const line of hook.split('\n')) {
      if (!line.includes('consumePlayPurchase(')) continue;
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue; // prose, not code
      if (line.includes('import')) continue;
      // the guard sits above it in the same block; assert the file never consumes at top level of
      // the buy flow by requiring the credited check to appear before every consume call site.
      const upto = hook.slice(0, hook.indexOf(line));
      expect(upto).toMatch(/outcome === 'credited'|'already-credited'/);
    }
  });

  it('the server is asked to verify with the platform pinned to google', () => {
    const hook = read('src/hooks/usePaymentEngine.ts');
    expect(hook).toContain("'/api/payment/store/verify'");
    expect(hook).toMatch(/platform:\s*'google'/);
  });
});
