import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FreeAnswerQuotaStore, FREE_ANSWER_LEASE_MS } from './freeAnswerQuotaStore';

const at = Date.parse('2026-10-23T10:00:00Z');
const uid = { key: 'uid:verified-user', limit: 20 as const };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const docs = new Map<string, any>();
  let serial = Promise.resolve();
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: (run: (tx: any) => Promise<unknown>) => {
      const result = serial.then(async () => {
        const writes = new Map<string, unknown>();
        const result = await run({
          get: async (ref: { path: string }) => ({ exists: docs.has(ref.path), data: () => structuredClone(docs.get(ref.path)) }),
          set: (ref: { path: string }, value: unknown) => writes.set(ref.path, structuredClone(value)),
        });
        for (const [key, value] of writes) docs.set(key, value);
        return result;
      });
      serial = result.then(() => {}, () => {});
      return result;
    },
  } as unknown as Pick<Firestore, 'doc' | 'runTransaction'>;
  return { docs, db, store: new FreeAnswerQuotaStore(db) };
}
async function held(store: FreeAnswerQuotaStore, n = 1, now = at, subject = uid) {
  const r = await store.reserve(subject, id(n), now);
  if (!r.allowed) throw new Error(r.reason);
  return r.reservation;
}

describe('durable shared Free answer quota', () => {
  it('atomically reserves one turn across replica instances and all mode labels', async () => {
    const f = fixture(); const other = new FreeAnswerQuotaStore(f.db);
    const results = await Promise.all([f.store.reserve(uid, id(1), at), other.reserve(uid, id(2), at)]);
    expect(results.filter(r => r.allowed)).toHaveLength(1);
    expect(results.find(r => !r.allowed)).toMatchObject({ reason: 'busy' });
    expect(await other.status(uid, at)).toMatchObject({ used: 0, reserved: 1, remaining: 19, inProgress: true });
  });
  it('counts twenty answers, not twenty for each mode, and rejects the twenty-first', async () => {
    const { store } = fixture();
    for (let n = 1; n <= 20; n++) await store.settle(await held(store, n), 'answered', at + 1);
    expect(await store.reserve(uid, id(21), at + 2)).toMatchObject({ allowed: false, reason: 'daily-limit' });
    expect(await store.status(uid, at + 2)).toMatchObject({ used: 20, reserved: 0, remaining: 0, inProgress: false });
  });
  it('restores a failed provider turn exactly once, not its attempt allowance', async () => {
    const { store } = fixture(); const reservation = await held(store);
    expect(await store.settle(reservation, 'provider-failed', at + 1)).toBe(true);
    expect(await store.settle(reservation, 'provider-failed', at + 2)).toBe(true);
    expect(await store.status(uid, at + 2)).toMatchObject({ used: 0, reserved: 0, remaining: 20 });
    expect(await store.reserve(uid, id(1), at + 3)).toMatchObject({ allowed: false, reason: 'duplicate' });
  });
  it('settles simultaneous duplicate callbacks once and rejects competing outcome changes', async () => {
    const { store } = fixture(); const reservation = await held(store);
    expect(await Promise.all(Array.from({ length: 10 }, () => store.settle(reservation, 'provider-failed', at + 1))))
      .toEqual(Array(10).fill(true));
    expect(await store.settle(reservation, 'answered', at + 2)).toBe(false);
    expect(await store.status(uid, at + 2)).toMatchObject({ used: 0, remaining: 20 });
  });
  it('cannot replay an answered request or change its settled outcome to obtain a refund', async () => {
    const { store } = fixture(); const reservation = await held(store);
    await store.settle(reservation, 'answered', at + 1);
    expect(await store.settle(reservation, 'provider-failed', at + 2)).toBe(false);
    expect(await store.reserve(uid, id(1), at + 2)).toMatchObject({ allowed: false, reason: 'duplicate' });
    expect(await store.status(uid, at + 2)).toMatchObject({ used: 1, remaining: 19 });
  });
  it('keeps uncertain/disconnected or partially answered turns charged', async () => {
    const { store } = fixture();
    await store.settle(await held(store), 'uncertain', at + 1);
    await store.settle(await held(store, 2), 'answered', at + 1);
    expect(await store.status(uid, at + 2)).toMatchObject({ used: 2, remaining: 18 });
  });
  it('expires crashed ownership without refund and fences a late old callback from a new owner', async () => {
    const { store } = fixture(); const old = await held(store);
    const now = at + FREE_ANSWER_LEASE_MS;
    expect(await store.status(uid, now)).toMatchObject({ used: 1, reserved: 0, remaining: 19, inProgress: false });
    const next = await held(store, 2, now);
    expect(await store.renew(old, now)).toBe(false);
    expect(await store.settle(old, 'provider-failed', now)).toBe(false);
    expect(await store.status(uid, now)).toMatchObject({ used: 1, reserved: 1, remaining: 18 });
    expect(await store.settle(next, 'answered', now + 1)).toBe(true);
  });
  it('renews only the live owner and never beyond the request deadline', async () => {
    const { store } = fixture(); const r = await held(store);
    expect(await store.renew({ ...r, owner: 'forged' }, at + 1)).toBe(false);
    for (let t = 20_000; t < 90_000; t += 20_000) expect(await store.renew(r, at + t)).toBe(true);
    expect(await store.renew(r, at + 90_000)).toBe(false);
    expect(await store.settle(r, 'provider-failed', at + 90_000)).toBe(false);
  });
  it('resets at midnight IST without removing a previous-day active lock or cross-day idempotency', async () => {
    const { store } = fixture(); const midnight = Date.parse('2026-10-23T18:30:00Z');
    const r = await held(store, 1, midnight - 1000);
    expect(await store.status(uid, midnight)).toMatchObject({ day: '2026-10-24', used: 0, reserved: 0, remaining: 20, inProgress: true, resetsAt: Date.parse('2026-10-24T18:30:00.000Z') });
    expect(await store.reserve(uid, id(2), midnight)).toMatchObject({ allowed: false, reason: 'busy' });
    await store.settle(r, 'provider-failed', midnight + 1);
    expect(await store.reserve(uid, id(1), midnight + 2)).toMatchObject({ allowed: false, reason: 'duplicate' });
    expect(await store.status(uid, midnight + 2)).toMatchObject({ remaining: 20, inProgress: false });
  });
  it('bounds repeated refunded attempts independently of credits', async () => {
    const { store } = fixture();
    for (let n = 1; n <= 60; n++) await store.settle(await held(store, n), 'provider-failed', at + 1);
    expect(await store.reserve(uid, id(61), at + 2)).toMatchObject({ allowed: false, reason: 'attempt-limit' });
    expect(await store.status(uid, at + 2)).toMatchObject({ used: 0, remaining: 20 });
  });
  it('limits guests to five and preserves IP attempt protection across invented device ids', async () => {
    const { store } = fixture(); const guest = { key: 'guest:one', limit: 5 as const, ipKey: 'ip:shared' };
    for (let n = 1; n <= 5; n++) {
      const r = await store.reserve(guest, id(n), at); if (!r.allowed) throw new Error(r.reason);
      await store.settle(r.reservation, 'answered', at + 1);
    }
    expect(await store.reserve(guest, id(6), at)).toMatchObject({ allowed: false, reason: 'daily-limit' });
    for (let n = 6; n <= 100; n++) {
      const r = await store.reserve({ ...guest, key: `guest:${n}` }, id(n), at);
      if (!r.allowed) throw new Error(r.reason);
      await store.settle(r.reservation, 'provider-failed', at + 1);
    }
    expect(await store.reserve({ ...guest, key: 'guest:new' }, id(101), at)).toMatchObject({ allowed: false, reason: 'attempt-limit' });
  });
  it('fails closed without storage, with malformed counters, and on invalid keys/times', async () => {
    const { store, docs } = fixture();
    await expect(new FreeAnswerQuotaStore(null).reserve(uid, id(1), at)).rejects.toThrow();
    await expect(store.reserve(uid, 'not-a-uuid', at)).rejects.toThrow();
    await expect(store.reserve(uid, id(1), NaN)).rejects.toThrow();
    await held(store);
    const daily = [...docs.keys()].find(k => k.includes('/day_'))!;
    docs.set(daily, { ...docs.get(daily), consumed: -1 });
    await expect(store.status(uid, at)).rejects.toThrow();
    await expect(store.reserve(uid, id(2), at)).rejects.toThrow();
  });
  it('writes only the isolated user-quota collection, never provider spend or holds', async () => {
    const { store, docs } = fixture(); await store.settle(await held(store), 'provider-failed', at + 1);
    expect([...docs.keys()].every(k => k.startsWith('free_answer_quota/'))).toBe(true);
  });
  it('isolates identities, shares a device across addresses, and binds request ids to the identity', async () => {
    const { store } = fixture();
    const first = await store.reserve({ key: 'guest:same-device', limit: 5, ipKey: 'ip:first' }, id(1), at);
    expect(first.allowed).toBe(true);
    expect(await store.reserve({ key: 'guest:same-device', limit: 5, ipKey: 'ip:second' }, id(2), at))
      .toMatchObject({ allowed: false, reason: 'busy' });
    expect(await store.reserve({ key: 'uid:another', limit: 20 }, id(1), at)).toMatchObject({ allowed: true });
  });
  it('refuses a reservation copied with a different principal even if it names a real attempt', async () => {
    const { store } = fixture(); const reservation = await held(store);
    expect(await store.settle({ ...reservation, principalHash: 'f'.repeat(64) }, 'provider-failed', at + 1)).toBe(false);
    expect(await store.status(uid, at + 2)).toMatchObject({ reserved: 1, remaining: 19 });
  });
});


describe('quota retention metadata', () => {
  it('keeps hashed ownership and purge deadlines across renew, settle, and fresh reservations', async () => {
    const f = fixture(); const reservation = await held(f.store);
    const key = `free_answer_quota/principal_${reservation.principalHash}`;
    const original = f.docs.get(key);
    expect(original.principalHash).toBe(reservation.principalHash);
    expect(original.purgeAfterMs).toBeGreaterThan(at + 7 * 86400000);
    expect(original).not.toHaveProperty('expireAt');
    await f.store.renew(reservation, at + 1000);
    await f.store.settle(reservation, 'answered', at + 2000);
    expect(f.docs.get(key)).toMatchObject({ principalHash: reservation.principalHash, purgeAfterMs: original.purgeAfterMs, active: null });
    const second = await held(f.store, 2, at + 86400000);
    expect(second.principalHash).toBe(reservation.principalHash);
    expect(f.docs.get(key).purgeAfterMs).toBe(original.purgeAfterMs + 86400000);
    for (const [path, value] of f.docs) {
      expect(value.purgeAfterMs, path).toBeGreaterThan(at);
      if (!path.includes('/ip_')) expect(value.principalHash, path).toBe(reservation.principalHash);
    }
  });
});
