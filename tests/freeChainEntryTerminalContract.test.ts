/**
 * Offline composed admission contract: actual registered chat middleware, entry admission,
 * quota settlement and client JSON/SSE parsing run; no prompt/provider work may start.
 * Only provider registration, authentication, persistence and ancillary services
 * are synthetic; no live provider or user data is touched.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mockReq, mockRes } from './helpers/routeTestUtils';
const m = vi.hoisted(() => ({ verify: vi.fn(), identity: vi.fn(), legacy: vi.fn(), detailed: vi.fn(), stream: vi.fn(), oldContext: vi.fn(), entryAcquire: vi.fn(), entryControls: vi.fn(), add: vi.fn(), live: vi.fn(), document: vi.fn(), vision: vi.fn(), reserve: vi.fn(), renew: vi.fn(), settle: vi.fn(), status: vi.fn(), getRouter: vi.fn() }));
vi.mock('../src/server/lib/authMiddleware', async original => ({ ...await original<typeof import('../src/server/lib/authMiddleware')>(), verifyFirebaseToken: m.verify, verifyFirebaseIdentity: m.identity }));
vi.mock('../src/server/AI/FreeChain/admissionQueue', async original => ({ ...await original<typeof import('../src/server/AI/FreeChain/admissionQueue')>(), freeChainAdmissionQueue: { acquire: m.entryAcquire } }));
vi.mock('../src/server/AI/FreeChain/control', () => ({ readControlsForSelection: m.entryControls, controlRef: () => ({ collection: () => ({ doc: () => ({ set: async () => {} }) }) }) }));
vi.mock('../src/server/AI/FreeChain/requestContext', () => ({ freeChainRequestContext: m.oldContext }));
vi.mock('../src/server/lib/aiRouter', () => ({ aiRouter: { routeDetailed: m.detailed, routeStream: m.stream } }));
vi.mock('../src/server/lib/liveSearchContext', () => ({ liveSearchContext: m.live, needsLiveSearch: () => false }));
vi.mock('../src/server/lib/visionChain', () => ({ runVisionChain: m.vision }));
vi.mock('../src/server/lib/attachmentText', () => ({ buildDocumentContext: m.document }));
vi.mock('../src/server/lib/serverDb', async original => ({ ...await original<typeof import('../src/server/lib/serverDb')>(), getServerDb: () => ({ collection: () => ({ add: m.add }) }), collection: () => ({}), addDoc: m.add }));
vi.mock('../src/server/lib/freeAnswerQuotaStore', async original => ({ ...await original<typeof import('../src/server/lib/freeAnswerQuotaStore')>(), FREE_ANSWER_LEASE_MS: 30_000, FREE_ANSWER_REQUEST_MS: 90_000, FreeAnswerQuotaStore: class {
  reserve = m.reserve; renew = m.renew; settle = m.settle; status = m.status;
} }));
vi.mock('../src/server/lib/imageEditRun', () => ({ checkEditable: () => ({ ok: false, outcome: { badInput: 'Test edit cannot be completed.' } }), runImageEdit: vi.fn() }));
import { registerChatRoutes } from '../src/server/routes/chat';
vi.mock('../src/server/AI/AIRouterManager', () => ({ AIRouterManager: { getRouter: m.getRouter } }));
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync: vi.fn(), write: vi.fn() } }));
import { chatAvailabilityMessage } from '../src/server/lib/chatAvailabilityMessage';
import { consumeChatResponseStream, gatewayChatFailure } from '../src/lib/chatResponseStream';

const requestId = '11111111-1111-4111-8111-111111111111';
function response() {
  const res = mockRes() as ReturnType<typeof mockRes> & { write: (s: string) => boolean; flushHeaders: () => void; removeListener: () => void; chunks: string[]; destroyed: boolean; writableEnded: boolean };
  res.chunks = []; res.destroyed = false; res.writableEnded = false;
  res.removeListener = () => {};
  res.flushHeaders = () => { res.headersSent = true; };
  res.write = chunk => { res.chunks.push(chunk); return true; };
  const end = res.end.bind(res);
  res.end = (chunk?: string) => { if (chunk !== undefined) res.write(chunk); res.writableEnded = true; return end(); };
  return res;
}
function request(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return mockReq({ body: { message: 'Please explain this idea.', ...body }, headers: { 'x-nb-answer-request': requestId, 'x-nb-guest': '22222222-2222-4222-8222-222222222222', 'x-forwarded-for': 'spoofed, 203.0.113.9', ...headers } });
}
// Unlike last-handler-only fixtures, execute the registered inference-scope middleware too.
function route(path = '/api/chat/navbharat') {
  const routes = new Map<string, Array<(req: any, res: any, next: () => unknown) => unknown>>();
  registerChatRoutes({ get: () => {}, post: (name: string, ...handlers: any[]) => routes.set(name, handlers) } as any,
    ((_req: unknown, _res: unknown, next: () => unknown) => next()) as any);
  return async (req: any, res: any) => {
    const handlers = routes.get(path)!;
    async function dispatch(index: number): Promise<unknown> {
      let pending: Promise<unknown> | undefined;
      await handlers[index](req, res, () => { pending = dispatch(index + 1); return pending; });
      return pending;
    }
    return dispatch(0);
  };
}
beforeEach(() => {
  vi.clearAllMocks(); resetAllBreakers();
  vi.stubEnv('UNIFIED_WALLET_ENABLED', 'off'); vi.stubEnv('UNIFIED_WALLET_FREE_LIMIT', 'off');
  vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off');
  vi.stubEnv('FREE_CHAIN_ENABLED', 'on'); vi.stubEnv('GUEST_DAILY_MESSAGES', 'off'); vi.stubEnv('DOSE_DIRECT_ANSWER', 'off');
  m.verify.mockResolvedValue('verified-user'); m.identity.mockResolvedValue({ uid: 'verified-user' });
  m.live.mockResolvedValue(''); m.document.mockResolvedValue('document text'); m.oldContext.mockResolvedValue(undefined); m.add.mockResolvedValue(undefined);
  m.entryControls.mockResolvedValue({ enabled: true, rolloutPercent: 100, disabledProviders: [] });
  m.detailed.mockImplementation(() => { throw new Error('Non-streaming router was not configured'); });
  m.stream.mockImplementation(() => { throw new Error('Streaming router was not configured'); });
  m.reserve.mockImplementation(async (_subject, _id, now = Date.now()) => ({ allowed: true, reservation: { id: 'a'.repeat(64), owner: requestId, principalHash: 'b'.repeat(64), day: '2026-10-23', startedAt: now, deadlineAt: now + 90_000, leaseExpiresAt: now + 30_000 }, status: { limit: 20, used: 0, reserved: 1, remaining: 19, inProgress: true, day: '2026-10-23', resetsAt: now + 100_000 } }));
  m.renew.mockResolvedValue(true); m.settle.mockResolvedValue(true);
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const entryCases = ['/api/chat/navbharat', '/api/chat/navbharatai'].flatMap(path => [false, true].flatMap(stream => ['queue-full', 'timeout', 'user-limit', 'capacity'].map(reason => ({ path, stream, reason }))));
it.each(entryCases)('registered $path rejects $reason truthfully, stream=$stream', async ({ path, stream, reason }) => {
  m.entryAcquire.mockResolvedValue({ admitted: false, reason, waitedMs: 7 });
  const res = response();
  const body = { message: 'mujhe ek sawal poochna hai', replyLanguage: 'hi', stream };
  await route(path)(request(body), res);
  const code = reason === 'user-limit' ? 'CHAT_REQUEST_IN_PROGRESS' : reason === 'capacity' ? 'CHAT_ROUTE_UNAVAILABLE' : 'CHAT_CAPACITY_EXHAUSTED';
  const notice = chatAvailabilityMessage(reason === 'queue-full' || reason === 'timeout' ? 'capacity' : 'temporary', body);
  if (stream) {
    const wire = res.chunks.join('');
    expect(wire).not.toContain('[DONE]');
    const result = await consumeChatResponseStream(new Response(wire).body!, true, vi.fn());
    expect(result).toEqual({ text: notice, failure: { code, message: notice, partial: false } });
  } else {
    expect(res.statusCode).toBe(reason === 'user-limit' ? 429 : 503);
    expect(res.body).toMatchObject({ ok: false, code, reply: notice });
    expect(gatewayChatFailure(res.body)).toEqual({ code, message: notice, partial: false });
  }
  expect(m.settle).toHaveBeenCalledOnce();
  expect(m.settle.mock.calls[0].slice(0, 2)).toEqual([expect.objectContaining({ id: 'a'.repeat(64), owner: requestId }), 'provider-failed']);
  expect(m.detailed).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled(); expect(m.live).not.toHaveBeenCalled();
  expect(m.add).toHaveBeenCalledWith(expect.objectContaining({ ok: false, failureReason: reason, usageMeasured: false }));
});
it.each([false, true])('registered control-store failure stays neutral, stream=%s', async stream => {
  m.entryControls.mockRejectedValue(new Error('synthetic provider budget configuration details'));
  const res = response(); const body = { message: 'Please help', replyLanguage: 'ta', stream };
  await route()(request(body), res);
  const reply = chatAvailabilityMessage('temporary', body);
  if (stream) expect((await consumeChatResponseStream(new Response(res.chunks.join('')).body!, true, vi.fn())).failure)
    .toEqual({ code: 'CHAT_ROUTE_UNAVAILABLE', message: reply, partial: false });
  else expect(res.body).toMatchObject({ ok: false, code: 'CHAT_ROUTE_UNAVAILABLE', reply });
  expect(m.entryAcquire).not.toHaveBeenCalled(); expect(m.detailed).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled();
  expect(m.settle).toHaveBeenCalledOnce();
  expect(m.settle.mock.calls[0].slice(0, 2)).toEqual([expect.objectContaining({ id: 'a'.repeat(64), owner: requestId }), 'provider-failed']);
});
