/** Delayed reads and discarded transaction retries exercise the actual durable user-quota authority. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FreeAnswerQuotaStore, FreeAnswerQuotaWindowChangedError } from './freeAnswerQuotaStore';

const START = Date.parse('2026-10-26T10:00:00Z');
const SUBJECT = { key: 'guest:synthetic-clock-diagnostic', limit: 5 };
const requestId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
interface Plan { readAt: number[]; beforeRetry?: () => Promise<void> }
function fixture() {
  const docs = new Map<string, any>();
  let planned: Plan | undefined;
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: async (callback: (tx: any) => Promise<any>) => {
      const plan = planned; planned = undefined;
      const attempts = plan?.readAt.length ?? 1;
      for (let index = 0; index < attempts; index++) {
        const writes = new Map<string, any>();
        let moved = false;
        const result = await callback({
          get: async ({ path }: { path: string }) => {
            const exists = docs.has(path); const value = structuredClone(docs.get(path));
            // Realistic delayed read result: time advances after the SDK read begins, before it resolves.
            await Promise.resolve();
            if (!moved && plan) { moved = true; vi.setSystemTime(plan.readAt[index]); }
            return { exists, data: () => structuredClone(value) };
          },
          set: ({ path }: { path: string }, value: unknown) => writes.set(path, structuredClone(value)),
        });
        if (index + 1 < attempts) {
          // Firestore conflict retry: discard tentative writes and invoke the callback again.
          if (plan?.beforeRetry) await plan.beforeRetry();
          continue;
        }
        for (const [path, value] of writes) docs.set(path, value);
        return result;
      }
    },
  };
  const store = new FreeAnswerQuotaStore(db as never);
  return { store, db, docs, plan: (value: Plan) => { planned = value; } };
}
async function hold(store: FreeAnswerQuotaStore, id = 1) {
  const decision = await store.reserve(SUBJECT, requestId(id));
  if (!decision.allowed) throw new Error(decision.reason);
  return decision.reservation;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START); });
afterEach(() => { vi.useRealTimers(); });
it.each(['delayed-read', 'transaction-retry'] as const)('must not revive an expired user lease through %s', async mode => {
  const f = fixture(); const reservation = await hold(f.store);
  vi.setSystemTime(START + 20_000);
  f.plan({ readAt: mode === 'delayed-read' ? [START + 31_000] : [START + 25_000, START + 31_000] });
  const renewed = await f.store.renew(reservation);
  const status = await f.store.status(SUBJECT);
  const principal = [...f.docs].find(([key]) => key.includes('/principal_'))![1];
  expect(principal.active.leaseExpiresAt).toBe(reservation.leaseExpiresAt);
  expect(status.inProgress).toBe(false);
  expect(renewed, 'Only a still-live owner may renew; transaction result is after expiry').toBe(false);
});

it.each(['delayed-read', 'transaction-retry'] as const)('must retain expired uncertainty instead of refunding through %s', async mode => {
  const f = fixture(); const reservation = await hold(f.store);
  vi.setSystemTime(START + 29_000);
  f.plan({ readAt: mode === 'delayed-read' ? [START + 31_000] : [START + 29_500, START + 31_000] });
  const refunded = await f.store.settle(reservation, 'provider-failed');
  const status = await f.store.status(SUBJECT);
  const attempt = [...f.docs].find(([key]) => key.includes('/attempt_'))![1];
  expect(attempt.state).toBe('held');
  expect(refunded, 'Expired ownership is uncertain and must not regain a user credit').toBe(false);
  expect(status.used).toBe(1);
});

it.each(['delayed-read', 'transaction-retry'] as const)('must not reject an already expired prior owner as busy after %s', async mode => {
  const f = fixture(); await hold(f.store);
  vi.setSystemTime(START + 29_000);
  f.plan({ readAt: mode === 'delayed-read' ? [START + 31_000] : [START + 29_500, START + 31_000] });
  const decision = await f.store.reserve(SUBJECT, requestId(2));
  expect(decision.allowed, 'Stale request time turns an expired owner into a false busy response').toBe(true);
});

it('must not return an admission whose initial lease expired during its own database reads', async () => {
  const f = fixture(); f.plan({ readAt: [START + 31_000] });
  const decision = await f.store.reserve(SUBJECT, requestId(1));
  expect(decision.allowed).toBe(true);
  if (decision.allowed) expect(decision.reservation.leaseExpiresAt).toBeGreaterThan(Date.now());
});

it('must report current lease liveness after a delayed status read', async () => {
  const f = fixture(); await hold(f.store);
  vi.setSystemTime(START + 29_000); f.plan({ readAt: [START + 31_000] });
  const status = await f.store.status(SUBJECT);
  expect(status.inProgress).toBe(false);
});

it('must not report yesterday as the current status when a read crosses midnight IST', async () => {
  const midnight = Date.parse('2026-10-26T18:30:00Z'); vi.setSystemTime(midnight - 1_000);
  const f = fixture(); f.plan({ readAt: [midnight + 1_000] });
  const status = await f.store.status(SUBJECT);
  expect(status.day).toBe('2026-10-27'); expect(status.resetsAt).toBeGreaterThan(Date.now());
});

it.each(['renew', 'refund'] as const)('preserves successor fencing despite stale %s clock and retry', async operation => {
  const f = fixture(); const old = await hold(f.store); let next: typeof old | undefined;
  vi.setSystemTime(START + 29_000);
  f.plan({ readAt: [START + 29_500, START + 31_500], beforeRetry: async () => {
    vi.setSystemTime(START + 31_000); next = await hold(new FreeAnswerQuotaStore(f.db as never), 2);
  } });
  const result = operation === 'renew' ? await f.store.renew(old) : await f.store.settle(old, 'provider-failed');
  const principal = [...f.docs].find(([key]) => key.includes('/principal_'))![1];
  expect(result).toBe(false); expect(principal.active?.owner).toBe(next?.owner);
});

it('preserves deterministic explicit-time fixtures even when the wall clock is different', async () => {
  const f = fixture(); vi.setSystemTime(START + 100_000);
  const decision = await f.store.reserve(SUBJECT, requestId(1), START);
  expect(decision.allowed).toBe(true);
  if (!decision.allowed) return;
  expect(await f.store.renew(decision.reservation, START + 20_000)).toBe(true);
  expect(await f.store.settle(decision.reservation, 'provider-failed', START + 25_000)).toBe(true);
  const status = await f.store.status(SUBJECT, START + 25_000);
  expect(status).toMatchObject({ used: 0, reserved: 0, remaining: 5, inProgress: false });
});


it('refreshes the initial lease without moving its original ninety-second deadline', async () => {
  const f = fixture(); f.plan({ readAt: [START + 85_000] });
  const reservation = await hold(f.store);
  expect(reservation).toMatchObject({ startedAt: START, deadlineAt: START + 90_000, leaseExpiresAt: START + 90_000 });
  expect(reservation).not.toHaveProperty('admittedAt');
});

it('does not consume a credit or attempt when the original request deadline expires during reads', async () => {
  const f = fixture(); f.plan({ readAt: [START + 90_000] });
  await expect(f.store.reserve(SUBJECT, requestId(1))).rejects.toThrow();
  expect(f.docs.size).toBe(0);
});

it.each(['delayed-read', 'transaction-retry'] as const)('rejects a midnight-crossing admission before any write through %s', async mode => {
  const midnight = Date.parse('2026-10-26T18:30:00Z'); vi.setSystemTime(midnight - 1_000);
  const f = fixture(); f.plan({ readAt: mode === 'delayed-read' ? [midnight + 1_000] : [midnight - 500, midnight + 1_000] });
  await expect(f.store.reserve({ ...SUBJECT, ipKey: 'ip:synthetic-shared-address' }, requestId(1)))
    .rejects.toBeInstanceOf(FreeAnswerQuotaWindowChangedError);
  expect(f.docs.size).toBe(0);
  const reservation = await hold(f.store);
  expect(reservation.day).toBe('2026-10-27');
  expect(reservation.startedAt).toBe(midnight + 1_000);
  expect(await f.store.reserve(SUBJECT, requestId(1))).toMatchObject({ allowed: false, reason: 'duplicate' });
});

it('reselects the new daily document rather than relabeling old counters in status', async () => {
  const midnight = Date.parse('2026-10-26T18:30:00Z');
  const f = fixture();
  const admitted = await f.store.reserve(SUBJECT, requestId(1), midnight + 1_000);
  expect(admitted.allowed).toBe(true);
  vi.setSystemTime(midnight - 1_000); f.plan({ readAt: [midnight + 2_000] });
  expect(await f.store.status(SUBJECT)).toMatchObject({ day: '2026-10-27', reserved: 1, remaining: 4, inProgress: true });
  expect(f.docs.size).toBe(3);
});

it('settles a still-live admitted owner across midnight against only its originally recorded day', async () => {
  const midnight = Date.parse('2026-10-26T18:30:00Z'); vi.setSystemTime(midnight - 10_000);
  const f = fixture(); const reservation = await hold(f.store);
  vi.setSystemTime(midnight - 1_000); f.plan({ readAt: [midnight + 1_000] });
  expect(await f.store.settle(reservation, 'provider-failed')).toBe(true);
  const days = [...f.docs].filter(([path]) => path.includes('/day_'));
  expect(days).toHaveLength(1); expect(days[0][1]).toMatchObject({ day: '2026-10-26', consumed: 0, attempts: 1 });
  expect(await f.store.status(SUBJECT)).toMatchObject({ day: '2026-10-27', used: 0, reserved: 0, remaining: 5 });
  expect(await f.store.reserve(SUBJECT, requestId(1))).toMatchObject({ allowed: false, reason: 'duplicate' });
});

it('fails closed if trusted time moves backwards during transaction reads', async () => {
  const f = fixture(); f.plan({ readAt: [START - 1] });
  await expect(f.store.reserve(SUBJECT, requestId(1))).rejects.toThrow();
  expect(f.docs.size).toBe(0);
});
