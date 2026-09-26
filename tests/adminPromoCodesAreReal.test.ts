/**
 * The codes the admin makes in Admin → Settings → Promo Code Generator are REAL (admin 2026-09-26).
 *
 * Until this date the generator wrote to `promo_codes` and NOTHING read it: the user's Promocode box
 * asked only the gift codes and the PROMO_COUPONS env table, so every admin-made code was answered
 * "Invalid or expired". The admin asked for a Delete button; the honest answer was that the codes it
 * would delete had never worked, and the admin chose to make them real (1,000 tokens = ₹10).
 *
 * These tests run the REAL transaction code against a small in-memory Firestore, so what they prove is
 * the money path itself, not a copy of its rules.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseAdminPromoInput,
  decideAdminPromoRedemption,
  adminPromoStatus,
  normalizeAdminPromoCode,
  ADMIN_PROMO_MAX_TOKENS,
} from '../src/server/lib/adminPromoCodes';
import { createAdminPromo, redeemAdminPromo, promoClaimId } from '../src/server/lib/adminPromoStore';

// ── A minimal Firestore: enough of the admin SDK surface that serverDb.ts calls. ──────────────────
function makeDb() {
  const store = new Map<string, any>();
  const snap = (path: string) => {
    const has = store.has(path);
    return { exists: has, data: () => (has ? { ...store.get(path) } : undefined), id: path.split('/').pop(), ref: { path }, get: (f: string) => store.get(path)?.[f] };
  };
  const db = {
    store,
    doc: (path: string) => ({ path, get: async () => snap(path) }),
    // Serialised, all-or-nothing: writes are staged and applied only if the body returns.
    runTransaction: async (fn: (t: any) => Promise<any>) => {
      const staged: Array<() => void> = [];
      const t = {
        get: async (ref: any) => snap(ref.path),
        set: (ref: any, data: any) => { staged.push(() => store.set(ref.path, { ...data })); },
        update: (ref: any, data: any) => { staged.push(() => store.set(ref.path, { ...store.get(ref.path), ...data })); },
        delete: (ref: any) => { staged.push(() => store.delete(ref.path)); },
      };
      const out = await fn(t);
      for (const w of staged) w();
      return out;
    },
  };
  return db;
}

const NOW = new Date('2026-09-26T10:00:00Z');

describe('what the admin may create', () => {
  it('accepts the shapes the admin really types, including an email-shaped code', () => {
    const r = parseAdminPromoInput({ code: 'kumar11d99@gmail.com', freeTokens: 1000, maxUses: 1 });
    expect(r).toEqual({ ok: true, value: { code: 'KUMAR11D99@GMAIL.COM', freeTokens: 1000, maxUses: 1 } });
  });

  it('refuses a code worth nothing, a fraction, or more than the ₹5,000 ceiling', () => {
    expect(parseAdminPromoInput({ code: 'SAVE50', freeTokens: 0 }).ok).toBe(false);
    expect(parseAdminPromoInput({ code: 'SAVE50', freeTokens: 12.5 }).ok).toBe(false);
    expect(parseAdminPromoInput({ code: 'SAVE50', freeTokens: 'abc' }).ok).toBe(false);
    expect(parseAdminPromoInput({ code: 'SAVE50', freeTokens: ADMIN_PROMO_MAX_TOKENS + 1 }).ok).toBe(false);
    expect(parseAdminPromoInput({ code: 'SAVE50', freeTokens: ADMIN_PROMO_MAX_TOKENS }).ok).toBe(true);
  });

  it('refuses a code that cannot be a document id', () => {
    expect(normalizeAdminPromoCode('a/b')).toBeNull();
    expect(normalizeAdminPromoCode('ab')).toBeNull();
    expect(normalizeAdminPromoCode('  save50 ')).toBe('SAVE50');
  });

  it('defaults Max uses to 1 and refuses a nonsense one', () => {
    const r = parseAdminPromoInput({ code: 'SAVE50', freeTokens: 500 });
    expect(r.ok && r.value.maxUses).toBe(1);
    expect(parseAdminPromoInput({ code: 'SAVE50', freeTokens: 500, maxUses: 0 }).ok).toBe(false);
    expect(parseAdminPromoInput({ code: 'SAVE50', freeTokens: 500, maxUses: 1e9 }).ok).toBe(false);
  });
});

describe('the redemption rule', () => {
  it('reads a code written by the OLD generator (discountPct, no usedCount) the same way', () => {
    expect(decideAdminPromoRedemption({ code: 'X', freeTokens: 1000, discountPct: 0, maxUses: 1, active: true } as any, NOW.getTime()))
      .toEqual({ ok: true, tokens: 1000 });
  });

  it('refuses an inactive, expired, used-up or worthless code, and the admin table says which', () => {
    const t = NOW.getTime();
    expect(adminPromoStatus({ freeTokens: 10, active: false }, t)).toBe('Inactive');
    expect(adminPromoStatus({ freeTokens: 10, expiresAt: '2026-01-01T00:00:00Z' }, t)).toBe('Expired');
    expect(adminPromoStatus({ freeTokens: 10, maxUses: 2, usedCount: 2 }, t)).toBe('Used up');
    expect(adminPromoStatus({ freeTokens: 0 }, t)).toBe('No value');
    expect(adminPromoStatus({ freeTokens: 10, maxUses: 2, usedCount: 1 }, t)).toBe('Active');
  });
});

describe('the money path, end to end', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it('credits the code in the wallet unit — 1,000 tokens is ₹10 — and counts the use', async () => {
    expect((await createAdminPromo(db, { code: 'KUMAR11D99@GMAIL.COM', freeTokens: 1000, maxUses: 1 }, NOW.toISOString())).ok).toBe(true);
    const r = await redeemAdminPromo(db, 'KUMAR11D99@GMAIL.COM', { userId: 'u1' }, NOW);
    expect(r).toMatchObject({ kind: 'credited', tokens: 1000, balanceAddedInr: 10, currentBalance: 10 });
    const wallet = db.store.get('user_token_wallets/u1');
    expect(wallet.tokenBalance).toBe(1000);
    expect(wallet.remaining_balance).toBe(10);
    expect(db.store.get('promo_codes/KUMAR11D99@GMAIL.COM').usedCount).toBe(1);
    expect(db.store.get(`payment_transactions/${promoClaimId('KUMAR11D99@GMAIL.COM', 'u1')}`).paymentProvider).toBe('ADMIN_PROMO_REDEEM');
  });

  it('adds to an existing balance rather than replacing it', async () => {
    db.store.set('user_token_wallets/u1', { tokenBalance: 5000, remaining_balance: 50 });
    await createAdminPromo(db, { code: 'SAVE50', freeTokens: 500 }, NOW.toISOString());
    await redeemAdminPromo(db, 'SAVE50', { userId: 'u1' }, NOW);
    expect(db.store.get('user_token_wallets/u1')).toMatchObject({ tokenBalance: 5500, remaining_balance: 55 });
  });

  it('lets one person redeem a code once, however many uses it has', async () => {
    await createAdminPromo(db, { code: 'SAVE50', freeTokens: 500, maxUses: 10 }, NOW.toISOString());
    expect((await redeemAdminPromo(db, 'SAVE50', { userId: 'u1' }, NOW)).kind).toBe('credited');
    expect((await redeemAdminPromo(db, 'SAVE50', { userId: 'u1' }, NOW)).kind).toBe('already');
    expect(db.store.get('user_token_wallets/u1').tokenBalance).toBe(500);
  });

  it('stops at Max uses — the second person after the last use gets nothing', async () => {
    await createAdminPromo(db, { code: 'ONLY2', freeTokens: 100, maxUses: 2 }, NOW.toISOString());
    expect((await redeemAdminPromo(db, 'ONLY2', { userId: 'a' }, NOW)).kind).toBe('credited');
    expect((await redeemAdminPromo(db, 'ONLY2', { userId: 'b' }, NOW)).kind).toBe('credited');
    expect(await redeemAdminPromo(db, 'ONLY2', { userId: 'c' }, NOW)).toEqual({ kind: 'refused', reason: 'used-up' });
    expect(db.store.has('user_token_wallets/c')).toBe(false);
  });

  it('refuses to re-create a code, which used to reset its use count to 0', async () => {
    await createAdminPromo(db, { code: 'ONCE', freeTokens: 100, maxUses: 1 }, NOW.toISOString());
    await redeemAdminPromo(db, 'ONCE', { userId: 'a' }, NOW);
    const again = await createAdminPromo(db, { code: 'ONCE', freeTokens: 100, maxUses: 1 }, NOW.toISOString());
    expect(again).toMatchObject({ ok: false, status: 409 });
    expect(db.store.get('promo_codes/ONCE').usedCount).toBe(1);
  });

  it('a code that does not exist — or was deleted — credits nothing', async () => {
    expect(await redeemAdminPromo(db, 'NOPE', { userId: 'u1' }, NOW)).toEqual({ kind: 'not-found' });
    await createAdminPromo(db, { code: 'GONE', freeTokens: 100 }, NOW.toISOString());
    db.store.delete('promo_codes/GONE');
    expect(await redeemAdminPromo(db, 'GONE', { userId: 'u1' }, NOW)).toEqual({ kind: 'not-found' });
    expect(db.store.has('user_token_wallets/u1')).toBe(false);
  });
});

describe('the wiring', () => {
  const root = join(__dirname, '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf8');

  it('the Promocode box asks the admin codes after the env table, never before', () => {
    const pay = read('src/server/routes/payment.ts');
    const at = pay.indexOf("app.post('/api/payment/redeem-coupon'");
    const block = pay.slice(at, pay.indexOf('app.post', at + 10));
    const env = block.indexOf('couponValueInr(code)');
    const admin = block.indexOf('redeemAdminPromo(db');
    expect(env).toBeGreaterThan(-1);
    expect(admin).toBeGreaterThan(env);
  });

  it('the admin can create, list and DELETE codes, and the create no longer overwrites', () => {
    const adm = read('src/server/routes/admin.ts');
    expect(adm).toContain("app.delete('/api/admin/promo/:code', verifyAdminToken");
    expect(adm).toContain('createAdminPromo(db, req.body');
    const post = adm.slice(adm.indexOf("app.post('/api/admin/promo'"), adm.indexOf("app.get('/api/admin/promo'"));
    expect(post).not.toContain('setDoc(');
  });

  it('the admin screen has a Delete button and no Discount % field', () => {
    const ui = read('src/components/AdminDashboard.tsx');
    const at = ui.indexOf('Promo Code Generator');
    const section = ui.slice(at, at + 9000);
    expect(section).toMatch(/Delete/);
    expect(section).not.toMatch(/Discount %/);
    expect(ui).toContain("method: 'DELETE'");
    expect(ui).toMatch(/\/api\/admin\/promo\/\$\{encodeURIComponent\(/);
  });
});
