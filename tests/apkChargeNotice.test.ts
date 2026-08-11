import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  chargeHint, chargeReceipt, chargeButtonLabel, readChargeHeaders,
  CHARGE_PRICE_HEADER, CHARGE_APPLIED_HEADER, APK_PRICE_INR,
} from '../src/lib/apkChargeNotice';

/**
 * ADMIN 2026-08-10: "apk download abhi free me ho raha hai — jabki maine kaha tha 1₹ per download!
 * Aur HAR BAR USER KO BATAYA JAYE."
 *
 * Two findings, and only the second is a defect:
 *   1. It is NOT free. `/api/mobile-ship/download` has charged ₹1 per built file since 2026-08-06.
 *      It reads free for the admin because their account is on AGENTV3_FREE_LIST — exempt everywhere
 *      by design, the same reason Professionals looked free.
 *   2. THE DEFECT: the user was never TOLD. The debit fired, the bytes streamed, and ₹1 left a real
 *      person's balance with no price before and no confirmation after — money taken silently.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('BEFORE the click — the price is never a surprise', () => {
  it('states the price AND the per-build rule in the same breath', () => {
    const hint = chargeHint(1);
    expect(hint).toContain('₹1');
    // Without this line, a user who re-downloads the same file is certain to think they were charged
    // twice — the debit is keyed to the artifact, so they were not.
    expect(hint).toMatch(/same file again is free/i);
  });

  it('says nothing at all when the charge is off — no empty "₹0" noise', () => {
    expect(chargeHint(0)).toBe('');
    expect(chargeButtonLabel(0)).toBe('Download');
    expect(chargeButtonLabel(1)).toBe('Download · ₹1');
  });

  it('is written in Hindi, not transliterated', () => {
    expect(chargeHint(1, 'hi')).toMatch(/[ऀ-ॿ]/);
    expect(chargeHint(1, 'hi')).toContain('₹1');
    expect(chargeHint(1, 'hi')).not.toContain('for each build');
  });
});

describe('AFTER the file arrives — the receipt can never claim a charge nobody paid', () => {
  it('confirms the exact amount when it really was taken', () => {
    const r = chargeReceipt({ priceInr: 1, applied: true });
    expect(r).toContain('₹1');
    expect(r).toMatch(/taken from your balance/i);
    expect(r).toMatch(/same file again is free/i);
  });

  it('a free-list account, an anon caller or a zero price all say "no charge"', () => {
    for (const c of [
      { priceInr: 1, applied: false },   // free-listed — why it looked free for the admin
      { priceInr: 0, applied: true },    // charge switched off
      { priceInr: 0, applied: false },
    ]) {
      const r = chargeReceipt(c);
      expect(r).toMatch(/no charge/i);
      expect(r).not.toMatch(/₹\d/);
    }
  });

  it('Hindi receipt is written, and keeps the same two facts', () => {
    const r = chargeReceipt({ priceInr: 1, applied: true, lang: 'hi' });
    expect(r).toMatch(/[ऀ-ॿ]/);
    expect(r).toContain('₹1');
    expect(chargeReceipt({ priceInr: 1, applied: false, lang: 'hi' })).toMatch(/कोई शुल्क नहीं/);
  });
});

describe('reading the server\'s own report — an unknown charge is NO charge', () => {
  const from = (h: Record<string, string>) => readChargeHeaders((n) => h[n]);

  it('reads a real charge', () => {
    expect(from({ [CHARGE_PRICE_HEADER]: '1', [CHARGE_APPLIED_HEADER]: 'true' }))
      .toEqual({ priceInr: 1, applied: true });
  });

  it('missing or malformed headers mean NOT charged — never an invented number', () => {
    // Same rule the wallet follows when a provider reports no usage: an unmeasured thing is not a bill.
    expect(from({})).toEqual({ priceInr: 0, applied: false });
    expect(from({ [CHARGE_PRICE_HEADER]: 'abc', [CHARGE_APPLIED_HEADER]: 'true' })).toEqual({ priceInr: 0, applied: false });
    expect(from({ [CHARGE_PRICE_HEADER]: '-5', [CHARGE_APPLIED_HEADER]: 'true' })).toEqual({ priceInr: 0, applied: false });
  });

  it('"applied" without a price cannot produce a receipt', () => {
    expect(from({ [CHARGE_APPLIED_HEADER]: 'true' }).applied).toBe(false);
  });

  it('a price with applied=false reports the price but no charge', () => {
    expect(from({ [CHARGE_PRICE_HEADER]: '1', [CHARGE_APPLIED_HEADER]: 'false' }))
      .toEqual({ priceInr: 1, applied: false });
  });
});

describe('WIRING — the server reports it and the screen says it', () => {
  const server = read('src/server/routes/mobileShip.ts');
  const panel = read('src/components/ide/StoreBuildPanel.tsx');

  it('the download response carries its own price and whether it charged', () => {
    expect(server).toContain('res.setHeader(CHARGE_PRICE_HEADER');
    expect(server).toContain('res.setHeader(CHARGE_APPLIED_HEADER');
    // A browser cannot read a custom header unless it is exposed.
    expect(server).toContain('Access-Control-Expose-Headers');
  });

  it('`applied` is only true when a charge genuinely happened', () => {
    const at = server.indexOf('let chargeApplied = false;');
    expect(at).toBeGreaterThan(-1);
    const seg = server.slice(at, at + 900);
    expect(seg).toContain('isAgentV3FreeUser(identity.uid, identity.email)');
    expect(seg).toContain('chargeApplied = apkChargeInr() > 0;');
  });

  it('the charge NEVER blocks the bytes — the debit is still fire-and-forget', () => {
    const at = server.indexOf('let chargeApplied = false;');
    expect(server.slice(at, at + 900)).toContain('void debitWalletForBuild(');
  });

  it('the screen shows the price BEFORE and the receipt AFTER', () => {
    expect(panel).toContain('chargeHint(APK_PRICE_INR)');
    expect(panel).toContain('setChargeNote(chargeReceipt(');
    expect(panel).toContain('readChargeHeaders((n) => res.headers.get(n))');
  });

  it('the client default matches the server default, so the pre-click price is not a fiction', () => {
    expect(APK_PRICE_INR).toBe(1);
    expect(read('src/server/lib/apkCharge.ts')).toContain("if (raw === '') return 1;");
  });
});
