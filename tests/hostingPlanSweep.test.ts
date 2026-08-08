import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  HOSTING_PLAN_ID, HOSTING_PLAN_GRACE_DAYS, HOSTING_PLAN_REMINDER_DAYS, decidePlanSweepStep,
  _clearPlanCacheForTests,
} from '../src/server/lib/hostingPlan';
import {
  sweepOneWallet, reattachSuspendedDomains, reminderMessage, lapseMessage,
  _setSweepDepsForTests,
} from '../src/server/lib/hostingPlanSweep';
import { TOKENS_PER_RUPEE } from '../src/server/lib/payments';

/**
 * Plan lifecycle enforcement (admin 2026-08-06: "jab app down hategi hi nahi to user renewal kyu
 * karega? … 5 din pahle reminder"). Under test: renewal-first ordering, once-per-window reminders
 * with the exact ₹ shortfall, the grace window, lapse-once enforcement (domains detached, app never
 * deleted), and renewal undoing the lapse.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = '2026-08-06T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const PRICE_TOKENS = 99 * TOKENS_PER_RUPEE;

const plan = (expiresInDays: number, extra: Record<string, unknown> = {}) => ({
  id: HOSTING_PLAN_ID, purchasedAt: NOW, autoRenew: true,
  expiresAt: new Date(NOW_MS + expiresInDays * DAY).toISOString(), ...extra,
});
const wallet = (tokens: number, hostingPlan: Record<string, unknown> | undefined) => ({
  userId: 'u1', tokenBalance: tokens, totalTokensUsed: 0, remaining_balance: tokens / TOKENS_PER_RUPEE,
  walletLedger: [], ...(hostingPlan ? { hostingPlan } : {}),
});

afterEach(() => {
  _setSweepDepsForTests(null);
  _clearPlanCacheForTests();
  delete process.env.AGENTV3_HOSTING_PLANS;
});

describe('decidePlanSweepStep', () => {
  it('far from expiry ⇒ nothing due', () => {
    const r = decidePlanSweepStep(wallet(PRICE_TOKENS, plan(20)), NOW);
    expect(r.action).toBeNull();
    expect(r.applied).toBe(false);
  });

  it('inside 5 days ⇒ ONE reminder, marked so the next sweep stays silent; 1-day window fires separately', () => {
    const w = wallet(2 * PRICE_TOKENS, plan(4));
    const first = decidePlanSweepStep(w, NOW);
    expect(first.action).toEqual({ kind: 'remind', days: 5, shortfallInr: 0 }); // balance covers it
    const second = decidePlanSweepStep(first.wallet, NOW);
    expect(second.action).toBeNull(); // deduped

    // Time moves inside the 1-day window: the second, more urgent reminder fires once.
    const later = new Date(NOW_MS + 3.5 * DAY).toISOString();
    const third = decidePlanSweepStep(first.wallet, later);
    expect(third.action).toEqual({ kind: 'remind', days: 1, shortfallInr: 0 });
    expect(decidePlanSweepStep(third.wallet, later).action).toBeNull();
  });

  it('a short balance is named in exact ₹ (the user knows precisely what to recharge)', () => {
    const w = wallet(49 * TOKENS_PER_RUPEE, plan(2)); // ₹49 held, ₹99 needed
    const r = decidePlanSweepStep(w, NOW);
    expect(r.action).toEqual({ kind: 'remind', days: 5, shortfallInr: 50 });
  });

  it('expired + affordable + autoRenew ⇒ RENEWS (renewal always wins over reminding/lapsing)', () => {
    const r = decidePlanSweepStep(wallet(2 * PRICE_TOKENS, plan(-1)), NOW);
    expect(r.action).toEqual({ kind: 'renewed' });
    expect((r.wallet.hostingPlan as any).expiresAt).toBe(new Date(NOW_MS + 30 * DAY).toISOString());
  });

  it('expired + unaffordable: inside grace ⇒ WAIT (a late recharge saves the domain silently)', () => {
    const r = decidePlanSweepStep(wallet(100, plan(-(HOSTING_PLAN_GRACE_DAYS - 1))), NOW);
    expect(r.action).toBeNull();
  });

  it('past grace ⇒ LAPSE exactly once', () => {
    const w = wallet(100, plan(-(HOSTING_PLAN_GRACE_DAYS + 1)));
    const first = decidePlanSweepStep(w, NOW);
    expect(first.action).toEqual({ kind: 'lapse' });
    expect((first.wallet.hostingPlan as any).lapsedAt).toBe(NOW);
    expect(decidePlanSweepStep(first.wallet, NOW).action).toBeNull(); // enforced once, never again
  });

  it('plans disabled or no plan ⇒ inert', () => {
    expect(decidePlanSweepStep(wallet(100, undefined), NOW).action).toBeNull();
    process.env.AGENTV3_HOSTING_PLANS = 'off';
    expect(decidePlanSweepStep(wallet(100, plan(-30)), NOW).action).toBeNull();
  });
});

describe('messages (White-Label: NavBharatAI terms only)', () => {
  it('reminder names the shortfall when short, reassures when covered; lapse says the app survived', () => {
    expect(reminderMessage(5, NOW, 50)).toContain('₹50 short');
    expect(reminderMessage(5, NOW, 0)).toContain('automatically');
    const lapse = lapseMessage(['mitrify.in']);
    expect(lapse).toContain('mitrify.in');
    expect(lapse).toContain('still live on its free NavBharatAI link');
    expect(lapse).toContain('reconnects automatically');
    for (const msg of [reminderMessage(5, NOW, 50), lapseMessage(['x.in'])]) {
      expect(msg.toLowerCase()).not.toMatch(/firebase|cloudflare|google/);
    }
  });
});

// ---------- sweep + reattach over injected seams ----------

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

describe('sweepOneWallet', () => {
  it('a lapse detaches every active domain, marks it suspended, and tells the user honestly', async () => {
    const docs: Record<string, any> = {
      'user_token_wallets/u1': wallet(100, plan(-(HOSTING_PLAN_GRACE_DAYS + 1))),
    };
    const events: string[] = [];
    _setSweepDepsForTests({
      linksForUser: async () => [
        { domain: 'mitrify.in', workspaceId: 'agentv3-u1-a', userId: 'u1' },
        { domain: 'old.in', workspaceId: 'agentv3-u1-b', userId: 'u1', suspended: 'plan_lapsed' }, // already done
      ],
      detachDomain: async (ws, d) => { events.push(`detach ${d}`); },
      setSuspended: async (d, r) => { events.push(`suspend ${d}=${r}`); },
      notify: async (uid, msg) => { events.push(`notify ${uid}: ${msg.slice(0, 40)}`); },
    });
    const action = await sweepOneWallet(fakeAdminDb(docs), 'u1', NOW);
    expect(action).toEqual({ kind: 'lapse' });
    expect(events).toContain('detach mitrify.in');
    expect(events).toContain('suspend mitrify.in=plan_lapsed');
    expect(events.some((e) => e.startsWith('notify u1'))).toBe(true);
    expect(events.some((e) => e.includes('old.in'))).toBe(false); // idempotent: never re-detached
    expect(docs['user_token_wallets/u1'].hostingPlan.lapsedAt).toBeTruthy(); // persisted
  });

  it('a due reminder notifies once and persists the marker', async () => {
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(2 * PRICE_TOKENS, plan(2)) };
    const notes: string[] = [];
    _setSweepDepsForTests({ notify: async (_u, m) => { notes.push(m); } });
    const db = fakeAdminDb(docs);
    // The clock is PINNED to the fixture's NOW — with the real clock this test was a time bomb: it
    // passed until real time crossed into the fixture plan's 1-day reminder window, then failed
    // deterministically (the second sweep legitimately fired the more-urgent 1-day reminder).
    expect(await sweepOneWallet(db, 'u1', NOW)).toEqual({ kind: 'remind', days: 5, shortfallInr: 0 });
    expect(await sweepOneWallet(db, 'u1', NOW)).toBeNull(); // marker persisted — no double-send
    expect(notes).toHaveLength(1);
  });
});

describe('reattachSuspendedDomains (renewal undoes the lapse)', () => {
  it('re-attaches ONLY plan_lapsed links, clears suspension, notifies', async () => {
    const events: string[] = [];
    _setSweepDepsForTests({
      linksForUser: async () => [
        { domain: 'mitrify.in', workspaceId: 'agentv3-u1-a', userId: 'u1', suspended: 'plan_lapsed' },
        { domain: 'live.in', workspaceId: 'agentv3-u1-b', userId: 'u1' }, // never suspended — untouched
      ],
      attachDomain: async (_ws, d) => { events.push(`attach ${d}`); },
      setSuspended: async (d, r) => { events.push(`suspend ${d}=${r}`); },
      notify: async (_u, m) => { events.push(`notify: ${m.slice(0, 30)}`); },
    });
    expect(await reattachSuspendedDomains('u1')).toBe(1);
    expect(events).toContain('attach mitrify.in');
    expect(events).toContain('suspend mitrify.in=null');
    expect(events.some((e) => e.includes('live.in'))).toBe(false);
  });
});

// ---------- wiring invariants ----------

describe('lifecycle wiring', () => {
  it('the sweep is registered at boot and the purchase route re-attaches suspended domains', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/routes/wallet.ts'), 'utf8');
    expect(src).toContain('registerHostingPlanSweep()');
    expect(src).toContain('reattachSuspendedDomains(req.params.userId)');
  });

  it('the sweep query uses ONE single-field inequality (no composite index to silently fail on)', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/lib/hostingPlanSweep.ts'), 'utf8');
    const matches = src.match(/\.where\(/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(src).toContain("where('hostingPlan.expiresAt', '<='");
  });

  it('the plan card and the in-app AIs tell the SAME lapse story (domain pauses, app survives)', () => {
    const card = readFileSync(join(__dirname, '..', 'src/components/panels/HostingPlanCard.tsx'), 'utf8');
    expect(card).toContain('your domain pauses');
    expect(card).toContain('stays live on its free NavBharatAI link');
    const kb = readFileSync(join(__dirname, '..', 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');
    expect(kb).toContain('3-day grace');
    expect(kb).toContain('reconnects automatically');
  });

  it('reminder windows are what the admin asked for: 5 days (and 1 day), grace 3 days', () => {
    expect(HOSTING_PLAN_REMINDER_DAYS).toEqual([5, 1]);
    expect(HOSTING_PLAN_GRACE_DAYS).toBe(3);
  });
});
