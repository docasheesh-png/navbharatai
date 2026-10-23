/** Real route + Firebase verifier. Only the external Admin SDK verifier and inference boundary are mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from '../../../../tests/helpers/routeTestUtils';
const m = vi.hoisted(() => ({ verify: vi.fn(), detailed: vi.fn(), legacy: vi.fn() }));
vi.mock('../../lib/firebaseAdminModule', () => ({ loadFirebaseAdmin: async () => ({ apps: [{}], auth: () => ({ verifyIdToken: m.verify }) }) }));
vi.mock('../../lib/aiRouter', () => ({ aiRouter: { routeDetailed: m.detailed } }));
vi.mock('../FreeChain/entryAdmission', () => ({ withFreeChainEntryAdmission: (_req: unknown, _res: unknown, fn: () => unknown) => { m.legacy(); return fn(); } }));
vi.mock('../FreeChain/requestContext', () => ({ freeChainRequestContext: async () => undefined }));
vi.mock('../../lib/liveSearchContext', () => ({ liveSearchContext: async () => '', needsLiveSearch: () => false }));
vi.mock('../../lib/serverDb', async original => ({ ...await original<typeof import('../../lib/serverDb')>(), getServerDb: () => null, collection: () => ({}), addDoc: async () => {} }));
import { registerChatRoutes } from '../../routes/chat';
import { currentInferenceGatewayContext } from './runtime';
const route = () => captureRoutes(registerChatRoutes as any, () => {}).get('POST /api/chat/navbharat')!;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('VITEST', ''); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on');
  vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE', 'canary'); vi.stubEnv('INFERENCE_GATEWAY_CANARY_UIDS', 'actual-owner');
  vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'chat'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off'); vi.stubEnv('DOSE_DIRECT_ANSWER', 'off');
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('owner canary trusts the actual Firebase verification boundary', () => {
  it.each(['owner', 'other', 'invalid', 'missing'])('%s bearer cannot borrow a body/header identity', async kind => {
    m.verify.mockImplementation(async () => { if (kind === 'invalid') throw new Error('invalid synthetic token'); return { uid: kind === 'owner' ? 'actual-owner' : 'different-user' }; });
    let principal: string | undefined;
    m.detailed.mockImplementationOnce(async () => { principal = currentInferenceGatewayContext()?.principalId; return { ok: true, content: 'answer' }; });
    const res = mockRes(); await route()(mockReq({ headers: { ...(kind === 'missing' ? {} : { authorization: `Bearer synthetic-${kind}` }), 'x-user-id': 'actual-owner', 'x-nb-guest': 'actual-owner' }, body: { message: 'Hello', uid: 'actual-owner', userId: 'actual-owner' } }), res);
    expect(res.body).toEqual({ reply: 'answer' });
    expect(principal).toBe(kind === 'owner' ? 'actual-owner' : undefined);
    expect(m.legacy).toHaveBeenCalledTimes(kind === 'owner' ? 0 : 1);
    expect(m.verify).toHaveBeenCalledTimes(kind === 'missing' ? 0 : 1);
  });
});
