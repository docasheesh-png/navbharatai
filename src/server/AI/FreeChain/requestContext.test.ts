import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const { verify, identity } = vi.hoisted(() => ({ verify: vi.fn(), identity: vi.fn() }));
vi.mock('../../lib/authMiddleware', () => ({ verifyFirebaseToken: verify, verifyFirebaseIdentity: identity }));
vi.mock('../../lib/adminEmails', () => ({
  isAdminEmail: (email: string | null | undefined) => {
    const e = String(email ?? '').trim().toLowerCase();
    return e === 'doc.asheesh@icloud.com' || e === 'aashishcpmt09@gmail.com';
  },
  adminEmailList: () => ['aashishcpmt09@gmail.com', 'doc.asheesh@icloud.com'],
}));
vi.mock('../../AgentV3/featureFlag', async (original) => {
  const actual = await original<typeof import('../../AgentV3/featureFlag')>();
  return {
    ...actual,
    identityGrantEmail: (id: { email?: string | null; emailVerified?: boolean } | null | undefined) => {
      if (!id?.email || id.emailVerified === false) return null;
      return id.email.toLowerCase() as any;
    },
  };
});
import { freeChainRequestContext } from './requestContext';
import type { Request } from 'express';
const request = (body: unknown = {}) => ({ body }) as Request;
const data = () => ({ tier: 'navbharat', message: 'hello', history: [], attachments: 0, hasProfile: false, hasMemory: false, grounded: false });
beforeEach(() => {
  verify.mockReset(); identity.mockReset();
  verify.mockResolvedValue('verified-owner');
  identity.mockResolvedValue({ uid: 'verified-owner', email: 'user@example.com', emailVerified: true });
  vi.stubEnv('FREE_CHAIN_ENABLED', 'on');
  vi.stubEnv('CHEAPERINFERENCE', 'off');
});
afterEach(() => vi.unstubAllEnvs());
it('flag OFF is inert, does not reauthenticate or trust body identity', async () => {
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off');
  expect(await freeChainRequestContext(request({ uid: 'fake' }), data())).toBeUndefined();
  expect(verify).not.toHaveBeenCalled();
  expect(identity).not.toHaveBeenCalled();
});
it.each(['free', 'pro', 'doctor', 'professional', 'sda'])('excludes %s before authentication', async tier => {
  expect(await freeChainRequestContext(request(), { ...data(), tier })).toBeUndefined();
  expect(verify).not.toHaveBeenCalled();
});
it('excludes attachments and anonymous requests', async () => {
  expect(await freeChainRequestContext(request(), { ...data(), attachments: 1 })).toBeUndefined();
  verify.mockResolvedValue(null); identity.mockResolvedValue(null);
  expect(await freeChainRequestContext(request({ uid: 'attacker' }), data())).toBeUndefined();
});
it('never uses body uid and hashes conversation identity', async () => {
  const result = await freeChainRequestContext(request({ uid: 'attacker', conversationId: 'private conversation' }), data());
  expect(result?.uid).toBe('verified-owner');
  expect(result?.conversationKey).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toContain('private conversation');
});
it.each([{ hasProfile: true }, { hasMemory: true }])('profile and memory exclude public cache', async flags => {
  const result = await freeChainRequestContext(request(), { ...data(), ...flags });
  expect(result?.privateTurn).toBe(true);
  expect(result?.cacheEligible).toBe(false);
});
it.each(['What dose of medicine should I take?', 'मुझे दवा चाहिए'])('marks health turns private to restricted rungs', async message => {
  const result = await freeChainRequestContext(request(), { ...data(), message });
  expect(result?.healthTurn).toBe(true);
  expect(result?.cacheEligible).toBe(false);
});
it('grounding excludes cache; explicit private excludes it too', async () => {
  expect((await freeChainRequestContext(request(), { ...data(), grounded: true }))?.cacheEligible).toBe(false);
  expect((await freeChainRequestContext(request({ private: true }), data()))?.privateTurn).toBe(true);
});
it('authentication failure stays on old path without pretending authenticated', async () => {
  verify.mockRejectedValue(new Error('unavailable'));
  identity.mockRejectedValue(new Error('unavailable'));
  expect(await freeChainRequestContext(request(), data())).toBeUndefined();
});
it('CHEAPERINFERENCE=admin + verified admin still builds context when FreeChain OFF and key missing', async () => {
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off');
  vi.stubEnv('CHEAPERINFERENCE', 'admin');
  vi.stubEnv('CHEAPERINFERENCE_API_KEY', '');
  identity.mockResolvedValue({ uid: 'admin-uid', email: 'doc.asheesh@icloud.com', emailVerified: true });
  const result = await freeChainRequestContext(request(), data());
  expect(result?.uid).toBe('admin-uid');
  expect(result?.isAdmin).toBe(true);
});
it('CHEAPERINFERENCE=admin does not admit non-admin when FreeChain OFF', async () => {
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off');
  vi.stubEnv('CHEAPERINFERENCE', 'admin');
  vi.stubEnv('CHEAPERINFERENCE_API_KEY', 'ci_live_test_key');
  identity.mockResolvedValue({ uid: 'user-uid', email: 'user@example.com', emailVerified: true });
  expect(await freeChainRequestContext(request(), data())).toBeUndefined();
});
