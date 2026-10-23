import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FreeChainStore } from '../src/server/AI/FreeChain/store';
import { civilDayWindow, DAY_MS, HOUR_MS, MINUTE_MS, quotaCapacity, type QuotaReservationInput } from '../src/server/AI/FreeChain/quota';
import { DEFAULT_PAID_CAP_NANO_USD, NANO_USD, OWNER_PAID_DAILY_CEILING_NANO_USD, maximumCostNanoUsd, usdToNanoUsd } from '../src/server/AI/FreeChain/spendCap';

/** Serialized commits model the shared transaction authority, NOT per-instance fake counters. */
class FakeFirestore {
  readonly docs = new Map<string, Record<string, unknown>>();
  fail = false;
  commitThenThrow = false;
  retryNext = false;
  private tail = Promise.resolve();
  private snapshot(path: string) {
    const data = this.docs.get(path);
    return { exists: data !== undefined, data: () => data === undefined ? undefined : structuredClone(data) };
  }
  doc(path: string) { return { path, get: async () => { if (this.fail) throw new Error('offline'); return this.snapshot(path); } }; }
  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    let release!: () => void;
    const prior = this.tail;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try {
      if (this.fail) throw new Error('offline');
      const attempt = async () => {
        const writes = new Map<string, Record<string, unknown>>();
        const value = await fn({
          get: async (ref: { path: string }) => {
            if (writes.size) throw new Error('Firestore reads must precede writes');
            return this.snapshot(ref.path);
          },
          set: (ref: { path: string }, data: Record<string, unknown>) => { writes.set(ref.path, structuredClone(data)); },
        });
        return { value, writes };
      };
      if (this.retryNext) { this.retryNext = false; await attempt(); }
      const { value, writes } = await attempt();
      for (const [path, data] of writes) this.docs.set(path, data);
      if (this.commitThenThrow) { this.commitThenThrow = false; throw new Error('commit acknowledgement lost'); }
      return value;
    } finally { release(); }
  }
  store(adminEmails: string[] = []) { return new FreeChainStore(this as unknown as Firestore, { adminEmails: () => adminEmails }); }
  matching(kind: string) { return [...this.docs.entries()].filter(([, d]) => d.kind === kind); }
}
const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const quota = (overrides: Partial<QuotaReservationInput> = {}): QuotaReservationInput => ({
  provider: 'test-provider', model: 'test-model', timeZone: 'UTC', inputTokens: 10, outputTokens: 10,
  limits: { rpm: 100, rpd: 1000, tpm: 10000, tpd: 100000 }, ...overrides,
});
const paid = (requestId: string, maxCostNanoUsd = 100_000_000, uid = 'authenticated-user') => ({ requestId, uid, maxCostNanoUsd });
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK PROHIBITED'); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('calendar and fixed-point primitives', () => {
  it('finds IST midnight rather than UTC midnight', () => {
    expect(civilDayWindow(Date.parse('2026-10-22T18:29:59.999Z'), 'Asia/Kolkata')).toEqual({
      key: '2026-10-22', startAt: Date.parse('2026-10-21T18:30:00Z'), resetAt: Date.parse('2026-10-22T18:30:00Z'),
    });
    expect(civilDayWindow(Date.parse('2026-10-22T18:30:00Z'), 'Asia/Kolkata').key).toBe('2026-10-23');
  });
  it('handles both DST transitions with real 23/25-hour days', () => {
    const spring = civilDayWindow(Date.parse('2026-03-08T17:00:00Z'), 'America/Los_Angeles');
    const autumn = civilDayWindow(Date.parse('2026-11-01T17:00:00Z'), 'America/Los_Angeles');
    expect(spring.resetAt - spring.startAt).toBe(23 * HOUR_MS);
    expect(autumn.resetAt - autumn.startAt).toBe(25 * HOUR_MS);
    expect(civilDayWindow(spring.resetAt - 1, 'America/Los_Angeles').key).toBe(spring.key);
    expect(civilDayWindow(spring.resetAt, 'America/Los_Angeles').key).not.toBe(spring.key);
  });
  it('never rounds a quota safety limit upward at large integer boundaries', () => {
    expect(quotaCapacity(Number.MAX_SAFE_INTEGER, .9)).toBe(Number(BigInt(Number.MAX_SAFE_INTEGER) * 9n / 10n));
    expect(quotaCapacity(1000001, .123456789)).toBe(Number(1000001n * 123456n / 1000000n));
  });
  it('rejects invalid timezones and clocks rather than silently assuming UTC', () => {
    expect(() => civilDayWindow(NOW, 'not-a-zone')).toThrow();
    expect(() => civilDayWindow(NOW, undefined as unknown as string)).toThrow();
    expect(() => civilDayWindow(NOW, '')).toThrow();
    expect(() => civilDayWindow(NaN, 'UTC')).toThrow();
  });
  it('uses exact integer money and rounds maximum quotes up', () => {
    expect(usdToNanoUsd('0.000000001')).toBe(1);
    expect(usdToNanoUsd('2.00')).toBe(2_000_000_000);
    expect(maximumCostNanoUsd(1_048_576, 1024, 300_000_000, 1_200_000_000)).toBe(315_801_600);
    expect(maximumCostNanoUsd(1, 0, 1, 0)).toBe(1);
    expect(() => usdToNanoUsd('0.0000000001')).toThrow();
    expect(() => maximumCostNanoUsd(Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER, 0)).toThrow();
  });
});

describe('cross-instance quota admissions', () => {
  it('enforces 90% RPM atomically across store instances, including failed attempts', async () => {
    const db = new FakeFirestore(), a = db.store(), b = db.store();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).reserveQuota(quota({ limits: { rpm: 10 } }), NOW)));
    expect(results.filter(r => r.allowed)).toHaveLength(9);
    expect((await a.quotaSnapshot(quota(), NOW)).usage.rpm).toBe(9);
    // There is deliberately no release on timeout/abort/failure.
    expect((await b.reserveQuota(quota({ limits: { rpm: 10 } }), NOW)).reason).toBe('rpm');
  });
  it.each([
    ['rpd', { rpd: 10 }, 1, 9],
    ['tpm', { tpm: 100 }, 20, 4],
    ['tpd', { tpd: 100 }, 20, 4],
  ] as const)('checks %s using maximum input + output tokens', async (reason, limits, _unit, count) => {
    const db = new FakeFirestore(), store = db.store();
    const results = await Promise.all(Array.from({ length: 15 }, () => store.reserveQuota(quota({ limits }), NOW)));
    expect(results.filter(r => r.allowed)).toHaveLength(count);
    expect(results.filter(r => !r.allowed).every(r => r.reason === reason)).toBe(true);
  });
  it('will not spend two minute allowances across a fixed minute boundary', async () => {
    const store = new FakeFirestore().store();
    const input = quota({ limits: { rpm: 10 } });
    for (let i = 0; i < 9; i++) expect((await store.reserveQuota(input, NOW + MINUTE_MS - 1)).allowed).toBe(true);
    expect((await store.reserveQuota(input, NOW + MINUTE_MS)).allowed).toBe(false);
    expect((await store.reserveQuota(input, NOW + 2 * MINUTE_MS)).allowed).toBe(true);
  });
  it('resets at a configured local midnight without counting old usage', async () => {
    const store = new FakeFirestore().store();
    const input = quota({ timeZone: 'America/Los_Angeles', limits: { rpd: 10 } });
    const end = civilDayWindow(NOW, input.timeZone).resetAt;
    for (let i = 0; i < 9; i++) await store.reserveQuota(input, end - 1);
    expect((await store.reserveQuota(input, end - 1)).reason).toBe('rpd');
    expect((await store.reserveQuota(input, end)).allowed).toBe(true);
  });
  it('holds rolling RPD for a full 24 hours instead of a UTC boundary', async () => {
    const store = new FakeFirestore().store();
    const input = quota({ timeZone: 'rolling24h', limits: { rpd: 10 } });
    const at = NOW + 30 * MINUTE_MS;
    for (let i = 0; i < 9; i++) await store.reserveQuota(input, at);
    expect((await store.reserveQuota(input, at + DAY_MS - 1)).allowed).toBe(false);
    // The whole oldest hour remains held for safety; there are at most25 hourly buckets.
    expect((await store.reserveQuota(input, NOW + 25 * HOUR_MS)).allowed).toBe(true);
  });
  it('shares account neurons between models while preserving separate model quotas', async () => {
    const db = new FakeFirestore(), a = db.store(), b = db.store();
    const input = quota({ limits: { rpm: 100, neuronsPerDay: 100, neuronsPerRequest: 30 } });
    expect((await a.reserveQuota(input, NOW)).allowed).toBe(true);
    expect((await b.reserveQuota({ ...input, model: 'model-b' }, NOW)).allowed).toBe(true);
    expect((await a.reserveQuota(input, NOW)).allowed).toBe(true);
    expect((await b.reserveQuota({ ...input, model: 'model-c' }, NOW)).reason).toBe('neuronsPerDay');
    expect((await b.quotaSnapshot(input, NOW)).usage.neuronsPerDay).toBe(90);
  });
  it('can share an account quota scope across model choices', async () => {
    const store = new FakeFirestore().store();
    const input = quota({ quotaScope: 'shared-account', limits: { rpm: 2 } });
    expect((await store.reserveQuota(input, NOW)).allowed).toBe(true);
    expect((await store.reserveQuota({ ...input, model: 'another-model' }, NOW)).reason).toBe('rpm');
  });
  it('persists monotonic provider cooldowns across instances', async () => {
    const db = new FakeFirestore(), a = db.store(), b = db.store();
    await a.cooldown('test-provider', NOW + 5 * MINUTE_MS);
    await b.cooldown('test-provider', NOW + MINUTE_MS);
    expect(await b.reserveQuota(quota(), NOW)).toEqual({ allowed: false, reason: 'cooldown', resetAt: NOW + 5 * MINUTE_MS });
    expect((await a.reserveQuota(quota(), NOW + 5 * MINUTE_MS)).allowed).toBe(true);
  });
  it('fails closed on store errors, invalid configs, corrupted ledgers, and clock rollback', async () => {
    const db = new FakeFirestore(), store = db.store();
    expect((await new FreeChainStore(null).reserveQuota(quota(), NOW)).reason).toBe('store_unavailable');
    expect((await store.reserveQuota(quota({ limits: {} }), NOW)).reason).toBe('invalid_quota');
    expect((await store.reserveQuota(quota({ limits: { neuronsPerDay: 100 } }), NOW)).allowed).toBe(false);
    expect((await store.reserveQuota(quota({ inputTokens: Infinity }), NOW)).allowed).toBe(false);
    db.fail = true;
    expect((await store.reserveQuota(quota(), NOW)).reason).toBe('store_unavailable');
    db.fail = false;
    await store.reserveQuota(quota(), NOW);
    expect((await store.reserveQuota(quota(), NOW - 1)).reason).toBe('store_corrupt');
    const [path, data] = db.matching('quota')[0];
    db.docs.set(path, { ...data, minutes: [{ requests: NaN }] });
    expect((await store.reserveQuota(quota(), NOW)).reason).toBe('store_corrupt');
  });
  it('does not turn a malformed civil-day boundary into an early daily reset', async () => {
    const db = new FakeFirestore(), store = db.store();
    await store.reserveQuota(quota(), NOW);
    const [path, data] = db.matching('quota')[0];
    const days = data.days as Array<Record<string, unknown>>;
    db.docs.set(path, { ...data, days: [{ ...days[0], resetAt: NOW }] });
    expect((await store.reserveQuota(quota(), NOW)).reason).toBe('store_corrupt');
    db.docs.set(path, { ...data, timeZone: undefined });
    expect((await store.reserveQuota(quota(), NOW)).reason).toBe('store_corrupt');
  });
  it('keeps admission charges after an uncertain commit and is safe when Firestore retries callbacks', async () => {
    const db = new FakeFirestore(), store = db.store();
    db.retryNext = true;
    expect((await store.reserveQuota(quota(), NOW)).allowed).toBe(true);
    expect((await store.quotaSnapshot(quota(), NOW)).usage.rpm).toBe(1);
    db.commitThenThrow = true;
    expect((await store.reserveQuota(quota(), NOW)).allowed).toBe(false);
    expect((await store.quotaSnapshot(quota(), NOW)).usage.rpm).toBe(2);
  });
  it('keeps state bounded over long-running rolling-day traffic', async () => {
    const db = new FakeFirestore(), store = db.store();
    const input = quota({ timeZone: 'rolling24h', limits: { rpd: 1000 } });
    for (let i = 0; i < 100; i++) expect((await store.reserveQuota(input, NOW + i * HOUR_MS)).allowed).toBe(true);
    const record = db.matching('quota')[0][1];
    expect((record.days as unknown[]).length).toBeLessThanOrEqual(25);
    expect((record.minutes as unknown[]).length).toBeLessThanOrEqual(2);
    // Reused authority docs cannot be TTL-deleted after a concurrent fresh admission.
    expect(record.expiresAt).toBeUndefined();
  });
});

describe('paid fallback reservations', () => {
  it('cannot oversubscribe an explicitly lowered shared $2 cap across instances', async () => {
    const db = new FakeFirestore(), a = db.store(), b = db.store();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).reservePaid({ ...paid(`call-${i}`, 200_000_000, `user-${i}`), capNanoUsd: 2 * NANO_USD }, NOW)));
    expect(results.filter(r => r?.mayDispatch)).toHaveLength(10);
    expect(await a.spendSnapshot(NOW)).toMatchObject({ committedNanoUsd: 2_000_000_000, capNanoUsd: 2_000_000_000, remainingNanoUsd: 0 });
    expect(await b.reservePaid({ ...paid('blocked'), capNanoUsd: 2 * NANO_USD }, NOW)).toBeNull();
  });
  it('defaults to the single owner-authorized $10 ceiling across concurrent paid providers, keys and instances', async () => {
    expect(OWNER_PAID_DAILY_CEILING_NANO_USD).toBe(10_000_000_000);
    expect(DEFAULT_PAID_CAP_NANO_USD).toBe(OWNER_PAID_DAILY_CEILING_NANO_USD);
    const db = new FakeFirestore(), stores = [db.store(), db.store(), db.store(), db.store()];
    await stores[0].observePaidBudgetPolicy(undefined, NOW);
    expect(await stores[0].spendSnapshot(NOW)).toMatchObject({ capNanoUsd: 10 * NANO_USD, remainingNanoUsd: 10 * NANO_USD });
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => stores[i % stores.length]
      .reservePaid(paid(`provider-${i % 3}:key-${i % 2}:call-${i}`, NANO_USD, `user-${i}`), NOW)));
    expect(results.filter(r => r?.mayDispatch)).toHaveLength(10);
    expect(db.matching('paid_day')).toHaveLength(1);
    expect(await stores[3].spendSnapshot(NOW)).toMatchObject({ heldNanoUsd: 10 * NANO_USD,
      committedNanoUsd: 10 * NANO_USD, capNanoUsd: 10 * NANO_USD, remainingNanoUsd: 0, requests: 10, pending: 10 });
    expect(await stores[1].reservePaid(paid('another-provider:new-key:extra-call', 1, 'another-user'), NOW)).toBeNull();
  });
  it('rejects above-ceiling reservation inputs and policy observations without multiplying the budget', async () => {
    const db = new FakeFirestore(), store = db.store();
    for (const capNanoUsd of [OWNER_PAID_DAILY_CEILING_NANO_USD + 1, Number.MAX_SAFE_INTEGER, Infinity, NaN]) {
      expect(await store.reservePaid({ ...paid(`invalid-${capNanoUsd}`), capNanoUsd }, NOW)).toBeNull();
      await expect(store.observePaidBudgetPolicy(capNanoUsd, NOW)).rejects.toThrow('Invalid spend cap');
    }
    expect(await store.reservePaid(paid('cost-above-owner-ceiling', OWNER_PAID_DAILY_CEILING_NANO_USD + 1), NOW)).toBeNull();
    expect(db.docs.size).toBe(0);
    expect(await store.reservePaid({ ...paid('zero-cap'), capNanoUsd: 0 }, NOW)).toBeNull();
    expect(await store.spendSnapshot(NOW)).toMatchObject({ capNanoUsd: 0, remainingNanoUsd: 0 });
    expect(db.docs.size).toBe(1); // The denied call still durably publishes the global zero cap.
  });
  it('keeps unknown holds against the entire default $10 budget across instances until complete usage arrives', async () => {
    const db = new FakeFirestore(), a = db.store(), b = db.store();
    const first = (await a.reservePaid(paid('paid-provider-a', 6 * NANO_USD, 'user-a'), NOW))!;
    const second = (await b.reservePaid(paid('paid-provider-b', 4 * NANO_USD, 'user-b'), NOW))!;
    expect(first.mayDispatch && second.mayDispatch).toBe(true);
    for (const cost of [undefined, NaN, Infinity, -1]) expect(await b.settlePaid(first, cost, NOW + MINUTE_MS)).toBe(false);
    expect(await a.settlePaid(second, undefined, NOW + 400 * DAY_MS)).toBe(false);
    expect(await b.reservePaid(paid('paid-provider-c:new-key', 1, 'user-c'), NOW + MINUTE_MS)).toBeNull();
    expect(await a.spendSnapshot(NOW)).toMatchObject({ capNanoUsd: 10 * NANO_USD, heldNanoUsd: 10 * NANO_USD, pending: 2, remainingNanoUsd: 0 });
    expect(db.matching('paid_day')[0][1].expiresAt).toBeUndefined();
    for (const [, hold] of db.matching('paid_reservation')) expect(hold.expiresAt).toBeUndefined();
    expect(await b.settlePaid(first, 2 * NANO_USD, NOW + MINUTE_MS)).toBe(true);
    expect((await a.reservePaid(paid('paid-provider-c:known-headroom', 4 * NANO_USD, 'user-c'), NOW + MINUTE_MS))?.mayDispatch).toBe(true);
    expect(await b.spendSnapshot(NOW)).toMatchObject({ spentNanoUsd: 2 * NANO_USD, heldNanoUsd: 8 * NANO_USD,
      committedNanoUsd: 10 * NANO_USD, remainingNanoUsd: 0 });
  });
  it('retains a full $10 reservation after a lost commit acknowledgement without granting a replay', async () => {
    const db = new FakeFirestore(), a = db.store(), b = db.store();
    db.commitThenThrow = true;
    expect(await a.reservePaid(paid('uncertain-provider-a', 10 * NANO_USD), NOW)).toBeNull();
    expect((await b.reservePaid(paid('uncertain-provider-a', 10 * NANO_USD), NOW))?.mayDispatch).toBe(false);
    expect(await b.reservePaid(paid('different-provider-b', 1, 'another-user'), NOW)).toBeNull();
    expect(await a.spendSnapshot(NOW)).toMatchObject({ heldNanoUsd: 10 * NANO_USD,
      capNanoUsd: 10 * NANO_USD, requests: 1, pending: 1, remainingNanoUsd: 0 });
    expect(db.matching('paid_day')[0][1].expiresAt).toBeUndefined();
    expect(db.matching('paid_reservation')[0][1].expiresAt).toBeUndefined();
  });
  it('records a genuine receipt above the owner ceiling honestly and blocks every further admission', async () => {
    const db = new FakeFirestore(), a = db.store(), b = db.store();
    const held = (await a.reservePaid(paid('unexpected-overrun', NANO_USD), NOW))!;
    expect(await b.settlePaid(held, 11 * NANO_USD, NOW)).toBe(true);
    expect(await a.spendSnapshot(NOW)).toMatchObject({ heldNanoUsd: 0, spentNanoUsd: 11 * NANO_USD,
      committedNanoUsd: 11 * NANO_USD, capNanoUsd: 10 * NANO_USD, remainingNanoUsd: 0, pending: 0 });
    expect(await b.reservePaid(paid('different-provider', 1, 'another-user'), NOW)).toBeNull();
  });
  it('enforces20/day per authenticated uid, not per process, and never persists raw user ids', async () => {
    const db = new FakeFirestore(), a = db.store(), b = db.store();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).reservePaid(paid(`call-${i}`, 100, 'private-user-id'), NOW)));
    expect(results.filter(r => r?.mayDispatch)).toHaveLength(20);
    expect(JSON.stringify([...db.docs])).not.toContain('private-user-id');
    expect((await a.reservePaid(paid('other-user', 100, 'other'), NOW))?.mayDispatch).toBe(true);
  });
  it('issues exactly one dispatch grant for an idempotent request id', async () => {
    const db = new FakeFirestore(), stores = [db.store(), db.store()];
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => stores[i % 2].reservePaid(paid('same-call'), NOW)));
    expect(results.filter(r => r?.mayDispatch)).toHaveLength(1);
    expect(results.filter(r => r && !r.mayDispatch)).toHaveLength(9);
    expect((await stores[0].spendSnapshot(NOW)).requests).toBe(1);
    expect(await stores[0].reservePaid(paid('same-call', 99), NOW)).toBeNull();
    expect(await stores[0].reservePaid(paid('same-call', 100_000_000, 'another'), NOW)).toBeNull();
  });
  it('holds unknown usage indefinitely without expiry and settles only complete known cost', async () => {
    const db = new FakeFirestore(), store = db.store();
    const held = (await store.reservePaid(paid('unknown'), NOW))!;
    expect(await store.settlePaid(held, undefined, NOW + 400 * DAY_MS)).toBe(false);
    expect(db.matching('paid_day')[0][1].expiresAt).toBeUndefined();
    expect(db.matching('paid_reservation')[0][1].expiresAt).toBeUndefined();
    expect((await store.spendSnapshot(NOW)).committedNanoUsd).toBe(100_000_000);
    expect(await store.settlePaid(held, 30_000_000, NOW + 400 * DAY_MS)).toBe(true);
    expect((await store.spendSnapshot(NOW)).committedNanoUsd).toBe(30_000_000);
    expect(db.matching('paid_day')[0][1].expiresAt).toBeInstanceOf(Date);
    expect(db.matching('paid_reservation')[0][1].expiresAt).toBeUndefined();
  });
  it('never releases invalid or incomplete usage and counts failed/settled calls toward user limit', async () => {
    const db = new FakeFirestore(), store = db.store();
    const held = (await store.reservePaid({ ...paid('failure'), perUserLimit: 1 }, NOW))!;
    for (const actual of [undefined, NaN, Infinity, -1, 0.2]) expect(await store.settlePaid(held, actual, NOW)).toBe(false);
    expect((await store.spendSnapshot(NOW)).heldNanoUsd).toBe(100_000_000);
    expect(await store.settlePaid(held, 0, NOW)).toBe(true); // Explicit complete zero, never a missing-value default.
    expect(await store.reservePaid({ ...paid('second'), perUserLimit: 1 }, NOW)).toBeNull();
  });
  it('settles once even concurrently and refuses contradictory second receipts', async () => {
    const db = new FakeFirestore(), a = db.store(), b = db.store();
    const held = (await a.reservePaid(paid('settle'), NOW))!;
    expect(await Promise.all([a.settlePaid(held, 40, NOW), b.settlePaid(held, 40, NOW)])).toEqual([true, true]);
    expect((await a.spendSnapshot(NOW)).spentNanoUsd).toBe(40);
    expect(await b.settlePaid(held, 0, NOW)).toBe(false);
    expect((await a.reservePaid(paid('settle'), NOW))?.mayDispatch).toBe(false);
  });
  it('accounts a late receipt against its original IST day, not today', async () => {
    const db = new FakeFirestore(), store = db.store();
    const before = Date.parse('2026-10-22T18:29:59.999Z'), after = before + 1;
    const yesterday = (await store.reservePaid(paid('yesterday', 2_000_000_000), before))!;
    expect((await store.spendSnapshot(after)).committedNanoUsd).toBe(0);
    expect(await store.settlePaid(yesterday, 1_000_000_000, after)).toBe(true);
    expect((await store.spendSnapshot(before)).committedNanoUsd).toBe(1_000_000_000);
    expect((await store.reservePaid(paid('today', 2_000_000_000), after))?.mayDispatch).toBe(true);
    expect((await store.reservePaid(paid('yesterday', 2_000_000_000), after))?.mayDispatch).toBe(false);
  });
  it('fails closed for missing store, corrupted accounting, lost commit acknowledgement, and settlement failure', async () => {
    const db = new FakeFirestore(), store = db.store();
    expect(await new FreeChainStore(null).reservePaid(paid('missing'), NOW)).toBeNull();
    db.commitThenThrow = true;
    expect(await store.reservePaid(paid('lost-response'), NOW)).toBeNull();
    expect((await store.reservePaid(paid('lost-response'), NOW))?.mayDispatch).toBe(false);
    expect((await store.spendSnapshot(NOW)).heldNanoUsd).toBe(100_000_000);
    const held = (await store.reservePaid(paid('settlement-failure'), NOW))!;
    db.fail = true;
    expect(await store.settlePaid(held, 0, NOW)).toBe(false);
    db.fail = false;
    expect((await store.spendSnapshot(NOW)).heldNanoUsd).toBe(200_000_000);
    const [path, day] = db.matching('paid_day')[0];
    db.docs.set(path, { ...day, heldNanoUsd: -1 });
    expect(await store.reservePaid(paid('corrupt'), NOW)).toBeNull();
    expect(await store.settlePaid(held, 0, NOW)).toBe(false);
  });
  it('does not cap a real receipt at the reservation and honestly reports an overrun', async () => {
    const db = new FakeFirestore(), store = db.store();
    const held = (await store.reservePaid({ ...paid('overrun'), capNanoUsd: 2 * NANO_USD }, NOW))!;
    expect(await store.settlePaid(held, 3_000_000_000, NOW)).toBe(true);
    expect((await store.spendSnapshot(NOW)).spentNanoUsd).toBe(3_000_000_000);
    expect(await store.reservePaid({ ...paid('blocked'), capNanoUsd: 2 * NANO_USD }, NOW)).toBeNull();
  });
  it('writes one admin-only50/80/100 notification per IST day transactionally, even on retries', async () => {
    const db = new FakeFirestore(), a = db.store(['admin@example.com']), b = db.store(['admin@example.com']);
    db.retryNext = true;
    for (let i = 0; i < 20; i++) await (i % 2 ? a : b).reservePaid({ ...paid(`notify-${i}`, 100_000_000, `user-${i}`), capNanoUsd: 2 * NANO_USD }, NOW);
    const notes = [...db.docs.entries()].filter(([path]) => path.startsWith('admin_notifications/'));
    expect(notes).toHaveLength(3);
    expect(notes.map(([, d]) => d.target)).toEqual(Array(3).fill({ type: 'user', email: 'admin@example.com' }));
    expect(db.matching('paid_day')[0][1].alertedPercent).toEqual([50, 80, 100]);
    const held = await a.reservePaid({ ...paid('notify-0', 100_000_000, 'user-0'), capNanoUsd: 2 * NANO_USD }, NOW);
    await a.settlePaid(held!, 0, NOW);
    await b.reservePaid({ ...paid('recross', 100_000_000, 'new'), capNanoUsd: 2 * NANO_USD }, NOW);
    expect([...db.docs.keys()].filter(k => k.startsWith('admin_notifications/'))).toHaveLength(3);
    await a.reservePaid({ ...paid('new-day', 2_000_000_000), capNanoUsd: 2 * NANO_USD }, NOW + DAY_MS);
    expect([...db.docs.keys()].filter(k => k.startsWith('admin_notifications/'))).toHaveLength(6);
  });
});


describe('durable paid-budget authority', () => {
  const policyPath = 'free_chat_chain/paid_budget_policy';
  const admin = (capNanoUsd: number, expectedRevision: number) => ({ capNanoUsd, expectedRevision,
    actorUid: 'verified-administrator', reason: 'Owner-approved daily budget adjustment' });
  it('keeps GET-style reads pure and reports missing authority as unavailable, not an invented budget', async () => {
    const db = new FakeFirestore(), store = db.store();
    expect(await store.readPaidBudgetPolicy()).toBeNull();
    expect(await store.spendSnapshot(NOW)).toMatchObject({ available: false, capNanoUsd: null,
      policyRevision: null, remainingNanoUsd: null, committedNanoUsd: 0 });
    expect(db.docs.size).toBe(0);
    expect(await store.observePaidBudgetPolicy(undefined, NOW)).toMatchObject({ capNanoUsd: 10 * NANO_USD, revision: 1, source: 'deployment' });
    const before = structuredClone([...db.docs]);
    expect(await store.readPaidBudgetPolicy()).toMatchObject({ capNanoUsd: 10 * NANO_USD, revision: 1 });
    expect(await store.spendSnapshot(NOW)).toMatchObject({ available: true, capNanoUsd: 10 * NANO_USD, policyRevision: 1 });
    expect([...db.docs]).toEqual(before);
  });
  it('makes mixed $10/$2/$0 revisions share the strictest cap without discarding existing holds', async () => {
    const db = new FakeFirestore(), old = db.store(), strict = db.store();
    const held = (await old.reservePaid(paid('existing-six-dollar-call', 6 * NANO_USD), NOW))!;
    expect(await strict.reservePaid({ ...paid('stricter-denied', 1), capNanoUsd: 2 * NANO_USD }, NOW)).toBeNull();
    expect(await old.reservePaid(paid('old-revision-bypass', 1), NOW)).toBeNull();
    expect(await old.spendSnapshot(NOW)).toMatchObject({ capNanoUsd: 2 * NANO_USD, policyRevision: 2,
      heldNanoUsd: 6 * NANO_USD, requests: 1, remainingNanoUsd: 0 });
    expect(await strict.reservePaid({ ...paid('zero-denied', 1), capNanoUsd: 0 }, NOW)).toBeNull();
    expect(await old.reservePaid(paid('old-revision-zero-bypass', 1), NOW)).toBeNull();
    expect(await old.settlePaid(held, undefined, NOW)).toBe(false);
    expect(await old.spendSnapshot(NOW)).toMatchObject({ capNanoUsd: 0, heldNanoUsd: 6 * NANO_USD, pending: 1 });
    expect(await old.reservePaid(paid('next-day-bypass', 1), NOW + DAY_MS)).toBeNull();
    expect(await strict.spendSnapshot(NOW + DAY_MS)).toMatchObject({ capNanoUsd: 0, committedNanoUsd: 0, remainingNanoUsd: 0 });
    expect(db.docs.get(policyPath)?.expiresAt).toBeUndefined();
    expect(db.matching('paid_day')[0][1].expiresAt).toBeUndefined();
    expect(db.matching('paid_reservation')[0][1].expiresAt).toBeUndefined();
    expect(await old.settlePaid(held, NANO_USD, NOW + DAY_MS)).toBe(true);
    expect(await strict.spendSnapshot(NOW)).toMatchObject({ capNanoUsd: 0, spentNanoUsd: NANO_USD, heldNanoUsd: 0 });
  });
  it('serializes concurrent lowering and never lets stale instances or midnight restore a larger cap', async () => {
    const db = new FakeFirestore(), stores = [db.store(), db.store(), db.store()];
    await Promise.all([10, 8, 2, 5, 0, 10, 1].map((usd, i) => stores[i % 3].observePaidBudgetPolicy(usd * NANO_USD, NOW)));
    expect(await stores[0].readPaidBudgetPolicy()).toMatchObject({ capNanoUsd: 0 });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => stores[i % 3]
      .reservePaid(paid(`stale-${i}`, 1, `user-${i}`), NOW + DAY_MS)));
    expect(results.every(value => value === null)).toBe(true);
    expect(db.matching('paid_day')).toHaveLength(0);
    expect(await stores[2].readPaidBudgetPolicy()).toMatchObject({ capNanoUsd: 0 });
  });
  it('publishes lowering on duplicate IDs and per-user denials without granting another dispatch', async () => {
    const db = new FakeFirestore(), a = db.store(), b = db.store();
    await a.reservePaid(paid('original'), NOW);
    expect((await b.reservePaid({ ...paid('original'), capNanoUsd: 2 * NANO_USD }, NOW))?.mayDispatch).toBe(false);
    expect(await a.readPaidBudgetPolicy()).toMatchObject({ capNanoUsd: 2 * NANO_USD });
    expect(await b.reservePaid({ ...paid('denied-user'), capNanoUsd: 0, perUserLimit: 0 }, NOW)).toBeNull();
    expect(await a.spendSnapshot(NOW)).toMatchObject({ capNanoUsd: 0, requests: 1, pending: 1, heldNanoUsd: 100_000_000 });
  });
  it('publishes a valid stricter cap even if an accounting record is malformed, without altering that record', async () => {
    const db = new FakeFirestore(), store = db.store();
    await store.reservePaid(paid('before-corruption'), NOW);
    const [path, day] = db.matching('paid_day')[0];
    const corrupt = { ...day, pending: -1 };
    db.docs.set(path, corrupt);
    expect(await store.reservePaid({ ...paid('lower-on-corrupt-day'), capNanoUsd: 0 }, NOW)).toBeNull();
    expect(await store.readPaidBudgetPolicy()).toMatchObject({ capNanoUsd: 0 });
    expect(db.docs.get(path)).toEqual(corrupt);
  });
  it('retains stricter policy publication even when historical spending reaches the safe-integer boundary', async () => {
    const db = new FakeFirestore(), store = db.store();
    await store.reservePaid(paid('historical-cost'), NOW);
    const [path, day] = db.matching('paid_day')[0];
    const historical = { ...day, spentNanoUsd: Number.MAX_SAFE_INTEGER - 100_000_000 };
    db.docs.set(path, historical);
    expect(await store.reservePaid({ ...paid('zero-cap-at-integer-boundary', 1), capNanoUsd: 0 }, NOW)).toBeNull();
    expect(await store.readPaidBudgetPolicy()).toMatchObject({ capNanoUsd: 0 });
    expect(db.docs.get(path)).toEqual(historical);
  });
  it('fails closed for malformed authority and never repairs or overwrites it incidentally', async () => {
    for (const bad of [{ capNanoUsd: 10 * NANO_USD + 1 }, { capNanoUsd: -1 }, { revision: 0 }, { revision: NaN },
      { version: 2 }, { kind: 'wrong' }, { source: 'unknown' }, { updatedAt: Infinity }, { expiresAt: new Date(NOW) }]) {
      const db = new FakeFirestore(), store = db.store();
      const held = (await store.reservePaid(paid('held-before-malformed'), NOW))!;
      const corrupt = { ...db.docs.get(policyPath), ...bad };
      db.docs.set(policyPath, corrupt);
      expect(await store.reservePaid(paid('blocked'), NOW)).toBeNull();
      await expect(store.observePaidBudgetPolicy(0, NOW)).rejects.toThrow();
      await expect(store.readPaidBudgetPolicy()).rejects.toThrow();
      await expect(store.spendSnapshot(NOW)).rejects.toThrow();
      expect(await store.setPaidBudgetPolicy(admin(0, 1), NOW)).toEqual({ ok: false, reason: 'policy_corrupt' });
      expect(await store.settlePaid(held, 0, NOW)).toBe(false);
      expect(db.docs.get(policyPath)).toEqual(corrupt);
      expect(db.matching('paid_day')[0][1].heldNanoUsd).toBe(100_000_000);
      expect(db.matching('paid_budget_policy_change')).toHaveLength(0);
    }
  });
  it('initializes and explicitly raises only with revision CAS and an atomic hashed-actor audit', async () => {
    const db = new FakeFirestore(), store = db.store();
    expect(await store.setPaidBudgetPolicy(admin(2 * NANO_USD, 0), NOW)).toMatchObject({ ok: true,
      policy: { capNanoUsd: 2 * NANO_USD, revision: 1, source: 'admin' } });
    expect(await store.setPaidBudgetPolicy(admin(10 * NANO_USD, 1), NOW)).toMatchObject({ ok: true,
      policy: { capNanoUsd: 10 * NANO_USD, revision: 2, source: 'admin' } });
    const before = structuredClone([...db.docs]);
    expect(await store.spendSnapshot(NOW)).toMatchObject({ capNanoUsd: 10 * NANO_USD, policyRevision: 2 });
    expect(await store.readPaidBudgetPolicy()).toMatchObject({ capNanoUsd: 10 * NANO_USD, revision: 2 });
    expect([...db.docs]).toEqual(before); // Admin refresh does not undo the audited raise.
    const audits = db.matching('paid_budget_policy_change');
    expect(audits).toHaveLength(2);
    expect(audits[1][0]).toBe('free_chat_chain/state/actions/paid-budget-policy-2');
    expect(audits[1][1]).toMatchObject({ before: { revision: 1, capNanoUsd: 2 * NANO_USD },
      after: { revision: 2, capNanoUsd: 10 * NANO_USD }, at: NOW, reason: 'Owner-approved daily budget adjustment' });
    expect(audits[1][1].actor).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify([...db.docs])).not.toContain('verified-administrator');
    expect(db.docs.get(policyPath)?.expiresAt).toBeUndefined();
    expect((await store.reservePaid(paid('after-explicit-raise', 3 * NANO_USD), NOW))?.mayDispatch).toBe(true);
    expect(await store.setPaidBudgetPolicy(admin(0, 2), NOW)).toMatchObject({ ok: true, policy: { revision: 3, capNanoUsd: 0 } });
    expect(await store.spendSnapshot(NOW)).toMatchObject({ capNanoUsd: 0, heldNanoUsd: 3 * NANO_USD, pending: 1 });
  });
  it('rejects stale admin revisions and permits only one concurrent administrator update', async () => {
    const db = new FakeFirestore(), a = db.store(), b = db.store();
    await a.observePaidBudgetPolicy(10 * NANO_USD, NOW);
    await b.observePaidBudgetPolicy(2 * NANO_USD, NOW);
    expect(await a.setPaidBudgetPolicy(admin(10 * NANO_USD, 1), NOW)).toMatchObject({ ok: false, reason: 'conflict', policy: { revision: 2, capNanoUsd: 2 * NANO_USD } });
    expect(db.matching('paid_budget_policy_change')).toHaveLength(0);
    const updates = await Promise.all([a.setPaidBudgetPolicy(admin(5 * NANO_USD, 2), NOW), b.setPaidBudgetPolicy(admin(10 * NANO_USD, 2), NOW)]);
    expect(updates.filter(result => result.ok)).toHaveLength(1);
    expect(updates.filter(result => !result.ok && result.reason === 'conflict')).toHaveLength(1);
    expect(await a.readPaidBudgetPolicy()).toMatchObject({ revision: 3 });
    expect(db.matching('paid_budget_policy_change')).toHaveLength(1);
  });
  it('never lets admin requests exceed the owner ceiling or bypass malformed input checks', async () => {
    const db = new FakeFirestore(), store = db.store();
    for (const patch of [{ capNanoUsd: 10 * NANO_USD + 1 }, { capNanoUsd: NaN }, { capNanoUsd: 0.5 },
      { expectedRevision: -1 }, { expectedRevision: 0.5 }, { actorUid: '' }, { reason: '  ' }, { reason: 'x'.repeat(501) }]) {
      expect(await store.setPaidBudgetPolicy({ ...admin(10 * NANO_USD, 0), ...patch }, NOW)).toEqual({ ok: false, reason: 'invalid_input' });
    }
    expect(db.docs.size).toBe(0);
    expect(await new FreeChainStore(null).setPaidBudgetPolicy(admin(0, 0), NOW)).toEqual({ ok: false, reason: 'unavailable' });
  });
  it('keeps an uncertain admin commit and its audit atomic, rejecting a blind stale-revision retry', async () => {
    const db = new FakeFirestore(), a = db.store(), b = db.store();
    await a.observePaidBudgetPolicy(0, NOW);
    db.commitThenThrow = true;
    expect(await a.setPaidBudgetPolicy(admin(10 * NANO_USD, 1), NOW)).toEqual({ ok: false, reason: 'unavailable' });
    expect(await b.readPaidBudgetPolicy()).toMatchObject({ revision: 2, capNanoUsd: 10 * NANO_USD, source: 'admin' });
    expect(db.matching('paid_budget_policy_change')).toHaveLength(1);
    expect(await b.setPaidBudgetPolicy(admin(10 * NANO_USD, 1), NOW)).toMatchObject({ ok: false, reason: 'conflict', policy: { revision: 2 } });
    expect(db.matching('paid_budget_policy_change')).toHaveLength(1);
    // A new stricter deployment still wins, but merely reading admin state never changes it.
    await b.observePaidBudgetPolicy(2 * NANO_USD, NOW);
    expect(await a.readPaidBudgetPolicy()).toMatchObject({ revision: 3, capNanoUsd: 2 * NANO_USD, source: 'deployment' });
  });
});
