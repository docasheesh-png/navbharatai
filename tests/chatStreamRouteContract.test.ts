/**
 * Offline composed contract: the actual registered chat middleware and handlers,
 * UniversalAIRouter, AIRouter, quota settlement logic and client SSE parser all run.
 * Only provider registration, authentication, persistence and ancillary services
 * are synthetic; no live provider or user data is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import { responseCompression } from '../src/server/lib/responseCompression';
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
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off'); vi.stubEnv('GUEST_DAILY_MESSAGES', 'off'); vi.stubEnv('DOSE_DIRECT_ANSWER', 'off');
  m.verify.mockResolvedValue('verified-user'); m.identity.mockResolvedValue({ uid: 'verified-user' });
  m.live.mockResolvedValue(''); m.document.mockResolvedValue('document text'); m.oldContext.mockResolvedValue(undefined); m.add.mockResolvedValue(undefined);
  m.detailed.mockImplementation(() => { throw new Error('Non-streaming router was not configured'); });
  m.stream.mockImplementation(() => { throw new Error('Streaming router was not configured'); });
  m.reserve.mockImplementation(async (_subject, _id, now = Date.now()) => ({ allowed: true, reservation: { id: 'a'.repeat(64), owner: requestId, principalHash: 'b'.repeat(64), day: '2026-10-23', startedAt: now, deadlineAt: now + 90_000, leaseExpiresAt: now + 30_000 }, status: { limit: 20, used: 0, reserved: 1, remaining: 19, inProgress: true, day: '2026-10-23', resetsAt: now + 100_000 } }));
  m.renew.mockResolvedValue(true); m.settle.mockResolvedValue(true);
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });


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

describe('registered chat middleware → real AIRouter → SSE reader and actual quota settlement', () => {
  it.each(cases)('preserves one interrupted answer at $path with watchdog $watchdog', async ({path, watchdog}) => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', watchdog);
    const {firstCall, secondCall} = configure(async (_p, _s, chunk) => {chunk('One partial answer.'); throw new Error('synthetic disconnect');});
    const res=response(); await route(path)(request({stream:true}),res);
    const actual=await parsed(res);
    expect(actual.text).toBe('One partial answer.\n\n_(NavBharatAI’s engine went quiet before finishing this answer, so it stops here. Ask again and it will pick the thread back up.)_');
    expect(actual.failure).toBeUndefined(); expect(res.chunks.join('')).toContain('[DONE]');
    expect(firstCall).toHaveBeenCalledOnce(); expect(secondCall).not.toHaveBeenCalled();
    expect(m.settle).toHaveBeenCalledExactlyOnceWith(expect.any(Object),'answered');
    expect(m.add).toHaveBeenCalledOnce();
    const usage=m.add.mock.calls[0][1];
    expect(usage).toMatchObject({ok:true,stalled:true,providerName:'GLM',raced:false,usageMeasured:false});
    expect(usage).not.toHaveProperty('failureReason');
    expect(usage).not.toHaveProperty('inputTokens'); expect(usage).not.toHaveProperty('outputTokens');
    expect(res.chunks.join('')).not.toMatch(/GLM|synthetic-model/);
  });

  it.each(cases.flatMap(c => ['', ' \n'].map(empty => ({...c,empty}))))('falls through empty/whitespace completion at $path with watchdog $watchdog', async ({path,watchdog,empty}) => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG',watchdog);
    const {firstCall,secondCall}=configure(async (_p,_s,chunk)=>{chunk(empty);return empty;});
    const res=response(); await route(path)(request({stream:true}),res);
    expect(await parsed(res)).toEqual({text:'Rescue answer.'});
    expect(res.chunks).toEqual(['data: {"c":"Rescue answer."}\n\n','data: [DONE]\n\n']);
    expect(firstCall).toHaveBeenCalledOnce();expect(secondCall).toHaveBeenCalledOnce();
    expect(m.settle).toHaveBeenCalledExactlyOnceWith(expect.any(Object),'answered');
    expect(m.add.mock.calls[0][1]).toMatchObject({ok:true,providerName:'GROQ',raced:false,usageMeasured:false});
  });

  it.each(cases)('refunds the answer reservation and never emits DONE if all providers are empty at $path with watchdog $watchdog', async ({path,watchdog})=>{
    vi.stubEnv('CHAT_STREAM_WATCHDOG',watchdog);
    const {firstCall,secondCall}=configure(async()=>'',async(_p,_s,chunk)=>{chunk(' \n');return 'metadata only';});
    const res=response();await route(path)(request({stream:true}),res);
    const actual=await parsed(res);
    expect(actual.text.trim()).not.toBe('');
    expect(actual.failure).toMatchObject({code:'CHAT_ROUTE_UNAVAILABLE',partial:false});
    expect(res.chunks.join('')).not.toContain('[DONE]');
    expect(firstCall).toHaveBeenCalledOnce();expect(secondCall).toHaveBeenCalledOnce();
    expect(m.settle).toHaveBeenCalledExactlyOnceWith(expect.any(Object),'provider-failed');
    expect(m.add.mock.calls[0][1]).toMatchObject({ok:false,failureReason:'all-failed',usageMeasured:false});
  });

  it.each(modes.flatMap(watchdog=>[true,false].map(partial=>({watchdog,partial}))))('keeps disconnect accounting and drops late output with watchdog $watchdog, partial $partial',async({watchdog,partial})=>{
    vi.stubEnv('CHAT_STREAM_WATCHDOG',watchdog);
    const res=response();
    const {firstCall,secondCall}=configure(async(_p,_s,chunk,_model,signal)=>{
      expect(signal).toBeInstanceOf(AbortSignal);
      if(partial)chunk('One partial answer.');
      res.destroyed=true;res.emit('close');
      expect(signal?.aborted).toBe(true);
      chunk('Late answer.');return 'Late answer.';
    });
    await route()(request({stream:true}),res);
    expect(res.chunks.join('')).toBe(partial?'data: {"c":"One partial answer."}\n\n':'');
    expect(firstCall).toHaveBeenCalledOnce();expect(secondCall).not.toHaveBeenCalled();
    expect(m.settle).toHaveBeenCalledExactlyOnceWith(expect.any(Object),partial?'answered':'uncertain');
  });

  it.each(paths)('reports an idle timeout as an interrupted answer at %s, not a second provider call',async path=>{
    vi.useFakeTimers();vi.stubEnv('CHAT_STREAM_WATCHDOG','on');vi.stubEnv('CHAT_STREAM_IDLE_MS','5000');
    let late!:(text:string)=>void;
    const {firstCall,secondCall}=configure((_p,_s,chunk)=>{late=chunk;chunk('One partial answer.');return new Promise<string>(()=>{});});
    const res=response();const pending=route(path)(request({stream:true}),res);
    await vi.advanceTimersByTimeAsync(0);expect(firstCall).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);await pending;
    late('Late answer.');
    const actual=await parsed(res);expect(actual.text).toContain('One partial answer.');expect(actual.text).toContain('went quiet before finishing');
    expect(actual.text).not.toContain('Late answer.');expect(actual.failure).toBeUndefined();expect(secondCall).not.toHaveBeenCalled();
    expect(m.settle).toHaveBeenCalledExactlyOnceWith(expect.any(Object),'answered');
    expect(m.add.mock.calls[0][1]).toMatchObject({ok:true,stalled:true});expect(vi.getTimerCount()).toBe(0);
  });
});


describe('actual non-streaming router remains compatible at both registered aliases', () => {
  it.each(paths.flatMap(path => [true, false].map(rescue => ({path,rescue}))))('keeps empty JSON behavior honest at $path, rescue $rescue', async ({path,rescue}) => {
    // The untouched universal JSON wrapper has a 90s timer; fake time avoids waiting for it here.
    vi.useFakeTimers();
    const router=new AIRouter('free');
    const first=vi.fn(async()=>({content:'  \n',latencyMs:1,provider:'GLM' as const,model:'synthetic-first'}));
    const second=vi.fn(async()=>({content:rescue?'A complete JSON answer.':'',latencyMs:2,provider:'GROQ' as const,model:'synthetic-second'}));
    router.registerProvider({name:'GLM',priority:1,execute:first,healthCheck:async()=>true});
    router.registerProvider({name:'GROQ',priority:2,execute:second,healthCheck:async()=>true});
    m.getRouter.mockReturnValue(router);
    const universal=new UniversalAIRouter();m.detailed.mockImplementation(universal.routeDetailed.bind(universal));
    const res=response();await route(path)(request(),res);
    expect(first).toHaveBeenCalledOnce();expect(second).toHaveBeenCalledOnce();expect(m.stream).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(rescue?200:503);
    if(rescue)expect(res.body).toEqual({reply:'A complete JSON answer.'});
    else expect(res.body).toMatchObject({ok:false,code:'CHAT_ROUTE_UNAVAILABLE',reply:expect.stringMatching(/busy/)});
    expect(m.settle).toHaveBeenCalledExactlyOnceWith(expect.any(Object),rescue?'answered':'provider-failed');
    const usage=m.add.mock.calls[0][1];expect(usage).toMatchObject({ok:rescue,usageMeasured:false});
    expect(usage).not.toHaveProperty('inputTokens');expect(usage).not.toHaveProperty('outputTokens');
    expect(usage).not.toHaveProperty('stalled');
  });
});


describe('durable settlement precedes the actual registered Chat terminal', () => {
  it.each([true, false])('withholds terminal frames until settlement confirms, answered %s', async answered => {
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const releasePromise = new Promise<void>(resolve => { release = resolve; });
    m.settle.mockImplementationOnce(async () => { entered(); await releasePromise; return true; });
    if (answered) configure(async (_prompt, _system, chunk) => { chunk('An actual synthetic answer.'); return 'An actual synthetic answer.'; });
    else configure(async () => '', async () => '');
    const res = response();
    const pending = route()(request({ stream: true }), res);
    try {
      await enteredPromise;
      const chunks = res.chunks.join('');
      if (answered) expect(chunks).toContain('An actual synthetic answer.');
      expect(chunks, 'DONE is client-observable completion before the HTTP socket closes').not.toContain('[DONE]');
      expect(chunks, 'Error frames also complete the actual client parser immediately').not.toContain('"error":');
      expect(res.ended).toBe(false);
      release();
      await pending;
      const actual = await parsed(res);
      if (answered) expect(actual).toEqual({ text: 'An actual synthetic answer.' });
      else expect(actual.failure).toMatchObject({ code: 'CHAT_ROUTE_UNAVAILABLE', partial: false });
      expect(m.settle).toHaveBeenCalledOnce();
      expect(m.settle.mock.calls[0][1]).toBe(answered ? 'answered' : 'provider-failed');
    } finally {
      release();
      await pending;
    }
  });
});


it.each([true, false])('defers the actual Chat SSE terminal over HTTP with compression mounted, answered %s', async answered => {
  let entered!: () => void; let release!: () => void; let received!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const releasePromise = new Promise<void>(resolve => { release = resolve; });
  const receivedPromise = new Promise<void>(resolve => { received = resolve; });
  m.settle.mockImplementationOnce(async () => { entered(); await releasePromise; return true; });
  if (answered) configure(async (_prompt, _system, chunk) => { chunk('An actual HTTP synthetic answer.'); return 'An actual HTTP synthetic answer.'; });
  else configure(async () => '', async () => '');
  const app = express(); app.use(express.json()); app.use(responseCompression());
  registerChatRoutes(app, ((_req: unknown, _res: unknown, next: () => void) => next()) as never);
  const server = await new Promise<http.Server>(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  let text = ''; let ended = false;
  const complete = new Promise<void>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: (server.address() as { port: number }).port, path: '/api/chat/navbharat', method: 'POST', headers: {
      'content-type': 'application/json', 'accept-encoding': 'gzip', 'x-nb-answer-request': requestId,
    } }, res => {
      expect(res.headers['content-encoding']).toBeUndefined();
      res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; received(); });
      res.on('end', () => { ended = true; resolve(); }); res.on('error', reject);
    });
    req.on('error', reject); req.end(JSON.stringify({ message: 'Explain this synthetic concept.', stream: true }));
  });
  try {
    await Promise.all([enteredPromise, receivedPromise]);
    expect(ended).toBe(false); expect(text).not.toContain('[DONE]'); expect(text).not.toContain('"error":');
    release(); await complete;
    const parsed = await consumeChatResponseStream(new Response(text).body!, true, vi.fn());
    if (answered) expect(parsed).toEqual({ text: 'An actual HTTP synthetic answer.' });
    else expect(parsed.failure).toMatchObject({ code: 'CHAT_ROUTE_UNAVAILABLE', partial: false });
    expect(m.settle).toHaveBeenCalledOnce();
  } finally {
    release();
    try { await complete; } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});

const visionCases = paths.flatMap(path => [true, false].flatMap(stream => ['image/png', 'application/pdf'].flatMap(type => [null, '', ' \n'].map(text => ({ path, stream, type, text })))));
it.each(visionCases)('never reports unavailable vision as an answer at $path stream=$stream type=$type text=$text', async ({ path, stream, type, text }) => {
  m.vision.mockResolvedValueOnce(text === null ? null : { text, provider: 'GLM' });
  const res = response();
  await route(path)(request({ message: 'Describe the supplied fixture.', stream, fileAttachments: [{ name: 'fixture', type, base64: 'AA==' }] }), res);
  expect(m.vision).toHaveBeenCalledOnce();
  expect(m.settle).toHaveBeenCalledOnce();
  expect(m.settle.mock.calls[0].slice(0, 2)).toEqual([expect.objectContaining({ id: 'a'.repeat(64), owner: requestId }), 'provider-failed']);
  if (stream) {
    expect((await parsed(res)).failure).toMatchObject({ code: 'CHAT_ROUTE_UNAVAILABLE', partial: false });
    expect(res.chunks.join('')).not.toContain('[DONE]');
  } else {
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ ok: false, code: 'CHAT_ROUTE_UNAVAILABLE' });
  }
});
it.each(paths.flatMap(path => [true, false].map(stream => ({ path, stream }))))('preserves a usable vision answer at $path stream=$stream', async ({ path, stream }) => {
  m.vision.mockResolvedValueOnce({ text: 'The fixture contains a blue square.', provider: 'GLM' });
  const res = response();
  await route(path)(request({ message: 'Describe the supplied fixture.', stream, fileAttachments: [{ name: 'fixture.png', type: 'image/png', base64: 'AA==' }] }), res);
  expect(m.settle).toHaveBeenCalledOnce();
  expect(m.settle.mock.calls[0].slice(0, 2)).toEqual([expect.objectContaining({ id: 'a'.repeat(64), owner: requestId }), 'answered']);
  if (stream) expect(await parsed(res)).toEqual({ text: 'The fixture contains a blue square.' });
  else { expect(res.statusCode).toBe(200); expect(res.body.reply).toBe('The fixture contains a blue square.'); }
});


it.each([true, false])('uses the chosen reply language for unavailable vision, stream=%s', async stream => {
  m.vision.mockResolvedValueOnce(null);
  const res = response();
  await route()(request({ message: 'Describe the supplied fixture.', replyLanguage: 'ta', stream, fileAttachments: [{ name: 'fixture.pdf', type: 'application/pdf', base64: 'AA==' }] }), res);
  const notice = stream ? (await parsed(res)).failure?.message : res.body.reply;
  expect(notice).toContain('இப்போது');
  expect(notice).not.toMatch(/provider|API|budget|quota|traffic|completion/i);
});
it('records empty selected vision output as unsuccessful while preserving real usage metadata', async () => {
  m.vision.mockResolvedValueOnce({ text: ' \n', provider: 'GLM', model: 'synthetic-vision', usage: { inputTokens: 5, outputTokens: 0 }, inferenceGateway: { requestId: 'synthetic-request' } });
  const res = response();
  await route()(request({ message: 'Describe the supplied fixture.', fileAttachments: [{ name: 'fixture.png', type: 'image/png', base64: 'AA==' }] }), res);
  expect(res.statusCode).toBe(503);
  expect(m.add).toHaveBeenCalledOnce();
  expect(m.add.mock.calls[0][1]).toMatchObject({ ok: false, failureReason: 'empty-output', capability: 'vision-pdf', inputTokens: 5, outputTokens: 0 });
  expect(m.settle.mock.calls[0][1]).toBe('provider-failed');
});
