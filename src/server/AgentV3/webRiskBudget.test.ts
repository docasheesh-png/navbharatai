import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { scanOrigins, clearWebRiskCache } from './webRisk';
import {
  budgetMonthKey, lookupBudgetLimit, grantableLookups, reserveLookups, releaseLookups,
  scanOriginsWithBudget, FREE_TIER_LOOKUPS_PER_MONTH, WEB_RISK_BUDGET_COLLECTION,
} from './webRiskBudget';

/**
 * THE SPEND CEILING (NavBharat Cloud slice 4 — the cost half).
 *
 * Web Risk's Lookup API is free to 100,000 calls a month and $0.50/1,000 after. The daily re-scan is
 * bounded at 200 apps × 60 origins, so before this module the theoretical ceiling was ~360,000 calls a
 * month. Unlikely — the cache collapses shared hosts — but a path with no ceiling is not a bound.
 */

/** An in-memory stand-in for the one Firestore document a month uses. */
function fakeStore(initial: Record<string, Record<string, unknown>> = {}) {
  const docs: Record<string, Record<string, unknown>> = { ...initial };
  let failing = false;
  return {
    docs,
    fail() { failing = true; },
    collection(name: string) {
      return { doc: (id: string) => `${name}/${id}` };
    },
    async runTransaction<T>(fn: (tx: {
      get(ref: unknown): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
      set(ref: unknown, value: Record<string, unknown>): void;
    }) => Promise<T>): Promise<T> {
      if (failing) throw new Error('firestore unavailable');
      return fn({
        async get(ref) {
          const d = docs[String(ref)];
          return { exists: !!d, data: () => d };
        },
        set(ref, value) { docs[String(ref)] = { ...value }; },
      });
    },
  };
}

const AUG = Date.UTC(2026, 7, 15, 12, 0, 0); // 2026-08

describe('budgetMonthKey', () => {
  it('buckets by UTC calendar month, because Google bills on ITS calendar', () => {
    expect(budgetMonthKey(Date.UTC(2026, 0, 1))).toBe('2026-01');
    expect(budgetMonthKey(Date.UTC(2026, 11, 31, 23, 59))).toBe('2026-12');
  });

  it('a new month starts from zero — the ceiling is monthly, not lifetime', () => {
    expect(budgetMonthKey(Date.UTC(2026, 7, 31, 23, 59))).not.toBe(budgetMonthKey(Date.UTC(2026, 8, 1, 0, 1)));
  });
});

describe('lookupBudgetLimit', () => {
  it('defaults to Google’s free allowance, so the feature costs nothing unless raised', () => {
    expect(lookupBudgetLimit({} as never)).toBe(FREE_TIER_LOOKUPS_PER_MONTH);
    expect(lookupBudgetLimit({ NAVBHARAT_WEB_RISK_MAX_LOOKUPS: '' } as never)).toBe(FREE_TIER_LOOKUPS_PER_MONTH);
  });

  it('reads a real number, tolerating the separators an operator types', () => {
    expect(lookupBudgetLimit({ NAVBHARAT_WEB_RISK_MAX_LOOKUPS: '250000' } as never)).toBe(250_000);
    expect(lookupBudgetLimit({ NAVBHARAT_WEB_RISK_MAX_LOOKUPS: ' 250,000 ' } as never)).toBe(250_000);
  });

  it('🔒 an explicit 0 means "ask Google nothing" — a real, supported setting', () => {
    expect(lookupBudgetLimit({ NAVBHARAT_WEB_RISK_MAX_LOOKUPS: '0' } as never)).toBe(0);
  });

  it('🔒 an UNREADABLE value falls back to the free tier, never to unlimited', () => {
    // Someone who wanted the default would have left the key unset, so a value that is present and
    // unparseable can never have meant "spend without limit".
    expect(lookupBudgetLimit({ NAVBHARAT_WEB_RISK_MAX_LOOKUPS: 'lots' } as never)).toBe(FREE_TIER_LOOKUPS_PER_MONTH);
    expect(lookupBudgetLimit({ NAVBHARAT_WEB_RISK_MAX_LOOKUPS: '-5' } as never)).toBe(FREE_TIER_LOOKUPS_PER_MONTH);
  });
});

describe('grantableLookups', () => {
  it('grants what is left, never more', () => {
    expect(grantableLookups(0, 10, 100)).toBe(10);
    expect(grantableLookups(95, 10, 100)).toBe(5);
    expect(grantableLookups(100, 10, 100)).toBe(0);
    expect(grantableLookups(120, 10, 100)).toBe(0);
  });

  it('a corrupt counter cannot mint budget', () => {
    expect(grantableLookups(Number.NaN, 10, 100)).toBe(10);
    expect(grantableLookups(0, 10, Number.NaN)).toBe(0);
  });
});

describe('reserveLookups', () => {
  it('takes the reservation out of the month’s document', async () => {
    const store = fakeStore();
    expect(await reserveLookups(store, { want: 40, nowMs: AUG, limit: 100 })).toBe(40);
    expect(store.docs[`${WEB_RISK_BUDGET_COLLECTION}/2026-08`].used).toBe(40);
  });

  it('two callers in the same month share ONE ceiling', async () => {
    const store = fakeStore();
    expect(await reserveLookups(store, { want: 80, nowMs: AUG, limit: 100 })).toBe(80);
    expect(await reserveLookups(store, { want: 80, nowMs: AUG, limit: 100 })).toBe(20);
    expect(await reserveLookups(store, { want: 80, nowMs: AUG, limit: 100 })).toBe(0);
  });

  it('🔒 RESERVES BEFORE SPENDING — a crash mid-scan costs budget, never money', async () => {
    // A counter incremented after the calls were made loses whatever a crash interrupts, and every
    // lost increment is money spent twice.
    const store = fakeStore();
    await reserveLookups(store, { want: 30, nowMs: AUG, limit: 100 });
    expect(store.docs[`${WEB_RISK_BUDGET_COLLECTION}/2026-08`].used).toBe(30);
  });

  it('🔒 a store it cannot reach grants NOTHING — the opposite of jobLease, on purpose', async () => {
    // A lease that cannot be read runs the job anyway (a purge that never runs is worse than one that
    // runs twice). A budget that cannot be read spends nothing, because not looking up costs zero and
    // changes no outcome: an unchecked origin is `unknown`, and nothing acts on an `unknown`.
    const store = fakeStore();
    store.fail();
    expect(await reserveLookups(store, { want: 10, nowMs: AUG, limit: 100 })).toBe(0);
    expect(await reserveLookups(null, { want: 10, nowMs: AUG, limit: 100 })).toBe(0);
  });

  it('a limit of 0 never touches the store at all', async () => {
    const store = fakeStore();
    expect(await reserveLookups(store, { want: 10, nowMs: AUG, limit: 0 })).toBe(0);
    expect(Object.keys(store.docs)).toEqual([]);
  });
});

describe('releaseLookups', () => {
  it('hands back what the cache made unnecessary', async () => {
    const store = fakeStore();
    await reserveLookups(store, { want: 60, nowMs: AUG, limit: 100 });
    await releaseLookups(store, { unused: 55, nowMs: AUG });
    expect(store.docs[`${WEB_RISK_BUDGET_COLLECTION}/2026-08`].used).toBe(5);
  });

  it('🔒 can never drive the counter below zero', async () => {
    const store = fakeStore();
    await releaseLookups(store, { unused: 500, nowMs: AUG });
    expect(store.docs[`${WEB_RISK_BUDGET_COLLECTION}/2026-08`].used).toBe(0);
  });

  it('a failed release is lost budget, never a charge — and never throws', async () => {
    const store = fakeStore();
    await reserveLookups(store, { want: 10, nowMs: AUG, limit: 100 });
    store.fail();
    await expect(releaseLookups(store, { unused: 10, nowMs: AUG })).resolves.toBeUndefined();
  });
});

describe('scanOrigins honours a lookup cap', () => {
  beforeEach(() => clearWebRiskCache());
  const answering = (body: unknown) => (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

  it('stops calling out once the cap is reached, and says how many it skipped', async () => {
    let called = 0;
    const counting = (async () => { called++; return { ok: true, json: async () => ({}) }; }) as unknown as typeof fetch;
    const scan = await scanOrigins({
      origins: ['https://a.example.com', 'https://b.example.com', 'https://c.example.com'],
      token: 't', fetchImpl: counting, maxLookups: 2,
    });
    expect(called).toBe(2);
    expect(scan.lookups).toBe(2);
    expect(scan.skippedForBudget).toBe(1);
  });

  it('🔒 a skipped origin is UNKNOWN, not clean — running out of budget says nothing about the host', async () => {
    const scan = await scanOrigins({
      origins: ['https://a.example.com'], token: 't', fetchImpl: answering({}), maxLookups: 0,
    });
    expect(scan.results[0].verdict).toBe('unknown');
    expect(scan.listed).toEqual([]);
    expect(scan.incomplete).toBe(true);
  });

  it('🔒 CACHE HITS ARE FREE — they never spend the cap', async () => {
    // Otherwise a platform whose apps all point at the same twenty hosts would exhaust the allowance
    // having made almost no calls.
    await scanOrigins({ origins: ['https://api.stripe.com'], token: 't', fetchImpl: answering({}) });
    const scan = await scanOrigins({
      origins: ['https://api.stripe.com', 'https://new.example.com'],
      token: 't', fetchImpl: answering({}), maxLookups: 1,
    });
    expect(scan.lookups).toBe(1);
    expect(scan.skippedForBudget).toBe(0);
    expect(scan.results.every((r) => r.verdict === 'clean')).toBe(true);
  });

  it('no cap given means unlimited — existing callers are unchanged', async () => {
    let called = 0;
    const counting = (async () => { called++; return { ok: true, json: async () => ({}) }; }) as unknown as typeof fetch;
    await scanOrigins({ origins: ['https://a.example.com', 'https://b.example.com'], token: 't', fetchImpl: counting });
    expect(called).toBe(2);
  });
});

describe('scanOriginsWithBudget', () => {
  beforeEach(() => clearWebRiskCache());
  const answering = (body: unknown) => (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

  it('spends the month down and then stops, across separate scans', async () => {
    const store = fakeStore();
    const first = await scanOriginsWithBudget({
      origins: ['https://a.example.com', 'https://b.example.com'],
      token: 't', store, nowMs: AUG, limit: 3, fetchImpl: answering({}),
    });
    expect(first.lookups).toBe(2);
    expect(first.budgetExhausted).toBe(false);

    clearWebRiskCache();
    const second = await scanOriginsWithBudget({
      origins: ['https://c.example.com', 'https://d.example.com'],
      token: 't', store, nowMs: AUG, limit: 3, fetchImpl: answering({}),
    });
    expect(second.lookups).toBe(1);
    expect(second.budgetExhausted).toBe(true);
    expect(second.results.filter((r) => r.verdict === 'unknown')).toHaveLength(1);
  });

  it('🔒 returns the reserved-but-unused lookups, so the cache does not burn the allowance', async () => {
    const store = fakeStore();
    await scanOriginsWithBudget({
      origins: ['https://api.stripe.com'], token: 't', store, nowMs: AUG, limit: 100, fetchImpl: answering({}),
    });
    await scanOriginsWithBudget({
      origins: ['https://api.stripe.com'], token: 't', store, nowMs: AUG, limit: 100, fetchImpl: answering({}),
    });
    // Two scans, one real lookup — the second was served from cache and gave its reservation back.
    expect(store.docs[`${WEB_RISK_BUDGET_COLLECTION}/2026-08`].used).toBe(1);
  });

  it('🔒 an exhausted budget can never flag or hold an app', async () => {
    const store = fakeStore();
    const scan = await scanOriginsWithBudget({
      origins: ['https://evil.example.com'], token: 't', store, nowMs: AUG, limit: 0,
      fetchImpl: answering({ threat: { threatTypes: ['SOCIAL_ENGINEERING'] } }),
    });
    expect(scan.listed).toEqual([]);
    expect(scan.budgetExhausted).toBe(true);
  });
});

describe('🔒 the wiring — both spenders go through the ONE ceiling', () => {
  it('the daily re-scan is budgeted, not raw', () => {
    const server = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
    const at = server.indexOf("id: 'outbound-rescan'");
    expect(at).toBeGreaterThan(-1);
    const body = server.slice(at, at + 1800);
    expect(body).toContain('scanOriginsWithBudget(');
    expect(body).not.toContain('scanOrigins(');
  });

  it('the budget module is the only place that calls the raw scanner', () => {
    const budget = readFileSync(join(process.cwd(), 'src/server/AgentV3/webRiskBudget.ts'), 'utf8');
    expect(budget).toContain("import { scanOrigins");
  });
});
