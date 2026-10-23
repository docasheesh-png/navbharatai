import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { mockReq, mockRes } from '../../../tests/helpers/routeTestUtils';
import { setServerDb } from './serverDb';
import { guestDailyQuota, takeGuestInferenceAdmission, isGuestInferenceAdmission, wasGatewayGuestSelected, indiaDay,
  type GuestUsageStore } from './guestDailyQuota';

const NOW = Date.parse('2026-10-23T10:00:00Z');
const DEVICE = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const ENABLED = { INFERENCE_GATEWAY_ENABLED: 'on', INFERENCE_GATEWAY_ROLLOUT_MODE: 'all', INFERENCE_GATEWAY_SURFACES: 'chat' };
/** Two application instances share this transactional database, never a process-local counter. */
function database() {
  const docs = new Map<string, any>(); const reads: string[] = []; const writes: string[] = [];
  let serial = Promise.resolve();
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      const run = serial.then(async () => {
        const pending = new Map<string, any>();
        const result = await fn({
          get: async ({ path }: { path: string }) => {
            if (pending.size) throw new Error('Read after write');
            reads.push(path);
            return { exists: docs.has(path), data: () => structuredClone(docs.get(path)) };
          },
          set: ({ path }: { path: string }, value: unknown, options?: { merge?: boolean }) => {
            writes.push(path);
            pending.set(path, options?.merge ? { ...(pending.get(path) ?? docs.get(path)), ...value as any } : value);
          },
        });
        for (const [path, value] of pending) docs.set(path, structuredClone(value));
        return result;
      });
      serial = run.then(() => {}, () => {});
      return run;
    },
  };
  setServerDb(db as never);
  return { db, docs, reads, writes };
}
const req = (id = DEVICE, ip = '203.0.113.9') => mockReq({ headers: { 'x-nb-guest': id, 'x-forwarded-for': ip },
  body: { message: 'hello', uid: 'victim', userId: 'victim', tenantId: 'victim' } }) as Request;
const middleware = (overrides: Parameters<typeof guestDailyQuota>[1] = {}) => guestDailyQuota('chat', {
  identify: async () => null, env: ENABLED, ...overrides,
});
async function send(mw = middleware(), request = req()) {
  const res = mockRes(); const next = vi.fn();
  await mw(request, res as unknown as Response, next);
  return { request, res, next };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { setServerDb(null); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('server-only Free guest admission provenance', () => {
  it('raw guest header, body UID, copied receipt and foreign request are never proofs', async () => {
    database(); const original = req();
    expect(takeGuestInferenceAdmission(original)).toBeNull();
    const { res } = await send(middleware(), original);
    expect(takeGuestInferenceAdmission(req())).toBeNull();
    const receipt = takeGuestInferenceAdmission(original)!;
    expect(receipt).toMatchObject({ kind: 'public-free-guest', principalId: expect.stringMatching(/^nb-free-guest:/), day: indiaDay(NOW) });
    expect(receipt.principalId).not.toContain(DEVICE); expect(receipt.principalId).not.toContain('victim');
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(isGuestInferenceAdmission({ ...receipt })).toBe(false);
    expect(isGuestInferenceAdmission(receipt)).toBe(true);
    expect(takeGuestInferenceAdmission(original)).toBeNull();
    expect(res.body).toBeUndefined(); expect(res.headers['set-cookie']).toBeUndefined();
    expect(Object.values(res.headers).join(' ')).not.toContain(receipt.principalId);
  });
  it.each(['finish', 'close'])('revokes a claimed receipt on response %s', async event => {
    database(); const { request, res } = await send(); const receipt = takeGuestInferenceAdmission(request);
    res.emit(event); expect(isGuestInferenceAdmission(receipt)).toBe(false);
  });
  it('expires after two minutes even if the response remains open', async () => {
    database(); const { request } = await send(); const receipt = takeGuestInferenceAdmission(request)!;
    vi.setSystemTime(NOW + 119_999); expect(isGuestInferenceAdmission(receipt)).toBe(true);
    vi.setSystemTime(NOW + 120_000); expect(isGuestInferenceAdmission(receipt)).toBe(false);
  });
  it('revokes at India midnight and next-day admission gets a fresh unlinkable principal', async () => {
    database(); vi.setSystemTime(Date.parse('2026-10-23T18:29:59Z'));
    const old = takeGuestInferenceAdmission((await send()).request)!;
    expect(old.expiresAtMs).toBe(Date.parse('2026-10-23T18:30:00Z'));
    vi.setSystemTime(old.expiresAtMs); expect(isGuestInferenceAdmission(old)).toBe(false);
    const fresh = takeGuestInferenceAdmission((await send()).request)!;
    expect(fresh.day).toBe('2026-10-24'); expect(fresh.principalId).not.toBe(old.principalId);
  });
  it('one hundred invented device identities remain under the existing address cap', async () => {
    const state = database(); let admitted = 0;
    for (let i = 0; i < 110; i++) {
      const result = await send(middleware(), req(`device-${String(i).padStart(16, '0')}`));
      if (result.next.mock.calls.length) admitted++;
      else expect(result.res.statusCode).toBe(403);
    }
    expect(admitted).toBe(100); expect(state.docs.size).toBe(101);
  });
  it('forged forwarding prefixes cannot rotate the address backstop', async () => {
    database(); const mw = middleware({ env: { ...ENABLED, GUEST_DAILY_IP_CAP: '10' } });
    for (let i = 0; i < 11; i++) {
      const result = await send(mw, req(`device-${String(i).padStart(16, '0')}`, `192.0.2.${i}, 203.0.113.9`));
      expect(result.next.mock.calls.length).toBe(i < 10 ? 1 : 0);
    }
  });
  it('IPv6 addresses in the same /56 cannot rotate the address backstop', async () => {
    database(); const mw = middleware({ env: { ...ENABLED, GUEST_DAILY_IP_CAP: '10' } });
    for (let i = 0; i < 11; i++) {
      const result = await send(mw, req(`device-${String(i).padStart(16, '0')}`, `2001:db8:abcd:1200::${i + 1}`));
      expect(result.next.mock.calls.length).toBe(i < 10 ? 1 : 0);
    }
  });
  it('ten messages across concurrent instances share one atomic device budget and principal', async () => {
    database(); const a = middleware(); const b = middleware();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => send(i % 2 ? a : b)));
    const allowed = results.filter(result => result.next.mock.calls.length);
    expect(allowed).toHaveLength(10);
    const receipts = allowed.map(result => takeGuestInferenceAdmission(result.request)!);
    expect(new Set(receipts.map(receipt => receipt.principalId)).size).toBe(1);
    expect(results.filter(result => result.res.statusCode === 403)).toHaveLength(20);
  });
  it('other guest surfaces still consume the same existing ten-message budget', async () => {
    database(); const other = guestDailyQuota('repo-analyst', { identify: async () => null, env: ENABLED });
    for (let i = 0; i < 9; i++) {
      const result = await send(other); expect(result.next).toHaveBeenCalledOnce();
      expect(takeGuestInferenceAdmission(result.request)).toBeNull();
    }
    expect((await send()).next).toHaveBeenCalledOnce(); expect((await send()).res.statusCode).toBe(403);
  });
  it('different devices behind one carrier retain their own ten-message allowances', async () => {
    database(); for (let i = 0; i < 10; i++) await send();
    expect((await send()).res.statusCode).toBe(403);
    expect((await send(middleware(), req('another-device-id-0001'))).next).toHaveBeenCalledOnce();
  });
  it('id-less older clients retain only the shared address backstop, not unbounded session rows', async () => {
    const state = database(); const mw = middleware({ env: { ...ENABLED, GUEST_DAILY_IP_CAP: '10' } });
    for (let i = 0; i < 10; i++) expect((await send(mw, req('invalid'))).next).toHaveBeenCalledOnce();
    expect((await send(mw, req(''))).res.statusCode).toBe(403); expect(state.docs.size).toBe(1);
  });
  it('does not promote the guest into an account or read any private-user stores', async () => {
    const state = database(); const result = await send(); const receipt = takeGuestInferenceAdmission(result.request)!;
    expect(receipt).not.toHaveProperty('uid');
    expect(state.reads.length).toBe(2);
    expect(state.reads.every(path => path.startsWith('guest_daily_usage/'))).toBe(true);
    expect(JSON.stringify([...state.docs])).not.toContain('victim');
    expect(JSON.stringify([...state.docs])).not.toContain(DEVICE);
  });
  it('signed-in accounts bypass guest counters without receiving a guest receipt', async () => {
    const state = database(); const result = await send(middleware({ identify: async () => ({ uid: 'account' }) }));
    expect(result.next).toHaveBeenCalledOnce(); expect(state.reads).toHaveLength(0);
    expect(takeGuestInferenceAdmission(result.request)).toBeNull();
  });
});

describe('durable admission failures cannot become legacy dispatch authority', () => {
  it('selected path fails closed with no storage, while flag-OFF remains fail open', async () => {
    setServerDb(null); const selected = await send();
    expect(selected.res.statusCode).toBe(503); expect(selected.next).not.toHaveBeenCalled();
    expect(takeGuestInferenceAdmission(selected.request)).toBeNull();
    expect(wasGatewayGuestSelected(selected.request)).toBe(true);
    const off = await send(middleware({ env: { INFERENCE_GATEWAY_ENABLED: 'off' } }));
    expect(off.next).toHaveBeenCalledOnce(); expect(takeGuestInferenceAdmission(off.request)).toBeNull();
    expect(wasGatewayGuestSelected(off.request)).toBe(false);
  });
  it.each(['rejected', 'missing-proof', 'forged-principal'])('rejects %s durable consumption', async mode => {
    const store: GuestUsageStore = { consume: async () => {
      if (mode === 'rejected') throw new Error('storage down');
      return { allow: true, remaining: 9, ...(mode === 'forged-principal' ? { durablePrincipalId: 'victim' } : {}) };
    } };
    const result = await send(middleware({ store }));
    expect(result.res.statusCode).toBe(503); expect(result.next).not.toHaveBeenCalled();
    expect(takeGuestInferenceAdmission(result.request)).toBeNull();
  });
  it('bounds a hung transaction and cannot issue a receipt when it later completes', async () => {
    let finish!: (value: any) => void;
    const store: GuestUsageStore = { consume: () => new Promise(resolve => { finish = resolve; }) };
    const pending = send(middleware({ store }));
    await vi.advanceTimersByTimeAsync(5000); const result = await pending;
    expect(result.res.statusCode).toBe(503); expect(result.next).not.toHaveBeenCalled();
    finish({ allow: true, remaining: 9, durablePrincipalId: 'nb-free-guest:11111111-1111-4111-8111-111111111111' });
    await Promise.resolve(); expect(takeGuestInferenceAdmission(result.request)).toBeNull();
    expect(result.next).not.toHaveBeenCalled();
  });
  it('cannot issue a receipt after the client disconnects during quota consumption', async () => {
    let finish!: (value: any) => void;
    const store: GuestUsageStore = { consume: () => new Promise(resolve => { finish = resolve; }) };
    const request = req(); const res = mockRes(); const next = vi.fn();
    const pending = middleware({ store })(request, res as never, next); await Promise.resolve();
    res.end(); finish({ allow: true, remaining: 9, durablePrincipalId: 'nb-free-guest:11111111-1111-4111-8111-111111111111' });
    await pending; expect(next).not.toHaveBeenCalled(); expect(takeGuestInferenceAdmission(request)).toBeNull();
  });
  it('selected path cannot use the old unlimited flag to avoid the ten-message budget', async () => {
    database(); const mw = middleware({ env: { ...ENABLED, GUEST_DAILY_MESSAGES: 'off' } });
    for (let i = 0; i < 10; i++) expect((await send(mw)).next).toHaveBeenCalledOnce();
    expect((await send(mw)).res.statusCode).toBe(403);
  });
  it('does not change OFF unlimited behavior or unselected surfaces', async () => {
    const consume = vi.fn(); const store = { consume };
    const result = await send(middleware({ store, env: { GUEST_DAILY_MESSAGES: 'off' } }));
    expect(result.next).toHaveBeenCalledOnce(); expect(consume).not.toHaveBeenCalled();
    const unselected = await send(middleware({ env: { ...ENABLED, INFERENCE_GATEWAY_SURFACES: 'professional' } }));
    expect(unselected.next).toHaveBeenCalledOnce(); expect(takeGuestInferenceAdmission(unselected.request)).toBeNull();
  });
  it.each([false, '', null, undefined, '0', -1, 0.5, NaN, Infinity])('fails closed on raw malformed durable count %s without writes', async count => {
    const state = database(); await send();
    const [path, value] = [...state.docs].find(([key]) => key.includes('_dev_'))!;
    state.docs.set(path, { ...value, count }); state.writes.length = 0;
    const result = await send(); expect(result.res.statusCode).toBe(503);
    expect(state.docs.get(path).count).toBe(count); expect(result.next).not.toHaveBeenCalled();
    expect(state.writes).toHaveLength(0);
  });
  it.each([false, '', null, undefined, 'victim', DEVICE])('does not replace a present malformed server principal %s', async guestPrincipalId => {
    const state = database(); await send();
    const [path, value] = [...state.docs].find(([key]) => key.includes('_dev_'))!;
    state.docs.set(path, { ...value, guestPrincipalId }); state.writes.length = 0;
    const result = await send(); expect(result.res.statusCode).toBe(503);
    expect(state.docs.get(path).guestPrincipalId).toBe(guestPrincipalId);
    expect(result.next).not.toHaveBeenCalled(); expect(state.writes).toHaveLength(0);
  });
});

it.each(['canary', 'invalid', undefined])('does not mint Gateway guest identity in %s rollout and preserves legacy quota semantics', async mode => {
  const consume = vi.fn(async () => ({ allow: true as const, remaining: 9 }));
  const { request, next } = await send(middleware({ env: { ...ENABLED, INFERENCE_GATEWAY_ROLLOUT_MODE: mode, INFERENCE_GATEWAY_CANARY_UIDS: 'victim' }, store: { consume } }));
  expect(next).toHaveBeenCalledOnce(); expect(consume.mock.calls[0]?.[4]).toBeUndefined();
  expect(wasGatewayGuestSelected(request)).toBe(false); expect(takeGuestInferenceAdmission(request)).toBeNull();
});
