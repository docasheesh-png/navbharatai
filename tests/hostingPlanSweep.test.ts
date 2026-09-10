import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  HOSTING_PLAN_ID, HOSTING_PLAN_GRACE_DAYS, HOSTING_PLAN_REMINDER_DAYS, decidePlanSweepStep,
  _clearPlanCacheForTests,
} from '../src/server/lib/hostingPlan';
import {
  sweepOneWallet, reattachSuspendedDomains, reminderMessage, lapseMessage, graceMessage,
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

/**
 * FROZEN CLOCK (2026-08-08): every fixture below states its expiry relative to NOW, but the sweep
 * used to read the REAL clock — so "expires in 2 days" quietly became "expires in 8 hours" as the
 * calendar advanced, and the suite failed days after the code was written. `now` is a dependency
 * now, and each time-sensitive test pins it, so these tests mean the same thing forever.
 */
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
    // 2 days left, so the 3-day window is the smallest REACHED one — the only one that describes
    // reality. (Before the admin added the 3-day window this correctly said 5.)
    expect(r.action).toEqual({ kind: 'remind', days: 3, shortfallInr: 50 });
  });

  it('expired + affordable + autoRenew ⇒ RENEWS (renewal always wins over reminding/lapsing)', () => {
    const r = decidePlanSweepStep(wallet(2 * PRICE_TOKENS, plan(-1)), NOW);
    expect(r.action).toEqual({ kind: 'renewed' });
    expect((r.wallet.hostingPlan as any).expiresAt).toBe(new Date(NOW_MS + 30 * DAY).toISOString());
  });

  it('expired + unaffordable: inside grace ⇒ ONE last warning, and the domain is NOT touched', () => {
    // Changed 2026-09-10 (admin: "aise user ko reminder notification show hona chahiye"). This used
    // to assert SILENCE through the whole grace window — the pre-expiry reminders had stopped and
    // the lapse had not fired, so the single most useful moment to reach someone produced nothing.
    // What has NOT changed, and is the real point of the test: no lapse, so no domain is detached.
    const w = wallet(100, plan(-(HOSTING_PLAN_GRACE_DAYS - 1)));
    const first = decidePlanSweepStep(w, NOW);
    // ₹1 held against the ₹99 renewal ⇒ ₹98 short, named exactly.
    expect(first.action).toEqual({ kind: 'grace', graceDaysLeft: 1, shortfallInr: 98 });
    expect((first.wallet.hostingPlan as any).lapsedAt).toBeUndefined();
    // ONCE per period — a daily sweep must not nag every day.
    expect(decidePlanSweepStep(first.wallet, NOW).action).toBeNull();
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
    // NOTHING PAUSED — the old, domain-only lapse. The app survived and the message says so.
    const lapse = lapseMessage(['mitrify.in']);
    expect(lapse).toContain('mitrify.in');
    expect(lapse).toContain('still live on their free NavBharatAI links');
    expect(lapse).toContain('reconnects on its own');

    // APPS PAUSED (2026-09-10 demotion) — the message must carry the second piece of bad news AND
    // its limits, because bad news that omits the limits of the damage reads as worse than it is.
    const demoted = lapseMessage(['mitrify.in'], 'growth', 3);
    expect(demoted).toContain('3 apps');
    expect(demoted).toContain('nothing was deleted');
    expect(demoted).toContain('your files are all still here');
    expect(demoted).toContain('open it and press Publish');
    expect(demoted).toContain('Growth');
    // Singular reads correctly too — "1 apps have been paused" is the kind of detail users notice.
    expect(lapseMessage([], 'starter', 1)).toContain('1 app has been paused');

    for (const msg of [reminderMessage(5, NOW, 50), lapseMessage(['x.in']), lapseMessage(['x.in'], 'growth', 2)]) {
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

describe('renewal never points a domain at a dead app (audit 2026-09-10)', () => {
  it('🔒 a domain whose app is PAUSED is not reconnected — and the user is told the one step that fixes it', async () => {
    // The lapse now pauses apps as well as suspending domains, so reattaching unconditionally would
    // point a domain at a deleted channel — right after the notice promised "your domain reconnects
    // on its own". A false promise is worse than the outage it replaced.
    const attached: string[] = [];
    const notes: string[] = [];
    _setSweepDepsForTests({
      linksForUser: async () => [
        { domain: 'live.in', workspaceId: 'w-live', userId: 'u1', suspended: 'plan_lapsed' },
        { domain: 'paused.in', workspaceId: 'w-paused', userId: 'u1', suspended: 'plan_lapsed' },
      ] as any,
      appsForUser: async () => [
        { workspaceId: 'w-live', status: 'active', updatedAt: 1 },
        { workspaceId: 'w-paused', status: 'plan_paused', updatedAt: 2 },
      ],
      attachDomain: async (_ws, d) => { attached.push(d); },
      setSuspended: async () => {},
      notify: async (_u, m) => { notes.push(m); },
    });
    expect(await reattachSuspendedDomains('u1')).toBe(1);
    expect(attached).toEqual(['live.in']);
    const all = notes.join(' | ');
    expect(all).toContain('live.in');
    expect(all).toContain('paused.in');
    expect(all).toContain('press Publish');   // the actionable step, not a silent skip
    expect(all).toContain('Nothing was lost');
  });

  it('🔒 only a KNOWN-down app is skipped — an absent or unreadable record still reattaches', async () => {
    // The first version of this guard collected the LIVE workspaces and skipped anything missing
    // from that set. That is a different, much worse rule: a user whose apps predate the deployment
    // registry — or a read that returns an empty page rather than throwing — would have had EVERY
    // domain refused, right after paying. "Cannot tell" must reattach; only a record that exists and
    // is not active may be skipped. Caught by an existing test that stubbed no registry at all.
    for (const appsForUser of [
      async () => { throw new Error('registry down'); },          // read failed
      async () => [],                                             // legacy user, no records at all
      async () => [{ workspaceId: 'other', status: 'plan_paused', updatedAt: 1 }], // a DIFFERENT app is down
    ]) {
      const attached: string[] = [];
      _setSweepDepsForTests({
        linksForUser: async () => [{ domain: 'x.in', workspaceId: 'w', userId: 'u1', suspended: 'plan_lapsed' }] as any,
        appsForUser: appsForUser as any,
        attachDomain: async (_ws, d) => { attached.push(d); },
        setSuspended: async () => {},
        notify: async () => {},
      });
      expect(await reattachSuspendedDomains('u1')).toBe(1);
      expect(attached).toEqual(['x.in']);
    }
  });

  it('nothing suspended ⇒ no lookup, no messages', async () => {
    let looked = false;
    _setSweepDepsForTests({
      linksForUser: async () => [],
      appsForUser: async () => { looked = true; return []; },
      notify: async () => { throw new Error('must not notify'); },
    });
    expect(await reattachSuspendedDomains('u1')).toBe(0);
    expect(looked).toBe(false);
  });
});

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
    const action = await sweepOneWallet(fakeAdminDb(docs), 'u1');
    expect(action).toEqual({ kind: 'lapse' });
    expect(events).toContain('detach mitrify.in');
    expect(events).toContain('suspend mitrify.in=plan_lapsed');
    expect(events.some((e) => e.startsWith('notify u1'))).toBe(true);
    expect(events.some((e) => e.includes('old.in'))).toBe(false); // idempotent: never re-detached
    expect(docs['user_token_wallets/u1'].hostingPlan.lapsedAt).toBeTruthy(); // persisted
  });

  it('🔒 a lapse DEMOTES to the free allowance: apps above it really go offline, the rest stay', async () => {
    // Admin 2026-09-10: "month complete ho gaya, tab to app offline honi chahiye." The demotion is the
    // FAIR version of that — back to exactly what a free account gets, never below it, so paying once
    // can never leave someone worse off than never paying.
    const docs: Record<string, any> = {
      'user_token_wallets/u1': wallet(100, plan(-(HOSTING_PLAN_GRACE_DAYS + 1))),
    };
    const paused: string[] = [];
    let notice = '';
    // Seven live apps, one of them holding the custom domain. The free cap is 5, so two must go.
    const apps = [
      { workspaceId: 'w-domain', status: 'active', updatedAt: 1 },       // oldest, but has the domain
      { workspaceId: 'w-6', status: 'active', updatedAt: 60 },
      { workspaceId: 'w-5', status: 'active', updatedAt: 50 },
      { workspaceId: 'w-4', status: 'active', updatedAt: 40 },
      { workspaceId: 'w-3', status: 'active', updatedAt: 30 },
      { workspaceId: 'w-2', status: 'active', updatedAt: 20 },
      { workspaceId: 'w-1', status: 'active', updatedAt: 10 },
      { workspaceId: 'w-gone', status: 'unpublished', updatedAt: 99 },   // not live — holds no slot
    ];
    _setSweepDepsForTests({
      linksForUser: async () => [{ domain: 'mitrify.in', workspaceId: 'w-domain', userId: 'u1' }],
      detachDomain: async () => {},
      setSuspended: async () => {},
      appsForUser: async () => apps,
      pauseApp: async (ws) => { paused.push(ws); },
      notify: async (_u, msg) => { notice = msg; },
    });
    expect(await sweepOneWallet(fakeAdminDb(docs), 'u1')).toEqual({ kind: 'lapse' });

    // Exactly the two least-defensible apps, and NEVER the one with a real domain pointed at it.
    expect(paused.sort()).toEqual(['w-1', 'w-2']);
    expect(paused).not.toContain('w-domain');
    // An already-unpublished app was never live, so pausing it would be an action that does nothing.
    expect(paused).not.toContain('w-gone');
    // The user is told the count and the limits of the damage.
    expect(notice).toContain('2 apps');
    expect(notice).toContain('nothing was deleted');
  });

  it('one app that refuses to come down does not stop the rest, and is never marked paused', async () => {
    // The registry must never claim "paused" over a site that is still serving — the fake status the
    // unpublish route warns about. A throw leaves it live AND active, so the next sweep retries it.
    const docs: Record<string, any> = {
      'user_token_wallets/u1': wallet(100, plan(-(HOSTING_PLAN_GRACE_DAYS + 1))),
    };
    const paused: string[] = [];
    let notice = '';
    _setSweepDepsForTests({
      linksForUser: async () => [],
      appsForUser: async () => Array.from({ length: 8 }, (_, i) => ({
        workspaceId: `w-${i}`, status: 'active', updatedAt: 100 - i,
      })),
      pauseApp: async (ws) => {
        if (ws === 'w-6') throw new Error('hosting said no');
        paused.push(ws);
      },
      notify: async (_u, msg) => { notice = msg; },
    });
    expect(await sweepOneWallet(fakeAdminDb(docs), 'u1')).toEqual({ kind: 'lapse' });
    expect(paused).toEqual(['w-5', 'w-7']);          // w-6 threw; the others still went down
    expect(notice).toContain('2 apps');              // the count is what REALLY happened, not what was tried
  });

  it('a lapse for a user at or under the free allowance pauses nothing at all', async () => {
    const docs: Record<string, any> = {
      'user_token_wallets/u1': wallet(100, plan(-(HOSTING_PLAN_GRACE_DAYS + 1))),
    };
    const paused: string[] = [];
    let notice = '';
    _setSweepDepsForTests({
      linksForUser: async () => [],
      appsForUser: async () => [{ workspaceId: 'only-one', status: 'active', updatedAt: 1 }],
      pauseApp: async (ws) => { paused.push(ws); },
      notify: async (_u, msg) => { notice = msg; },
    });
    await sweepOneWallet(fakeAdminDb(docs), 'u1');
    expect(paused).toEqual([]);
    expect(notice).toContain('still live on their free NavBharatAI links');
  });

  it('the domain half of a lapse survives even if listing the apps blows up', async () => {
    const docs: Record<string, any> = {
      'user_token_wallets/u1': wallet(100, plan(-(HOSTING_PLAN_GRACE_DAYS + 1))),
    };
    const events: string[] = [];
    _setSweepDepsForTests({
      linksForUser: async () => [{ domain: 'x.in', workspaceId: 'w', userId: 'u1' }],
      detachDomain: async (_ws, d) => { events.push(`detach ${d}`); },
      setSuspended: async () => {},
      appsForUser: async () => { throw new Error('store down'); },
      notify: async () => {},
    });
    expect(await sweepOneWallet(fakeAdminDb(docs), 'u1')).toEqual({ kind: 'lapse' });
    expect(events).toContain('detach x.in'); // the half that already succeeded is never undone
  });

  it('a due reminder notifies once and persists the marker', async () => {
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(2 * PRICE_TOKENS, plan(2)) };
    const notes: string[] = [];
    _setSweepDepsForTests({ notify: async (_u, m) => { notes.push(m); }, now: () => new Date(NOW_MS) });
    const db = fakeAdminDb(docs);
    expect(await sweepOneWallet(db, 'u1')).toEqual({ kind: 'remind', days: 3, shortfallInr: 0 });
    expect(await sweepOneWallet(db, 'u1')).toBeNull(); // marker persisted — no double-send
    expect(notes).toHaveLength(1);
  });

  it('a plan already inside its FINAL day sends the 1-day reminder — never a false "5 days ahead"', async () => {
    // THE 2026-08-08 bug: the largest reached window fired first, so a plan with 8 hours left was
    // announced as "5 days ahead" and the truthful 1-day note followed minutes later. A dormant
    // account swept late is the common case, not an edge one.
    const eightHours = 8 / 24;
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(2 * PRICE_TOKENS, plan(eightHours)) };
    const notes: string[] = [];
    _setSweepDepsForTests({ notify: async (_u, m) => { notes.push(m); }, now: () => new Date(NOW_MS) });
    const db = fakeAdminDb(docs);
    expect(await sweepOneWallet(db, 'u1')).toEqual({ kind: 'remind', days: 1, shortfallInr: 0 });
    expect(notes[0]).toContain('1 day');
    expect(notes[0]).not.toContain('5 days');
    // The moot 5-day window is burned in the same write, so it can never fire late with wrong text.
    expect(await sweepOneWallet(db, 'u1')).toBeNull();
    expect(notes).toHaveLength(1);
  });

  it('the normal cadence is untouched: 5-day note first, then the 1-day note as expiry nears', async () => {
    const docs: Record<string, any> = { 'user_token_wallets/u1': wallet(2 * PRICE_TOKENS, plan(4)) };
    const notes: string[] = [];
    let clock = NOW_MS;
    _setSweepDepsForTests({ notify: async (_u, m) => { notes.push(m); }, now: () => new Date(clock) });
    const db = fakeAdminDb(docs);
    expect(await sweepOneWallet(db, 'u1')).toEqual({ kind: 'remind', days: 5, shortfallInr: 0 });
    clock = NOW_MS + 3.5 * DAY;                      // now inside the final day
    expect(await sweepOneWallet(db, 'u1')).toEqual({ kind: 'remind', days: 1, shortfallInr: 0 });
    expect(notes).toHaveLength(2);
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

  it('reminder windows are what the admin asked for: 5, 3 and 1 days, grace 3 days', () => {
    // Widened from [5, 1] on 2026-09-10 — one warning five days out and then silence until the last
    // day is easy to miss entirely, and the middle one is the useful one.
    expect(HOSTING_PLAN_REMINDER_DAYS).toEqual([5, 3, 1]);
    expect(HOSTING_PLAN_GRACE_DAYS).toBe(3);
  });

  it('the grace message says the plan ENDED, how long is left, and that the app stays live', () => {
    const msg = graceMessage(2, 0, 'starter');
    expect(msg).toContain('has ended');
    expect(msg).toContain('2 days left');
    expect(msg).toContain('before your domain pauses');
    // The honest half: losing the plan never takes the app down, and the message says so rather
    // than letting the user imagine the worst.
    expect(msg).toContain('stays live on its free NavBharatAI link');
    // Short balance names the exact figure — "recharge" is not actionable without an amount.
    expect(graceMessage(1, 75, 'starter')).toContain('₹75');
  });
});
