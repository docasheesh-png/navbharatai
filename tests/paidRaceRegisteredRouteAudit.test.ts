/**
 * Raced-stream regression contract under the EXISTING test-only AI_STREAM_RACE=all override.
 * This is NOT evidence that a production deployment uses that override.
 * Offline composed contract: the actual registered chat middleware and handlers,
 * UniversalAIRouter, AIRouter, quota settlement logic and client SSE parser all run.
 * Only provider registration, authentication, persistence and ancillary services
 * are synthetic; no live provider or user data is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockReq, mockRes } from './helpers/routeTestUtils';
const m = vi.hoisted(() => ({ verify: vi.fn(), identity: vi.fn(), legacy: vi.fn(), detailed: vi.fn(), stream: vi.fn(), oldContext: vi.fn(), add: vi.fn(), live: vi.fn(), document: vi.fn(), vision: vi.fn(), reserve: vi.fn(), renew: vi.fn(), settle: vi.fn(), status: vi.fn(), getRouter: vi.fn() }));
vi.mock('../src/server/lib/authMiddleware', async original => ({ ...await original<typeof import('../src/server/lib/authMiddleware')>(), verifyFirebaseToken: m.verify, verifyFirebaseIdentity: m.identity }));
vi.mock('../src/server/AI/FreeChain/entryAdmission', () => ({ withFreeChainEntryAdmission: (_req: unknown, _res: unknown, run: () => unknown) => { m.legacy(); return run(); } }));
vi.mock('../src/server/AI/FreeChain/requestContext', () => ({ freeChainRequestContext: m.oldContext }));
vi.mock('../src/server/lib/aiRouter', () => ({ aiRouter: { routeDetailed: m.detailed, routeStream: m.stream } }));
vi.mock('../src/server/lib/liveSearchContext', () => ({ liveSearchContext: m.live, needsLiveSearch: () => false }));
vi.mock('../src/server/lib/visionChain', () => ({ runVisionChain: m.vision }));
vi.mock('../src/server/lib/attachmentText', () => ({ buildDocumentContext: m.document }));
vi.mock('../src/server/lib/serverDb', async original => ({ ...await original<typeof import('../src/server/lib/serverDb')>(), getServerDb: () => null, collection: () => ({}), addDoc: m.add }));
vi.mock('../src/server/lib/freeAnswerQuotaStore', async original => ({ ...await original<typeof import('../src/server/lib/freeAnswerQuotaStore')>(), FREE_ANSWER_LEASE_MS: 30_000, FREE_ANSWER_REQUEST_MS: 90_000, FreeAnswerQuotaStore: class {
  reserve = m.reserve; renew = m.renew; settle = m.settle; status = m.status;
} }));
vi.mock('../src/server/lib/imageEditRun', () => ({ checkEditable: () => ({ ok: false, outcome: { badInput: 'Test edit cannot be completed.' } }), runImageEdit: vi.fn() }));
import { registerChatRoutes } from '../src/server/routes/chat';
vi.mock('../src/server/AI/AIRouterManager', () => ({ AIRouterManager: { getRouter: m.getRouter } }));
import { UniversalAIRouter } from '../src/server/AI/UniversalAIRouter';
import { AIRouter } from '../src/server/AI/Router/AIRouter';
import type { AIProvider } from '../src/server/AI/Router/ProviderTypes';
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync: vi.fn(), write: vi.fn() } }));
import { consumeChatResponseStream } from '../src/lib/chatResponseStream';

const requestId = '11111111-1111-4111-8111-111111111111';
function response() {
  const res = mockRes() as ReturnType<typeof mockRes> & { write: (s: string) => boolean; flushHeaders: () => void; removeListener: () => void; chunks: string[]; destroyed: boolean; writableEnded: boolean };
  res.chunks = []; res.destroyed = false; res.writableEnded = false;
  res.removeListener = () => {};
  res.flushHeaders = () => { res.headersSent = true; };
  res.write = chunk => { res.chunks.push(chunk); return true; };
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
  vi.clearAllMocks(); resetAllBreakers(); vi.useFakeTimers(); vi.stubEnv('AI_STREAM_RACE', 'all');
  vi.stubEnv('UNIFIED_WALLET_ENABLED', 'off'); vi.stubEnv('UNIFIED_WALLET_FREE_LIMIT', 'off');
  vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off');
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off'); vi.stubEnv('GUEST_DAILY_MESSAGES', 'off'); vi.stubEnv('DOSE_DIRECT_ANSWER', 'off');
  m.verify.mockResolvedValue('verified-user'); m.identity.mockResolvedValue({ uid: 'verified-user' });
  m.live.mockResolvedValue(''); m.document.mockResolvedValue('document text'); m.oldContext.mockResolvedValue(undefined); m.add.mockResolvedValue(undefined);
  m.detailed.mockImplementation(() => { throw new Error('Non-streaming router was not configured'); });
  m.stream.mockImplementation(() => { throw new Error('Streaming router was not configured'); });
  m.reserve.mockImplementation(async (_subject, _id, now = Date.now()) => ({ allowed: true, reservation: { id: 'a'.repeat(64), owner: requestId, principalHash: 'b'.repeat(64), day: '2026-10-23', startedAt: now, deadlineAt: now + 90_000, leaseExpiresAt: now + 30_000 }, status: { limit: 20, used: 0, reserved: 1, remaining: 19, inProgress: true, day: '2026-10-23', resetsAt: now + 100_000 } }));
  m.renew.mockResolvedValue(true); m.settle.mockResolvedValue(true);
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });


function configure(first: NonNullable<AIProvider['executeStream']>, second?: NonNullable<AIProvider['executeStream']>) {
  const router = new AIRouter('free');
  const firstCall = vi.fn(first);
  const secondCall = vi.fn(second ?? (async (_p, _s, chunk) => { chunk('Rescue answer.'); return 'Rescue answer.'; }));
  const provider = (name: AIProvider['name'], priority: number, stream: NonNullable<AIProvider['executeStream']>): AIProvider => ({
    name, priority, pinnedModel: 'synthetic-model', execute: vi.fn(), healthCheck: async () => true, executeStream: stream,
  });
  router.registerProvider(provider('GLM', 1, firstCall));
  router.registerProvider(provider('GROQ', 2, secondCall));
  m.getRouter.mockReturnValue(router);
  const universal = new UniversalAIRouter();
  m.stream.mockImplementation(universal.routeStream.bind(universal));
  return { firstCall, secondCall };
}
const paths = ['/api/chat/navbharat', '/api/chat/navbharatai'];
const modes = ['on', 'off'];
const cases = paths.flatMap(path => modes.map(watchdog => ({path, watchdog})));
async function parsed(res: ReturnType<typeof response>) {
  return consumeChatResponseStream(new Response(res.chunks.join('')).body!, true, vi.fn());
}

describe('registered chat aliases → existing race override → real router → SSE consumer', () => {
  it.each(cases)('whitespace racer must not hide the available answer at $path / watchdog $watchdog', async ({path,watchdog}) => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG',watchdog);
    const {firstCall,secondCall}=configure(async (_p,_s,chunk)=>{chunk(' \n');return ' \n';});
    const res=response();await route(path)(request({stream:true}),res);
    expect(m.getRouter).toHaveBeenCalledWith('free');
    expect(firstCall).toHaveBeenCalledOnce();expect(secondCall).toHaveBeenCalledOnce();
    expect.soft(await parsed(res)).toEqual({text:'Rescue answer.'});
    expect.soft(m.add.mock.calls[0][1]).toMatchObject({ok:true,providerName:'GROQ',raced:true,usageMeasured:false});
    expect.soft(m.settle).toHaveBeenCalledExactlyOnceWith(expect.any(Object),'answered');
  });

  it.each(cases)('committed rejection must be disclosed before DONE and in usage at $path / watchdog $watchdog',async({path,watchdog})=>{
    vi.stubEnv('CHAT_STREAM_WATCHDOG',watchdog);
    const {firstCall,secondCall}=configure(async(_p,_s,chunk)=>{chunk('One partial answer.');throw new Error('synthetic upstream disconnect');});
    const res=response();await route(path)(request({stream:true}),res);
    expect(m.getRouter).toHaveBeenCalledWith('free');
    expect(firstCall).toHaveBeenCalledOnce();expect(secondCall).toHaveBeenCalledOnce();
    const actual=await parsed(res);
    expect.soft(actual.text).toBe('One partial answer.\n\n_(NavBharatAI’s engine went quiet before finishing this answer, so it stops here. Ask again and it will pick the thread back up.)_');
    expect(actual.failure).toBeUndefined();expect(res.chunks.join('')).toContain('[DONE]');
    expect.soft(m.add.mock.calls[0][1]).toMatchObject({ok:true,stalled:true,providerName:'GLM',raced:true,usageMeasured:false});
    expect(m.settle).toHaveBeenCalledExactlyOnceWith(expect.any(Object),'answered');
    expect(res.chunks.join('')).not.toMatch(/GLM|GROQ|synthetic-model/);
  });

  it.each(cases)('all empty racers produce a terminal refusal and refund, not DONE at $path / watchdog $watchdog', async ({path,watchdog}) => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG',watchdog);
    configure(async () => 'metadata only', async (_p,_s,chunk) => { chunk(' \n'); return 'metadata only'; });
    const res=response(); const pending=route(path)(request({stream:true}),res);
    await vi.advanceTimersByTimeAsync(12_000); await pending;
    expect((await parsed(res)).failure).toMatchObject({code:'CHAT_ROUTE_UNAVAILABLE',partial:false});
    expect(res.chunks.join('')).not.toContain('[DONE]');
    expect(m.add.mock.calls[0][1]).toMatchObject({ok:false,failureReason:'all-failed',usageMeasured:false});
    expect(m.settle).toHaveBeenCalledExactlyOnceWith(expect.any(Object),'provider-failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(cases)('client disconnect preserves the delivered quota result without further SSE at $path / watchdog $watchdog', async ({path,watchdog}) => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG',watchdog);
    const streams = (text: string): NonNullable<AIProvider['executeStream']> => (_p,_s,chunk,_m,signal) => {
      chunk(text);
      return new Promise<string>((_resolve,reject) => signal!.addEventListener('abort', () => {
        chunk('Late text.'); reject(signal!.reason);
      },{once:true}));
    };
    const {firstCall,secondCall}=configure(streams('Partial answer.'),streams('Discarded.'));
    const res=response();const pending=route(path)(request({stream:true}),res);
    await vi.advanceTimersByTimeAsync(0);
    expect(firstCall).toHaveBeenCalledOnce();expect(secondCall).toHaveBeenCalledOnce();
    res.destroyed=true;res.emit('close');await pending;
    expect(res.chunks).toEqual(['data: {"c":"Partial answer."}\n\n']);
    expect(m.settle).toHaveBeenCalledExactlyOnceWith(expect.any(Object),'answered');
    expect(vi.getTimerCount()).toBe(0);
  });
});
