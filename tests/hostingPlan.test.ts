import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  HOSTING_PLAN_ID, HOSTING_PLAN_DAYS, hostingPlansEnabled, hostingPlanPriceInr, hostingPlanActive,
  computePlanPurchase, computeLazyRenewal, purchaseHostingPlan, readHostingPlanStatus,
  probeHostingPlan, _clearPlanCacheForTests,
} from '../src/server/lib/hostingPlan';
import { HOSTING_TIERS, LEGACY_HOSTING_PLAN_ID, hostingAgreementTerms, overageInr, tierForPlanId } from '../src/lib/hostingTiers';
import { setServerDb } from '../src/server/lib/serverDb';
import { TOKENS_PER_RUPEE } from '../src/server/lib/payments';

/**
 * ₹99/30d Custom Domain plan (admin-approved 2026-08-06 "han"). The money rules under test: same
 * wallet, same debit math as builds, NO overdraft for a discretionary purchase, idempotent per
 * period, lazy renewal that can only fire once per lapse, and honest lapse when the balance is short.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = '2026-08-06T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
// The catalogue's ENTRY tier is what an un-tiered purchase buys, so its price is the unit here.
const STARTER = HOSTING_TIERS[0];
const PRICE_TOKENS = STARTER.priceInr * TOKENS_PER_RUPEE;
/**
 * Every purchase in this file passes the agreement tick, because since 2026-09-10 a purchase without
 * it is REFUSED — the tick is what makes the plan's overage terms chargeable, so a plan record
 * created without one must not exist. The refusal itself is tested on its own below.
 */
const AGREED = { agreedToTerms: true };

function wallet(tokens: number, extra: Record<string, any> = {}): Record<string, any> {
  return { userId: 'u1', tokenBalance: tokens, totalTokensUsed: 0, remaining_balance: tokens / TOKENS_PER_RUPEE, walletLedger: [], ...extra };
}

afterEach(() => {
  delete process.env.AGENTV3_HOSTING_PLANS;
  delete process.env.HOSTING_PLAN_PRICE_INR;
  setServerDb(null);
  _clearPlanCacheForTests();
});

describe('flags and price', () => {
  it('plans are ON by default, off/false/0 disables; the entry price is Starter and is env-tunable', () => {
    expect(hostingPlansEnabled()).toBe(true);
    process.env.AGENTV3_HOSTING_PLANS = 'off';
    expect(hostingPlansEnabled()).toBe(false);
    expect(hostingPlanPriceInr()).toBe(STARTER.priceInr);
    process.env.HOSTING_PLAN_PRICE_INR = '249';
    expect(hostingPlanPriceInr()).toBe(249);
    process.env.HOSTING_PLAN_PRICE_INR = '-5';
    expect(hostingPlanPriceInr()).toBe(STARTER.priceInr); // junk never becomes a price
  });
});

describe('computePlanPurchase', () => {
  it('debits exactly the Starter price in tokens, grants its period, writes the ledger row', () => {
    const r = computePlanPurchase(wallet(PRICE_TOKENS + 500), NOW, STARTER.id, AGREED);
    if (!r.ok) throw new Error('expected ok');
    expect(r.charged).toBe(true);
    expect(r.wallet.tokenBalance).toBe(500);
    expect(r.plan.id).toBe(STARTER.id);
    expect(Date.parse(r.plan.expiresAt)).toBe(NOW_MS + STARTER.days * DAY);
    expect(r.plan.autoRenew).toBe(true);
    // The agreement is FROZEN onto the record as it was shown — that is what makes overage
    // chargeable later, and what a legacy plan (no agreement) deliberately lacks.
    expect(r.plan.agreedAt).toBe(NOW);
    expect(r.plan.agreedTerms).toEqual(hostingAgreementTerms(STARTER));
    const row = r.wallet.walletLedger.at(-1);
    expect(row.description).toContain(`Hosting plan — ${STARTER.name}`);
    expect(hostingPlanActive(r.wallet, NOW_MS)).toBe(true);
    expect(hostingPlanActive(r.wallet, NOW_MS + 31 * DAY)).toBe(false);
  });

  it('NO overdraft: a short balance is refused with the shortfall, nothing changes', () => {
    const w = wallet(PRICE_TOKENS - 1000);
    const r = computePlanPurchase(w, NOW, STARTER.id, AGREED);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('insufficient');
    expect(r.shortfallTokens).toBe(1000);
    expect(w.tokenBalance).toBe(PRICE_TOKENS - 1000); // untouched
  });

  it('buying while active EXTENDS from the current expiry — paying early never loses days', () => {
    const first = computePlanPurchase(wallet(3 * PRICE_TOKENS), NOW, STARTER.id, AGREED);
    if (!first.ok) throw new Error('expected ok');
    const second = computePlanPurchase(first.wallet, new Date(NOW_MS + 10 * DAY).toISOString(), STARTER.id, AGREED);
    if (!second.ok) throw new Error('expected ok');
    expect(Date.parse(second.plan.expiresAt)).toBe(NOW_MS + 60 * DAY); // 30 + 30, not 10 + 30
    expect(second.wallet.tokenBalance).toBe(PRICE_TOKENS);
  });

  it('is idempotent per period: replaying the same purchase charges nothing more', () => {
    const first = computePlanPurchase(wallet(2 * PRICE_TOKENS), NOW, STARTER.id, AGREED);
    if (!first.ok) throw new Error('expected ok');
    // Same period start (same NOW, still-active plan extends from expiry — so replay the RAW result):
    const replay = computePlanPurchase({ ...first.wallet, hostingPlan: { ...first.plan, expiresAt: NOW } }, NOW, STARTER.id, AGREED);
    if (!replay.ok) throw new Error('expected ok');
    expect(replay.charged).toBe(false); // ledger ref already present — no second debit
    expect(replay.wallet.tokenBalance).toBe(first.wallet.tokenBalance);
  });

  it('plans disabled ⇒ refused as disabled', () => {
    process.env.AGENTV3_HOSTING_PLANS = 'off';
    const r = computePlanPurchase(wallet(2 * PRICE_TOKENS), NOW, STARTER.id, AGREED);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('disabled');
  });
});

describe('the two tiers (admin 2026-09-10: "do tier banao, credit bundle karo, 20 GB theek hai")', () => {
  const GROWTH = HOSTING_TIERS[1];

  it('the catalogue is exactly Starter ₹149 and Growth ₹499 — and Business is deliberately not buyable', () => {
    expect(HOSTING_TIERS.map((t) => [t.id, t.priceInr, t.includedTransferGb, t.domains, t.bundledCreditInr]))
      .toEqual([['starter', 149, 5, 1, 0], ['growth', 499, 20, 3, 150]]);
    // A ₹2,999 tier with no customers would be a promise about capacity and support that no code
    // keeps. It is "talk to us" until a real customer defines it.
    expect(HOSTING_TIERS.find((t) => t.priceInr > 999)).toBeUndefined();
  });

  it('🔒 a purchase WITHOUT the agreement tick is refused, and nothing is charged', () => {
    // The tick is not decoration: it is what makes the overage charge chargeable. A plan record with
    // no agreement must be impossible to create, not merely awkward to reach from the UI.
    const w = wallet(5 * PRICE_TOKENS);
    const r = computePlanPurchase(w, NOW, STARTER.id, {});
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('agreement_required');
  });

  it('the agreement says the limit, the overage rate, AND that the app is never switched off', () => {
    const terms = hostingAgreementTerms(GROWTH).join(' ');
    expect(terms).toContain('20 GB');
    expect(terms).toContain('₹20 per GB');
    expect(terms).toContain('KEEP RUNNING');
    expect(terms).toContain('₹499');
    expect(terms).toContain('₹150');
    // The terms are generated FROM the tier, so a price change cannot leave the agreement quoting
    // the old one. Proven by asserting Starter's differ in exactly the tier-derived places.
    expect(hostingAgreementTerms(STARTER).join(' ')).toContain('5 GB');
    expect(hostingAgreementTerms(STARTER).join(' ')).not.toContain('₹150');
  });

  it('Growth grants its ₹150 bundled credit at purchase — and again on each renewal', () => {
    const start = wallet(GROWTH.priceInr * TOKENS_PER_RUPEE);
    const r = computePlanPurchase(start, NOW, GROWTH.id, AGREED);
    if (!r.ok) throw new Error('expected ok');
    expect(r.bundledCreditInr).toBe(150);
    // Paid ₹499, received ₹150 back as ordinary credit.
    expect(r.wallet.tokenBalance).toBe(150 * TOKENS_PER_RUPEE);
    expect(r.wallet.walletLedger.at(-1).description).toContain('₹150 build credit included');

    const expired = { ...r.plan, expiresAt: new Date(NOW_MS - DAY).toISOString() };
    const topped = { ...r.wallet, hostingPlan: expired, tokenBalance: GROWTH.priceInr * TOKENS_PER_RUPEE };
    const renewed = computeLazyRenewal(topped, NOW);
    expect(renewed.renewed).toBe(true);
    expect(renewed.wallet.tokenBalance).toBe(150 * TOKENS_PER_RUPEE);
  });

  it('a replayed purchase grants NO second month of credit for one payment', () => {
    const first = computePlanPurchase(wallet(3 * GROWTH.priceInr * TOKENS_PER_RUPEE), NOW, GROWTH.id, AGREED);
    if (!first.ok) throw new Error('expected ok');
    const replay = computePlanPurchase(
      { ...first.wallet, hostingPlan: { ...first.plan, expiresAt: NOW } }, NOW, GROWTH.id, AGREED,
    );
    if (!replay.ok) throw new Error('expected ok');
    expect(replay.charged).toBe(false);
    expect(replay.bundledCreditInr).toBe(0);
    expect(replay.wallet.tokenBalance).toBe(first.wallet.tokenBalance);
  });

  it('UPGRADING mid-period returns the unused days as credit, then charges the new tier in full', () => {
    const bought = computePlanPurchase(wallet(10 * PRICE_TOKENS), NOW, STARTER.id, AGREED);
    if (!bought.ok) throw new Error('expected ok');
    const day3 = new Date(NOW_MS + 3 * DAY).toISOString();
    const up = computePlanPurchase(bought.wallet, day3, GROWTH.id, AGREED);
    if (!up.ok) throw new Error('expected ok');
    // 27 of 30 Starter days left, at ₹149/30 per day.
    expect(up.creditedInr).toBeCloseTo((27 * 149) / 30, 1);
    expect(up.plan.id).toBe(GROWTH.id);
    // A full new period from TODAY — the old one was paid back, so it is not extended.
    expect(Date.parse(up.plan.expiresAt)).toBe(Date.parse(day3) + GROWTH.days * DAY);
    expect(up.wallet.walletLedger.some((r: any) => String(r.description).includes('Unused days'))).toBe(true);
  });

  it('a DOWNGRADE while the higher tier is still live is refused rather than silently shortening it', () => {
    const g = computePlanPurchase(wallet(10 * GROWTH.priceInr * TOKENS_PER_RUPEE), NOW, GROWTH.id, AGREED);
    if (!g.ok) throw new Error('expected ok');
    const down = computePlanPurchase(g.wallet, new Date(NOW_MS + DAY).toISOString(), STARTER.id, AGREED);
    expect(down.ok).toBe(false);
  });

  it('overage is charged only past the allowance, and by the part-GB', () => {
    expect(overageInr(5, STARTER)).toBe(0);
    expect(overageInr(5.5, STARTER)).toBe(10);      // 0.5 GB × ₹20
    expect(overageInr(25, GROWTH)).toBe(100);       // 5 GB × ₹20
    expect(overageInr(NaN, STARTER)).toBe(0);
  });
});

describe('the legacy ₹99 plan is honoured, never quietly repriced', () => {
  const legacy = {
    id: LEGACY_HOSTING_PLAN_ID, purchasedAt: NOW,
    expiresAt: new Date(NOW_MS - DAY).toISOString(), autoRenew: true,
  };

  it('it still counts as ACTIVE and grants Starter entitlements', () => {
    const live = { ...legacy, expiresAt: new Date(NOW_MS + DAY).toISOString() };
    expect(hostingPlanActive(wallet(0, { hostingPlan: live }), NOW_MS)).toBe(true);
    expect(tierForPlanId(LEGACY_HOSTING_PLAN_ID)?.id).toBe('starter');
  });

  it('🔒 it renews at ₹99, NOT at the new ₹149 — raising a live subscription is not ours to do', () => {
    const r = computeLazyRenewal(wallet(200 * TOKENS_PER_RUPEE, { hostingPlan: legacy }), NOW);
    expect(r.renewed).toBe(true);
    expect(r.wallet.tokenBalance).toBe(101 * TOKENS_PER_RUPEE); // 200 − 99
    expect(r.wallet.walletLedger.at(-1).description).toContain('Custom Domain');
  });

  it('it carries NO agreement, which is exactly why nothing beyond its price may be billed to it', () => {
    expect((legacy as any).agreedAt).toBeUndefined();
  });
});

describe('computeLazyRenewal', () => {
  const expiredPlan = { id: STARTER.id, purchasedAt: NOW, expiresAt: new Date(NOW_MS - DAY).toISOString(), autoRenew: true };

  it('renews an expired auto-renew plan for 30 days FROM NOW (never back-dated)', () => {
    const r = computeLazyRenewal(wallet(2 * PRICE_TOKENS, { hostingPlan: expiredPlan }), NOW);
    expect(r.renewed).toBe(true);
    expect(r.applied).toBe(true);
    expect(Date.parse((r.wallet.hostingPlan as any).expiresAt)).toBe(NOW_MS + STARTER.days * DAY);
    expect(r.wallet.tokenBalance).toBe(PRICE_TOKENS);
    expect(r.wallet.walletLedger.at(-1).description).toContain('auto-renewal');
  });

  it('can only fire once per lapse (ref keyed on the old expiry)', () => {
    const first = computeLazyRenewal(wallet(3 * PRICE_TOKENS, { hostingPlan: expiredPlan }), NOW);
    // Replay against the ALREADY-RENEWED wallet but force the plan to look expired again with the
    // SAME old expiry — the ledger ref blocks the second charge.
    const replay = computeLazyRenewal({ ...first.wallet, hostingPlan: expiredPlan }, NOW);
    expect(replay.renewed).toBe(false);
    expect(replay.wallet.tokenBalance).toBe(first.wallet.tokenBalance);
  });

  it('autoRenew off, still-active, short balance, or plans-off ⇒ untouched', () => {
    expect(computeLazyRenewal(wallet(2 * PRICE_TOKENS, { hostingPlan: { ...expiredPlan, autoRenew: false } }), NOW).applied).toBe(false);
    expect(computeLazyRenewal(wallet(2 * PRICE_TOKENS, { hostingPlan: { ...expiredPlan, expiresAt: new Date(NOW_MS + DAY).toISOString() } }), NOW).applied).toBe(false);
    const short = computeLazyRenewal(wallet(100, { hostingPlan: expiredPlan }), NOW);
    expect(short.applied).toBe(false);
    expect(short.wallet.tokenBalance).toBe(100); // an unaffordable renewal charges NOTHING
    process.env.AGENTV3_HOSTING_PLANS = 'off';
    expect(computeLazyRenewal(wallet(2 * PRICE_TOKENS, { hostingPlan: expiredPlan }), NOW).applied).toBe(false);
  });
});

// ---------- I/O paths against an injected fake Firestore ----------

/**
 * Emulates exactly the admin-SDK surface serverDb's wrappers touch: `db.doc(path)` → ref,
 * `db.runTransaction(fn)` handing the fn a `t` whose `get` resolves an ADMIN snapshot (`.exists` is
 * a PROPERTY there — serverDb wraps it into the client-style method).
 */
function fakeAdminDb(docs: Record<string, any>) {
  return {
    doc: (path: string) => path,
    runTransaction: async (fn: any) => fn({
      get: async (ref: string) => ({ exists: !!docs[ref], data: () => docs[ref], id: ref, ref }),
      set: (ref: string, value: any) => { docs[ref] = value; },
      update: (ref: string, value: any) => { docs[ref] = { ...docs[ref], ...value }; },
      delete: (ref: string) => { delete docs[ref]; },
    }),
  } as any;
}

describe('purchase + status over the injected db seam', () => {
  it('purchaseHostingPlan debits and grants atomically; readHostingPlanStatus reports it active', async () => {
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(2 * PRICE_TOKENS) };
    const db = fakeAdminDb(docs);
    const result = await purchaseHostingPlan(db, 'u1', undefined, STARTER.id, AGREED);
    if (!result.ok) throw new Error(`purchase failed via seam: ${result.error}`);
    expect(result.plan.id).toBe(STARTER.id);
    expect(result.tokenBalance).toBe(PRICE_TOKENS);
    expect(docs['user_token_wallets/u1'].hostingPlan.id).toBe(STARTER.id); // persisted, not just returned

    const status = await readHostingPlanStatus(db, 'u1');
    expect(status.active).toBe(true);
    expect(status.plan?.id).toBe(STARTER.id);
    expect(status.tier?.id).toBe(STARTER.id);
    expect(status.renewalPriceInr).toBe(STARTER.priceInr);

  });

  it('reading an EXPIRED auto-renew plan renews it lazily in the same transaction', async () => {
    const docs: Record<string, any> = {
      'user_token_wallets/u1': wallet(2 * PRICE_TOKENS, {
        hostingPlan: { id: STARTER.id, purchasedAt: NOW, expiresAt: new Date(Date.now() - DAY).toISOString(), autoRenew: true },
      }),
    };
    const status = await readHostingPlanStatus(fakeAdminDb(docs), 'u1');
    expect(status.active).toBe(true); // renewed on read — no cron anywhere
    expect(docs['user_token_wallets/u1'].tokenBalance).toBe(PRICE_TOKENS); // and really charged
  });

  it('probeHostingPlan: plans-off is a KNOWN inactive; no db is UNKNOWN (caller picks fail direction)', async () => {
    process.env.AGENTV3_HOSTING_PLANS = 'off';
    expect(await probeHostingPlan('u1')).toEqual({ active: false, known: true });
    delete process.env.AGENTV3_HOSTING_PLANS;
    _clearPlanCacheForTests();
    setServerDb(null); // VITEST default — store unavailable
    expect(await probeHostingPlan('u1')).toEqual({ active: false, known: false });
  });
});

// ---------- wiring invariants: every surface the plan touches ----------

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('plan wiring', () => {
  it('wallet routes exist, all ownership-checked (requireUserMatch)', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/routes/wallet.ts'), 'utf8');
    for (const route of ['hosting-plan\'', 'hosting-plan/purchase', 'hosting-plan/auto-renew']) {
      const at = src.indexOf(route);
      expect(at).toBeGreaterThan(-1);
      expect(src.slice(at, at + 80)).toContain("requireUserMatch('userId')");
    }
  });

  it('badge stamping honors the plan on BOTH publish paths, unknown keeps the badge', () => {
    const deploy = stripComments(readFileSync(join(__dirname, '..', 'src/server/AgentV3/DeploymentStore.ts'), 'utf8'));
    expect(deploy).toContain('probeHostingPlan(userId)');
    expect(deploy).toContain('paidRemoval: plan.known && plan.active');
    const pwa = stripComments(readFileSync(join(__dirname, '..', 'src/server/routes/pwa.ts'), 'utf8'));
    expect(pwa).toContain('probeHostingPlan(entry.userId)');
    expect(pwa).toContain('paidRemoval: plan.known && plan.active');
  });

  it('domain connect is plan-gated with free-list exemption and FAIL-OPEN on unknown', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/routes/nbaiDomains.ts'), 'utf8');
    const code = stripComments(src);
    expect(code).toContain('hostingPlansEnabled() && !isAgentV3FreeUser(');
    expect(code).toContain('plan.known && !plan.active'); // unknown ⇒ allow (rule #1)
    expect(code).toContain('needsPlan: true');
    // The gate covers ONLY connect — the status/state routes must stay ungated so a lapse never
    // breaks an already-live domain's checks.
    const statusRoute = code.indexOf("'/api/domains/nbai/status'");
    expect(code.slice(statusRoute, statusRoute + 1200)).not.toContain('needsPlan');
  });

  it('the Plans card is mounted in the wallet and the AIs can answer plan questions', () => {
    const billing = readFileSync(join(__dirname, '..', 'src/components/panels/BillingPanel.tsx'), 'utf8');
    expect(billing).toContain('<HostingPlanCard');
    const card = readFileSync(join(__dirname, '..', 'src/components/panels/HostingPlanCard.tsx'), 'utf8');
    expect(card).toContain('hosting-plan/purchase');
    expect(card).toContain('Database — Free');
    const kb = readFileSync(join(__dirname, '..', 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');
    expect(kb).toContain("id: 'hosting_plan'");
  });
});

/**
 * SIBLINGS OF THE 2026-08-08 TIME BOMB.
 *
 * `sweepOneWallet` hardcoded `new Date()` around a core that already took a time, so its fixture
 * silently changed meaning as the calendar moved and the suite failed days after the code was written.
 * `hostingPlanSweep` fixed that by making `now` a dependency. A grep for the same shape (rule 3 — hunt
 * the siblings) found these two wrappers with the identical defect, and `purchaseHostingPlan` was
 * already under test, so the next failure was only a matter of which date it landed on.
 */
describe('the clock is an input, not an ambient fact', () => {
  it('purchaseHostingPlan dates the plan from the INJECTED time', async () => {
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(2 * PRICE_TOKENS) };
    const r = await purchaseHostingPlan(fakeAdminDb(docs), 'u1', NOW, STARTER.id, AGREED);
    if (!r.ok) throw new Error(r.error);
    // Pinned to the fixture's clock, so this assertion means the same thing on any future day.
    expect(Date.parse(r.plan.expiresAt)).toBe(NOW_MS + HOSTING_PLAN_DAYS * DAY);
  });

  it('buying twice EXTENDS and charges twice — deliberately, and the injected clock proves it', async () => {
    // My first version of this test asserted the second purchase was free. It is not, and that is
    // correct: an active plan extends from its CURRENT expiry so paying early never loses days, which
    // means a second purchase buys a second period at a second price. The idempotency ref is keyed on
    // the PERIOD START, so what it protects against is replaying the SAME period — not paying again.
    // Pinned here because the period start comes from the clock: a wrapper reading the real clock could
    // key two same-instant calls differently and turn a genuine replay into a double charge.
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(3 * PRICE_TOKENS) };
    const db = fakeAdminDb(docs);
    const first = await purchaseHostingPlan(db, 'u1', NOW, STARTER.id, AGREED);
    const second = await purchaseHostingPlan(db, 'u1', NOW, STARTER.id, AGREED);
    if (!first.ok || !second.ok) throw new Error('purchase failed');
    expect(second.tokenBalance).toBe(first.tokenBalance - PRICE_TOKENS); // a second period, a second charge
    expect(Date.parse(second.plan.expiresAt)).toBe(NOW_MS + 2 * HOSTING_PLAN_DAYS * DAY); // 30 + 30
  });

  it('readHostingPlanStatus judges ACTIVE by the injected clock, not today\'s date', async () => {
    // This assertion is what caught the fix being HALF done: `nowIso` was threaded into the lazy
    // renewal but not into the active check, so a caller could pass a time, watch the renewal honour
    // it, and still get `active` computed from the real date.
    //
    // The wallet is drained to EXACTLY the plan price on purpose. Lazy auto-renew is real — at a far
    // future date a funded wallet simply renews and is correctly still active — so a balance that
    // cannot cover a renewal is the only way to observe the clock deciding expiry. (My first two
    // attempts at this test asserted the wrong thing for exactly that reason.)
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(PRICE_TOKENS) };
    const db = fakeAdminDb(docs);
    const bought = await purchaseHostingPlan(db, 'u1', NOW, STARTER.id, AGREED);
    if (!bought.ok) throw new Error(bought.error);
    expect((await readHostingPlanStatus(db, 'u1', NOW)).active).toBe(true);

    const farFuture = new Date(NOW_MS + 400 * DAY).toISOString();
    expect((await readHostingPlanStatus(db, 'u1', farFuture)).active).toBe(false);
  });

  it('omitting the time still uses the real clock — the production path is unchanged', async () => {
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(2 * PRICE_TOKENS) };
    const r = await purchaseHostingPlan(fakeAdminDb(docs), 'u1', undefined, STARTER.id, AGREED);
    if (!r.ok) throw new Error(r.error);
    const expiresIn = Date.parse(r.plan.expiresAt) - Date.now();
    expect(expiresIn).toBeGreaterThan((HOSTING_PLAN_DAYS - 1) * DAY);
    expect(expiresIn).toBeLessThanOrEqual(HOSTING_PLAN_DAYS * DAY);
  });
});
