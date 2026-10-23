import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockReq, mockRes } from '../../../../tests/helpers/routeTestUtils';
const m = vi.hoisted(() => ({ verify: vi.fn(), identity: vi.fn(), detailed: vi.fn(), stream: vi.fn(), legacy: vi.fn(), add: vi.fn(), oldContext: vi.fn() }));
vi.mock('../../lib/authMiddleware', async original => ({ ...await original<typeof import('../../lib/authMiddleware')>(), verifyFirebaseToken: m.verify, verifyFirebaseIdentity: m.identity }));
vi.mock('../FreeChain/entryAdmission', () => ({ withFreeChainEntryAdmission: (_req: unknown, _res: unknown, run: () => unknown) => { m.legacy(); return run(); } }));
vi.mock('../FreeChain/requestContext', () => ({ freeChainRequestContext: m.oldContext }));
vi.mock('../../lib/aiRouter', () => ({ aiRouter: { routeDetailed: m.detailed, routeStream: m.stream } }));
vi.mock('../../lib/liveSearchContext', () => ({ liveSearchContext: async () => '', needsLiveSearch: () => false }));
vi.mock('../../lib/serverDb', async original => ({ ...await original<typeof import('../../lib/serverDb')>(), collection: () => ({}), addDoc: m.add }));
import { registerChatRoutes } from '../../routes/chat';
import { setServerDb } from '../../lib/serverDb';
import { currentInferenceGatewayContext } from './runtime';
import { wasGatewayGuestSelected, takeGuestInferenceAdmission } from '../../lib/guestDailyQuota';

/** The real registered Free scope + quota middleware + route, without HTTP or provider traffic. */
function handlers(path = '/api/chat/navbharat') {
  let found: any[] = [];
  registerChatRoutes({ post: (name: string, ...h: any[]) => { if (name === path) found = h; } } as never, ((_req: any, _res: any, next: any) => next()) as never);
  return found;
}
async function request(body: Record<string, unknown> = {}, options: { path?: string; afterQuota?: () => void } = {}) {
  const req = mockReq({ body: { message: 'Please explain that again', ...body }, headers: { 'x-nb-guest': '11111111-1111-4111-8111-111111111111', 'x-forwarded-for': '203.0.113.9' } });
  const res: any = mockRes(); const h = handlers(options.path);
  const chunks: string[] = []; res.flushHeaders = () => { res.headersSent = true; }; res.write = (chunk: string) => { chunks.push(chunk); return true; };
  let pending: Promise<unknown> | undefined;
  h[0](req, res, () => {
    pending = (async () => {
      let reply: Promise<unknown> | undefined;
      await h[2](req, res, () => { options.afterQuota?.(); reply = Promise.resolve(h[3](req, res)); });
      await reply;
    })();
  });
  await pending;
  return { req, res, chunks };
}
function database() {
  const docs = new Map<string, any>(); const reads: string[] = [];
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const pending = new Map<string, any>();
      const result = await fn({
        get: async ({ path }: any) => { reads.push(path); return { exists: docs.has(path), data: () => docs.get(path) }; },
        set: ({ path }: any, value: any) => { pending.set(path, { ...(pending.get(path) ?? docs.get(path)), ...value }); },
      });
      for (const [key, value] of pending) docs.set(key, value);
      return result;
    },
  };
  setServerDb(db as never); return { docs, reads };
}
beforeEach(() => { vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE', 'all');
  vi.clearAllMocks(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on'); vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'chat');
  vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off'); vi.stubEnv('DOSE_DIRECT_ANSWER', 'off');
  m.verify.mockResolvedValue(null); m.identity.mockResolvedValue(null); m.add.mockResolvedValue(undefined); m.oldContext.mockResolvedValue(undefined);
  m.detailed.mockResolvedValue({ ok: true, content: 'Guest answer', provider: 'GROQ', model: 'synthetic', latencyMs: 1 });
  m.stream.mockImplementation(async (...args: any[]) => { args[4]('Guest answer'); return { ok: true, content: 'Guest answer' }; });
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { setServerDb(null); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('ordinary signed-out Free chat remains usable without account authority', () => {
  it.each(['/api/chat/navbharat', '/api/chat/navbharatai'])('%s returns an ordinary guest reply and retains bounded client conversation', async path => {
    const state = database(); let context: ReturnType<typeof currentInferenceGatewayContext>;
    m.detailed.mockImplementationOnce(async () => { context = currentInferenceGatewayContext(); return { ok: true, content: 'Guest answer' }; });
    const history = [{ role: 'user', text: 'The topic was gardening.' }];
    const { req, res } = await request({ uid: 'victim', userId: 'victim', tenantId: 'victim', history,
      userProfile: { name: 'client-supplied display name' }, memorySummary: 'This is client-supplied conversation context, not retrieved account memory.' }, { path });
    expect(res.body).toEqual({ reply: 'Guest answer' });
    expect(context).toMatchObject({ principalId: expect.stringMatching(/^nb-free-guest:/), surface: 'chat', funding: 'platform-free-fallback', dataClass: 'health', qualityTier: 'clinical' });
    expect(context!.tenantId).toBe(context!.principalId);
    expect(m.detailed.mock.calls[0][1]).toEqual(history);
    expect(m.add.mock.calls[0][1].userId).toBe(context!.principalId);
    expect(state.reads.every(path => path.startsWith('guest_daily_usage/'))).toBe(true);
    expect(state.reads).toHaveLength(2);
    expect(m.legacy).not.toHaveBeenCalled(); expect(m.oldContext).not.toHaveBeenCalled();
    expect(wasGatewayGuestSelected(req)).toBe(true); expect(takeGuestInferenceAdmission(req)).toBeNull();
    expect(res.headers['set-cookie']).toBeUndefined();
  });
  it('eleventh guest message opens the existing sign-in path without reaching the provider', async () => {
    database(); for (let i = 0; i < 10; i++) expect((await request()).res.body).toEqual({ reply: 'Guest answer' });
    const { res } = await request(); expect(res.statusCode).toBe(403); expect(res.body.code).toBe('guest_limit_reached');
    expect(m.detailed).toHaveBeenCalledTimes(10); expect(m.legacy).not.toHaveBeenCalled();
  });
  it('ordinary streamed guest answer ends cleanly and uses the scoped principal in telemetry', async () => {
    database(); let principalId: string | undefined;
    m.stream.mockImplementationOnce(async (...args: any[]) => {
      principalId = currentInferenceGatewayContext()?.principalId;
      args[4]('Guest answer'); return { ok: true, content: 'Guest answer' };
    });
    const { res, chunks } = await request({ stream: true, uid: 'victim' });
    expect(res.ended).toBe(true); expect(chunks.join('')).toContain('Guest answer');
    expect(chunks.join('')).toContain('[DONE]'); expect(principalId).toMatch(/^nb-free-guest:/);
    expect(m.add.mock.calls[0][1].userId).toBe(principalId);
    expect(m.legacy).not.toHaveBeenCalled(); expect(m.detailed).not.toHaveBeenCalled();
  });
  it('selected quota storage outage refuses without any account read, provider call or legacy escape', async () => {
    setServerDb(null); const { res } = await request();
    expect(res.statusCode).toBe(503); expect(m.detailed).not.toHaveBeenCalled(); expect(m.legacy).not.toHaveBeenCalled();
  });
  it('an ON-to-OFF flag change after quota selection cannot escape through legacy', async () => {
    database(); const { req, res } = await request({}, { afterQuota: () => { process.env.INFERENCE_GATEWAY_ENABLED = 'off'; } });
    expect(wasGatewayGuestSelected(req)).toBe(true);
    expect(res.statusCode).toBe(503); expect(m.legacy).not.toHaveBeenCalled(); expect(m.detailed).not.toHaveBeenCalled();
  });
  it('OFF retains the old guest handler even when storage is unavailable', async () => {
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); setServerDb(null); const { req, res } = await request();
    expect(res.body).toEqual({ reply: 'Guest answer' }); expect(m.legacy).toHaveBeenCalledOnce();
    expect(wasGatewayGuestSelected(req)).toBe(false); expect(m.verify).not.toHaveBeenCalled();
  });
  it.each(['doctor', 'sda'])('body mode %s does not grant access to the paid clinical product', async mode => {
    database(); const { res } = await request({ mode });
    expect(res.statusCode).toBe(400); expect(res.body.code).toBe('DOCTOR_ROUTE_REQUIRED');
    expect(m.detailed).not.toHaveBeenCalled(); expect(m.legacy).not.toHaveBeenCalled();
  });
});
