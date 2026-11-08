import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceTokenStore, activePushRows, activePushTokens, type DeviceToken } from '../src/server/lib/DeviceTokenStore';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
const h = vi.hoisted(() => ({ verified: vi.fn(), save: vi.fn(), send: vi.fn(), live: vi.fn() }));
vi.mock('../src/server/lib/authMiddleware', async original => ({ ...await original<typeof import('../src/server/lib/authMiddleware')>(), verifyFirebaseSession: h.verified }));
vi.mock('firebase-admin', () => ({ apps: [{}], firestore: { FieldValue: { serverTimestamp: () => 1 } }, messaging: () => ({ sendEachForMulticast: h.send }) }));
vi.mock('../src/server/lib/DeviceTokenStore', async original => ({ ...await original<typeof import('../src/server/lib/DeviceTokenStore')>(), deviceTokenStore: { saveToken: h.save, listTokensForUser: h.live, removeTokens: async () => {} } }));
import { registerPushRoutes } from '../src/server/routes/push';
import { notifyBuildComplete, notifyLowBalance } from '../src/server/lib/PushNotificationService';
const token = (name: string, epoch?: number): DeviceToken => ({ token: name, platform: 'android', createdAt: 1, lastSeenAt: 1, ...(epoch ? { sessionAuthTime: epoch } : {}) });
function fixture() {
  const records = new Map<string, any>();
  let cutoff = 0;
  let fault = false;
  let chain = Promise.resolve();
  const ref = (id: string) => ({ id, delete: async () => { records.delete(id); } });
  const col = { doc: ref, get: async () => ({ forEach: (fn: (s: any) => void) => { for (const value of records.values()) fn({ data: () => value }); } }), orderBy: () => ({ get: async () => ({ size: records.size, docs: [] }) }) };
  const db = { collection: () => ({ doc: () => ({ collection: () => col }) }), runTransaction: (fn: (tx: any) => Promise<unknown>) => {
    const op = chain.then(() => fn({ get: async (r: any) => ({ data: () => records.get(r.id) }), set: (r: any, value: any, options?: { merge?: boolean }) => records.set(r.id, options?.merge ? { ...records.get(r.id), ...value } : value) }));
    chain = op.then(() => {}, () => {}); return op;
  } };
  const store = new DeviceTokenStore({ db: () => db as never, cutoff: async () => { if (fault) throw new Error('offline'); return cutoff; } });
  return { records, store, revoke: (n: number) => { cutoff = n; }, unavailable: () => { fault = true; } };
}
beforeEach(() => { vi.clearAllMocks(); h.send.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [{ success: true }] }); });
afterEach(() => vi.unstubAllEnvs());
describe('logout revokes account notification delivery without deleting fresh registrations', () => {
  it('filters old/legacy rows after revocation and preserves untouched accounts', () => {
    const rows = [token('legacy'), token('old', 1000), token('new', 1001)];
    expect(activePushTokens(rows, 0)).toHaveLength(3);
    expect(activePushTokens(rows, 1001).map(x => x.token)).toEqual(['new']);
    expect(activePushTokens(rows, NaN)).toEqual([]);
  });
  it('actual registry filters old devices and accepts a new verified login, even with a late old registration', async () => {
    const f = fixture(); f.records.set('legacy', token('legacy'));
    expect(await f.store.saveToken('alice', 'phone', 'android', undefined, 1000)).toBe(true);
    expect(await f.store.listTokensForUser('alice')).toHaveLength(2);
    f.revoke(1001); expect(await f.store.listTokensForUser('alice')).toEqual([]);
    expect(await f.store.saveToken('alice', 'phone', 'android', undefined, 1002)).toBe(true);
    expect(await f.store.saveToken('alice', 'phone', 'android', undefined, 1000)).toBe(true);
    expect((await f.store.listTokensForUser('alice')).map(x => x.token)).toEqual(['phone']);
    expect(f.records.get('phone').sessionAuthTime).toBe(1002);
    f.unavailable(); expect(await f.store.listTokensForUser('alice')).toEqual([]);
  });
  it('actual registry preserves a known app version when an older client omits its version', async () => {
    const f = fixture();
    expect(await f.store.saveToken('alice', 'phone', 'android', 321, 1002)).toBe(true);
    for (const unknownVersion of [undefined, null]) {
      expect(await f.store.saveToken('alice', 'phone', 'android', unknownVersion, 1000)).toBe(true);
      expect(f.records.get('phone').appVersionCode).toBe(321);
      expect(f.records.get('phone').sessionAuthTime).toBe(1002);
    }
  });
  it('wallet/build notification functions never call messaging for revoked devices; fresh registration restores delivery', async () => {
    vi.stubEnv('VITEST', ''); vi.stubEnv('NODE_ENV', 'development');
    const f = fixture(); f.records.set('old-phone', token('old-phone', 1000)); f.revoke(1001);
    h.live.mockImplementation(() => f.store.listTokensForUser('alice'));
    await notifyBuildComplete('alice', true, 'Synthetic app'); await notifyLowBalance('alice', true);
    expect(h.send).not.toHaveBeenCalled();
    await f.store.saveToken('alice', 'new-phone', 'android', undefined, 1002);
    await notifyBuildComplete('alice', true, 'Synthetic app'); await notifyLowBalance('alice', true);
    expect(h.send).toHaveBeenCalledTimes(2);
    for (const [payload] of h.send.mock.calls) expect(payload.tokens).toEqual(['new-phone']);
  });
  it('registration binds original verified epoch, never a body timestamp or foreign UID', async () => {
    h.save.mockResolvedValue(true); h.verified.mockResolvedValue({ token: { uid: 'alice', auth_time: 2000, session_auth_time: 1002 }, reason: 'ok' });
    const post = captureRoutes(registerPushRoutes).get('POST /api/push/:userId/register-token')!;
    const res = mockRes(); await post(mockReq({ params: { userId: 'alice' }, body: { token: 'phone', platform: 'android', sessionAuthTime: 999999 } }), res);
    expect(res.statusCode).toBe(200); expect(h.save).toHaveBeenCalledWith('alice', 'phone', 'android', undefined, 1002);
    h.save.mockClear(); const foreign = mockRes(); await post(mockReq({ params: { userId: 'bob' }, body: { token: 'phone' } }), foreign);
    expect(foreign.statusCode).toBe(401); expect(h.save).not.toHaveBeenCalled();
  });
  it('a legacy custom credential redeemed during mirror delay cannot keep wallet/build pushes after revocation', async () => {
    vi.stubEnv('VITEST', ''); vi.stubEnv('NODE_ENV', 'development');
    const f = fixture();
    h.save.mockImplementation((...args: Parameters<DeviceTokenStore['saveToken']>) => f.store.saveToken(...args));
    h.live.mockImplementation(() => f.store.listTokensForUser('alice'));
    const post = captureRoutes(registerPushRoutes).get('POST /api/push/:userId/register-token')!;
    const register = async () => {
      const res = mockRes();
      await post(mockReq({ params: { userId: 'alice' }, body: { token: 'phone', platform: 'android' } }), res);
      expect(res.statusCode).toBe(200);
    };
    // Provider cutoff is 1500, but the durable mirror is still 0. A pre-deploy custom
    // credential has no signed original epoch; its later redemption gets auth_time 2000.
    h.verified.mockResolvedValue({ token: { uid: 'alice', auth_time: 2000, firebase: { sign_in_provider: 'custom' } }, reason: 'ok' });
    await register();
    expect(await f.store.listTokensForUser('alice')).toHaveLength(1); // unchanged cutoff-0 compatibility
    f.revoke(1500);
    await notifyBuildComplete('alice', true, 'Synthetic app'); await notifyLowBalance('alice', true);
    expect(h.send).not.toHaveBeenCalled();
    expect(f.records.get('phone').sessionAuthTime).toBe(0); // unknown origin must never become redemption time

    // A genuinely new, origin-stamped phone login can register. An already-authorized
    // older registration completing late cannot roll its epoch back.
    h.verified.mockResolvedValue({ token: { uid: 'alice', auth_time: 2001, session_auth_time: 2001, firebase: { sign_in_provider: 'custom' } }, reason: 'ok' });
    await register();
    h.verified.mockResolvedValue({ token: { uid: 'alice', auth_time: 2000, firebase: { sign_in_provider: 'custom' } }, reason: 'ok' });
    await register();
    expect(f.records.get('phone').sessionAuthTime).toBe(2001);
    await notifyLowBalance('alice', true);
    expect(h.send).toHaveBeenCalledTimes(1);

    // Unregistering removes that valid epoch. A late legacy request may not resurrect
    // notification eligibility by reusing the removed registration's previous epoch.
    await f.store.removeToken('alice', 'phone');
    await register();
    expect(f.records.get('phone').sessionAuthTime).toBe(0);
    h.send.mockClear();
    await notifyBuildComplete('alice', true, 'Synthetic app'); await notifyLowBalance('alice', true);
    expect(h.send).not.toHaveBeenCalled();
  });
  it('broadcast cohort uses the same eligibility, one fresh read per UID and bounded concurrency', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ ...token(`phone-${i}`, i < 10 ? 1 : 1002), uid: `u${i % 10}` }));
    let active = 0, maximum = 0;
    const read = vi.fn(async (uid: string) => { active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; if (uid === 'u0') throw new Error('offline'); return 1001; });
    const eligible = await activePushRows(rows, read);
    expect(read).toHaveBeenCalledTimes(10); expect(maximum).toBeLessThanOrEqual(8);
    expect(eligible).toHaveLength(18); expect(eligible.every(x => x.uid !== 'u0' && x.sessionAuthTime === 1002)).toBe(true);
  });
});
