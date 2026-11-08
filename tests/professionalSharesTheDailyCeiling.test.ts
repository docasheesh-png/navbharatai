import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Firestore } from 'firebase-admin/firestore';
import { FreeAnswerQuotaStore } from '../src/server/lib/freeAnswerQuotaStore';
import { GUEST_DAILY_DEFAULT, SIGNED_IN_DAILY_DEFAULT } from '../src/server/lib/unifiedWallet/policy';

const at = Date.parse('2026-11-08T10:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function store() {
  const docs = new Map<string, unknown>();
  let serial = Promise.resolve();
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: (run: (tx: unknown) => Promise<unknown>) => {
      const result = serial.then(async () => {
        const writes = new Map<string, unknown>();
        const value = await run({
          get: async (ref: { path: string }) => ({ exists: docs.has(ref.path), data: () => structuredClone(docs.get(ref.path)) }),
          set: (ref: { path: string }, next: unknown) => writes.set(ref.path, structuredClone(next)),
        });
        for (const [key, next] of writes) docs.set(key, next);
        return value;
      });
      serial = result.then(() => {}, () => {});
      return result;
    },
  } as unknown as Pick<Firestore, 'doc' | 'runTransaction'>;
  return new FreeAnswerQuotaStore(db);
}

async function answer(quota: FreeAnswerQuotaStore, subject: { key: string; limit: number; guest?: boolean }, n: number) {
  const reserved = await quota.reserve(subject, id(n), at + n);
  expect(reserved.allowed, `answer ${n}`).toBe(true);
  if (!reserved.allowed) return;
  expect(await quota.settle(reserved.reservation, 'answered', at + n)).toBe(true);
}

describe('professionals share the signed-in ceiling and do not keep a 10-a-day badge', () => {
  it('one principal allows 50 answers and denies the 51st, whether the earlier answers were chat or professional', async () => {
    expect(SIGNED_IN_DAILY_DEFAULT).toBe(50);
    const quota = store();
    const person = { key: 'user:same-signed-in-principal', limit: SIGNED_IN_DAILY_DEFAULT };
    for (let n = 1; n <= 40; n++) await answer(quota, person, n); // Free chat
    for (let n = 41; n <= 50; n++) await answer(quota, person, n); // Teacher, Doctor, Lawyer — same key
    expect(await quota.reserve(person, id(51), at + 51)).toMatchObject({ allowed: false, reason: 'daily-limit' });
    expect(await quota.status(person, at + 51)).toMatchObject({ used: 50, remaining: 0 });
  });

  it('one in-flight answer blocks a second for the same owner, and a provider failure refunds that one credit', async () => {
    const quota = store();
    const person = { key: 'user:owner-a', limit: SIGNED_IN_DAILY_DEFAULT };
    const other = { key: 'user:owner-b', limit: SIGNED_IN_DAILY_DEFAULT };
    const [first, second, outsider] = await Promise.all([
      quota.reserve(person, id(1), at),
      quota.reserve(person, id(2), at),
      quota.reserve(other, id(3), at),
    ]);
    const allowed = [first, second].filter(result => result.allowed);
    expect(allowed).toHaveLength(1);
    expect([first, second].find(result => !result.allowed)).toMatchObject({ reason: 'busy' });
    expect(outsider.allowed).toBe(true);
    if (!allowed[0].allowed || !outsider.allowed) return;
    expect(await quota.settle(allowed[0].reservation, 'provider-failed', at + 1)).toBe(true);
    expect(await quota.settle(allowed[0].reservation, 'provider-failed', at + 2)).toBe(true);
    expect(await quota.status(person, at + 2)).toMatchObject({ used: 0, remaining: 50, inProgress: false });
    const retry = await quota.reserve(person, id(4), at + 3);
    expect(retry.allowed).toBe(true);
    if (!retry.allowed) return;
    expect(await quota.settle(retry.reservation, 'answered', at + 4)).toBe(true);
    expect(await quota.settle(retry.reservation, 'provider-failed', at + 5)).toBe(false);
    expect(await quota.status(person, at + 5)).toMatchObject({ used: 1, remaining: 49 });
    expect(await quota.settle(outsider.reservation, 'answered', at + 4)).toBe(true);
    expect(await quota.status(other, at + 5)).toMatchObject({ used: 1, remaining: 49 });
  });

  it('the 50th held answer leaves no second credit, and a refund of that hold allows exactly one more', async () => {
    const quota = store();
    const person = { key: 'user:boundary', limit: SIGNED_IN_DAILY_DEFAULT };
    for (let n = 1; n <= 49; n++) await answer(quota, person, n);
    const fiftieth = await quota.reserve(person, id(50), at + 50);
    expect(fiftieth.allowed).toBe(true);
    if (!fiftieth.allowed) return;
    expect(await quota.reserve(person, id(51), at + 50)).toMatchObject({ allowed: false, reason: 'busy' });
    expect(await quota.settle(fiftieth.reservation, 'provider-failed', at + 51)).toBe(true);
    const replacement = await quota.reserve(person, id(52), at + 52);
    expect(replacement.allowed).toBe(true);
    if (!replacement.allowed) return;
    expect(await quota.settle(replacement.reservation, 'answered', at + 53)).toBe(true);
    expect(await quota.reserve(person, id(53), at + 54)).toMatchObject({ allowed: false, reason: 'daily-limit' });
    expect(await quota.status(person, at + 54)).toMatchObject({ used: 50, remaining: 0 });
  });

  it('a guest public chat is still denied on the 11th', async () => {
    expect(GUEST_DAILY_DEFAULT).toBe(10);
    const quota = store();
    const guest = { key: 'guest-device:public-chat', limit: GUEST_DAILY_DEFAULT, guest: true };
    for (let n = 1; n <= 10; n++) await answer(quota, guest, n);
    expect(await quota.reserve(guest, id(11), at + 11)).toMatchObject({ allowed: false, reason: 'daily-limit' });
  });

  it('chat, professionals and Doctor AI reserve the same user key, and the 10-a-day badge is gone', () => {
    const quota = readFileSync('src/server/lib/freeAnswerQuota.ts', 'utf8');
    const chat = readFileSync('src/server/routes/chat.ts', 'utf8');
    const professionals = readFileSync('src/server/routes/professionals.ts', 'utf8');
    const doctor = readFileSync('src/server/routes/sda.ts', 'utf8');
    const screen = readFileSync('src/components/professionals/ProfessionalChat.tsx', 'utf8');
    expect(quota).toContain('key: `user:${uid}`');
    expect(chat).toContain("surface: 'chat'");
    expect(professionals).toContain("surface: 'professionals'");
    expect(professionals).not.toContain('professionalUsageStore.increment');
    expect(doctor).toContain("surface: 'professionals'");
    expect(doctor).toContain('withFreeAnswerQuota');
    expect(doctor).not.toContain('burnFreeMessage');
    expect(screen).not.toContain('free today');
    expect(screen).not.toContain('freeDailyLimit');
  });
});
