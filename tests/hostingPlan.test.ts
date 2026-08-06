import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  HOSTING_PLAN_ID, HOSTING_PLAN_DAYS, hostingPlansEnabled, hostingPlanPriceInr, hostingPlanActive,
  computePlanPurchase, computeLazyRenewal, purchaseHostingPlan, readHostingPlanStatus,
  probeHostingPlan, _clearPlanCacheForTests,
} from '../src/server/lib/hostingPlan';
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
const PRICE_TOKENS = 99 * TOKENS_PER_RUPEE;

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
  it('plans are ON by default, off/false/0 disables; price defaults to ₹99 and is env-tunable', () => {
    expect(hostingPlansEnabled()).toBe(true);
    process.env.AGENTV3_HOSTING_PLANS = 'off';
    expect(hostingPlansEnabled()).toBe(false);
    expect(hostingPlanPriceInr()).toBe(99);
    process.env.HOSTING_PLAN_PRICE_INR = '149';
    expect(hostingPlanPriceInr()).toBe(149);
    process.env.HOSTING_PLAN_PRICE_INR = '-5';
    expect(hostingPlanPriceInr()).toBe(99); // junk never becomes a price
  });
});

describe('computePlanPurchase', () => {
  it('debits exactly ₹99 in tokens, grants 30 days, writes the ledger row', () => {
    const r = computePlanPurchase(wallet(PRICE_TOKENS + 500), NOW);
    if (!r.ok) throw new Error('expected ok');
    expect(r.charged).toBe(true);
    expect(r.wallet.tokenBalance).toBe(500);
    expect(r.plan.id).toBe(HOSTING_PLAN_ID);
    expect(Date.parse(r.plan.expiresAt)).toBe(NOW_MS + HOSTING_PLAN_DAYS * DAY);
    expect(r.plan.autoRenew).toBe(true);
    const row = r.wallet.walletLedger.at(-1);
    expect(row.description).toContain('Hosting plan — Custom Domain');
    expect(hostingPlanActive(r.wallet, NOW_MS)).toBe(true);
    expect(hostingPlanActive(r.wallet, NOW_MS + 31 * DAY)).toBe(false);
  });

  it('NO overdraft: a short balance is refused with the shortfall, nothing changes', () => {
    const w = wallet(PRICE_TOKENS - 1000);
    const r = computePlanPurchase(w, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('insufficient');
    expect(r.shortfallTokens).toBe(1000);
    expect(w.tokenBalance).toBe(PRICE_TOKENS - 1000); // untouched
  });

  it('buying while active EXTENDS from the current expiry — paying early never loses days', () => {
    const first = computePlanPurchase(wallet(3 * PRICE_TOKENS), NOW);
    if (!first.ok) throw new Error('expected ok');
    const second = computePlanPurchase(first.wallet, new Date(NOW_MS + 10 * DAY).toISOString());
    if (!second.ok) throw new Error('expected ok');
    expect(Date.parse(second.plan.expiresAt)).toBe(NOW_MS + 60 * DAY); // 30 + 30, not 10 + 30
    expect(second.wallet.tokenBalance).toBe(PRICE_TOKENS);
  });

  it('is idempotent per period: replaying the same purchase charges nothing more', () => {
    const first = computePlanPurchase(wallet(2 * PRICE_TOKENS), NOW);
    if (!first.ok) throw new Error('expected ok');
    // Same period start (same NOW, still-active plan extends from expiry — so replay the RAW result):
    const replay = computePlanPurchase({ ...first.wallet, hostingPlan: { ...first.plan, expiresAt: NOW } }, NOW);
    if (!replay.ok) throw new Error('expected ok');
    expect(replay.charged).toBe(false); // ledger ref already present — no second debit
    expect(replay.wallet.tokenBalance).toBe(first.wallet.tokenBalance);
  });

  it('plans disabled ⇒ refused as disabled', () => {
    process.env.AGENTV3_HOSTING_PLANS = 'off';
    const r = computePlanPurchase(wallet(2 * PRICE_TOKENS), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('disabled');
  });
});

describe('computeLazyRenewal', () => {
  const expiredPlan = { id: HOSTING_PLAN_ID, purchasedAt: NOW, expiresAt: new Date(NOW_MS - DAY).toISOString(), autoRenew: true };

  it('renews an expired auto-renew plan for 30 days FROM NOW (never back-dated)', () => {
    const r = computeLazyRenewal(wallet(2 * PRICE_TOKENS, { hostingPlan: expiredPlan }), NOW);
    expect(r.renewed).toBe(true);
    expect(r.applied).toBe(true);
    expect(Date.parse((r.wallet.hostingPlan as any).expiresAt)).toBe(NOW_MS + 30 * DAY);
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
    const result = await purchaseHostingPlan(db, 'u1');
    if (!result.ok) throw new Error(`purchase failed via seam: ${result.error}`);
    expect(result.plan.id).toBe(HOSTING_PLAN_ID);
    expect(result.tokenBalance).toBe(PRICE_TOKENS);
    expect(docs['user_token_wallets/u1'].hostingPlan.id).toBe(HOSTING_PLAN_ID); // persisted, not just returned

    const status = await readHostingPlanStatus(db, 'u1');
    expect(status.active).toBe(true);
    expect(status.plan?.id).toBe(HOSTING_PLAN_ID);
  });

  it('reading an EXPIRED auto-renew plan renews it lazily in the same transaction', async () => {
    const docs: Record<string, any> = {
      'user_token_wallets/u1': wallet(2 * PRICE_TOKENS, {
        hostingPlan: { id: HOSTING_PLAN_ID, purchasedAt: NOW, expiresAt: new Date(Date.now() - DAY).toISOString(), autoRenew: true },
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
