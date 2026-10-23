import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from '../../../../tests/helpers/routeTestUtils';
const m = vi.hoisted(() => ({ verify: vi.fn(), legacy: vi.fn(), detailed: vi.fn(), stream: vi.fn(), oldContext: vi.fn(), add: vi.fn(), live: vi.fn(), needsLive: vi.fn(), document: vi.fn(), vision: vi.fn() }));
vi.mock('../../lib/authMiddleware', async original => ({ ...await original<typeof import('../../lib/authMiddleware')>(), verifyFirebaseToken: m.verify }));
vi.mock('../FreeChain/entryAdmission', () => ({ withFreeChainEntryAdmission: (_req: unknown, _res: unknown, run: () => unknown) => { m.legacy(); return run(); } }));
vi.mock('../FreeChain/requestContext', () => ({ freeChainRequestContext: m.oldContext }));
vi.mock('../../lib/aiRouter', () => ({ aiRouter: { routeDetailed: m.detailed, routeStream: m.stream } }));
vi.mock('../../lib/liveSearchContext', () => ({ liveSearchContext: m.live, needsLiveSearch: m.needsLive }));
vi.mock('../../lib/visionChain', () => ({ runVisionChain: m.vision }));
vi.mock('../../lib/attachmentText', () => ({ buildDocumentContext: m.document }));
vi.mock('../../lib/serverDb', async original => ({ ...await original<typeof import('../../lib/serverDb')>(), getServerDb: () => null, collection: () => ({}), addDoc: m.add }));
import { registerChatRoutes } from '../../routes/chat';
import { currentInferenceGatewayContext, InferenceGatewayTerminalError } from './runtime';
import { runWithInferenceScope } from '../inferencePolicy';
import { freeChainAdmissionQueue } from '../FreeChain/admissionQueue';
const route = () => captureRoutes(registerChatRoutes as any, () => {}).get('POST /api/chat/navbharat')!;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on'); vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'chat');
  vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off'); vi.stubEnv('DOSE_DIRECT_ANSWER', 'off');
  m.live.mockResolvedValue(''); m.needsLive.mockReturnValue(false); m.document.mockResolvedValue('document text');
  m.vision.mockResolvedValue({ text: 'vision answer', provider: 'GLM' });
  m.verify.mockResolvedValue('verified-user'); m.oldContext.mockResolvedValue(undefined); m.add.mockResolvedValue(undefined);
  m.detailed.mockResolvedValue({ ok: true, content: 'answer', model: 'test-model', provider: 'GROQ', latencyMs: 1 });
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('ordinary chat reaches the real gateway ingress context', () => {
  it('binds only verified identity and conservative requirements, bypassing old admission and context', async () => {
    let context: ReturnType<typeof currentInferenceGatewayContext>;
    m.detailed.mockImplementationOnce(async () => { context = currentInferenceGatewayContext(); return { ok: true, content: 'answer' }; });
    const res = mockRes();
    await route()(mockReq({ body: { message: 'hello', uid: 'attacker', tenantId: 'attacker', dataClass: 'public', qualityTier: 'standard' } }), res);
    expect(res.body).toEqual({ reply: 'answer' });
    expect(context).toMatchObject({ principalId: 'verified-user', tenantId: 'verified-user', surface: 'chat', policyKey: 'chat:text', funding: 'platform-free-fallback', dataClass: 'health', qualityTier: 'clinical', signal: expect.any(AbortSignal) });
    expect(context!.deadlineAtMs).toBeGreaterThan(Date.now());
    expect(m.verify).toHaveBeenCalledOnce(); expect(m.legacy).not.toHaveBeenCalled(); expect(m.oldContext).not.toHaveBeenCalled();
    expect(m.detailed.mock.calls[0][4]).toContain('LANGUAGE RULE');
  });
  it('OFF preserves old admission and does not add authentication work', async () => {
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); const res = mockRes();
    await route()(mockReq({ body: { message: 'hello' } }), res);
    expect(res.body).toEqual({ reply: 'answer' }); expect(m.legacy).toHaveBeenCalledOnce(); expect(m.verify).not.toHaveBeenCalled();
  });
  it('does not give a claimed body uid authority when authentication is absent', async () => {
    m.verify.mockResolvedValue(null);
    const res = mockRes(); await route()(mockReq({ body: { message: 'hello', uid: 'victim' } }), res);
    expect(res.statusCode).toBe(503); expect(m.detailed).not.toHaveBeenCalled(); expect(m.legacy).not.toHaveBeenCalled(); expect(m.live).not.toHaveBeenCalled();
  });
  it('ends a selected streaming refusal, without a second answer or misleading DONE', async () => {
    m.stream.mockRejectedValue(new InferenceGatewayTerminalError('policy-denied'));
    const res: any = mockRes(); const chunks: string[] = [];
    res.flushHeaders = () => { res.headersSent = true; }; res.write = (chunk: string) => { chunks.push(chunk); return true; };
    await route()(mockReq({ body: { message: 'hello', stream: true } }), res);
    expect(res.ended).toBe(true); expect(chunks.join('')).toContain('INFERENCE_GATEWAY_INTERRUPTED'); expect(chunks.join('')).not.toContain('[DONE]');
    expect(m.stream).toHaveBeenCalledOnce(); expect(m.detailed).not.toHaveBeenCalled(); expect(m.legacy).not.toHaveBeenCalled();
  });
  it.each([false, true])('does not silently replace unsupported grounding with text (stream=%s)', async stream => {
    m.needsLive.mockReturnValue(true); m.live.mockRejectedValue(new InferenceGatewayTerminalError('unclaimed-legacy-dispatch'));
    const res: any = mockRes(); const chunks: string[] = [];
    res.flushHeaders = () => { res.headersSent = true; }; res.write = (chunk: string) => { chunks.push(chunk); return true; };
    await route()(mockReq({ body: { message: 'latest news', stream } }), res);
    if (stream) { expect(res.ended).toBe(true); expect(chunks.join('')).toContain('INFERENCE_GATEWAY_UNAVAILABLE'); }
    else { expect(res.statusCode).toBe(503); expect(res.body.code).toBe('INFERENCE_GATEWAY_UNAVAILABLE'); }
    expect(m.detailed).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled(); expect(m.legacy).not.toHaveBeenCalled();
  });
  it('cancels before prompt assembly when the client leaves during authentication', async () => {
    let release!: (uid: string) => void;
    m.verify.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve; }));
    const res = mockRes(); const pending = route()(mockReq({ body: { message: 'hello' } }), res);
    await vi.waitFor(() => expect(m.verify).toHaveBeenCalledOnce());
    res.emit('close'); release('verified-user'); await pending;
    expect(m.detailed).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled(); expect(m.legacy).not.toHaveBeenCalled();
  });
  it.each([false, true])('denies admission before document/profile/grounding work (stream=%s)', async stream => {
    const admission = vi.spyOn(freeChainAdmissionQueue, 'acquire').mockResolvedValueOnce({ admitted: false, reason: 'queue-full', waitedMs: 0 });
    const profile = vi.fn(() => ({ name: 'private profile' }));
    const body = { message: 'hello', stream, fileAttachments: [{ type: 'text/plain', name: 'notes.txt', base64: 'AA==' }] };
    Object.defineProperty(body, 'userProfile', { get: profile });
    const res: any = mockRes(); const chunks: string[] = [];
    res.flushHeaders = () => { res.headersSent = true; }; res.write = (chunk: string) => { chunks.push(chunk); return true; };
    await route()(mockReq({ body }), res);
    expect(admission).toHaveBeenCalledOnce();
    expect(admission.mock.calls[0][0]).toMatchObject({ uid: 'verified-user', signal: expect.any(AbortSignal), maxWaitMs: 5000 });
    expect(profile).not.toHaveBeenCalled(); expect(m.document).not.toHaveBeenCalled(); expect(m.live).not.toHaveBeenCalled();
    expect(m.detailed).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled(); expect(m.legacy).not.toHaveBeenCalled();
    if (stream) { expect(res.ended).toBe(true); expect(chunks.join('')).toContain('INFERENCE_GATEWAY_UNAVAILABLE'); expect(chunks.join('')).not.toContain('[DONE]'); }
    else expect(res.statusCode).toBe(503);
  });
  it('holds prompt assembly behind the real authenticated queue and releases after the handler', async () => {
    const held = await freeChainAdmissionQueue.acquire({ uid: 'verified-user' });
    expect(held.admitted).toBe(true); if (!held.admitted) throw new Error('expected test lease');
    const res = mockRes();
    try {
      const pending = route()(mockReq({ body: { message: 'hello', fileAttachments: [{ type: 'text/plain', name: 'notes.txt', base64: 'AA==' }] } }), res);
      await vi.waitFor(() => expect(freeChainAdmissionQueue.snapshot().queued).toBe(1));
      expect(m.document).not.toHaveBeenCalled(); expect(m.live).not.toHaveBeenCalled(); expect(m.detailed).not.toHaveBeenCalled();
      held.release(); await pending;
      expect(res.body).toEqual({ reply: 'answer' }); expect(m.document).toHaveBeenCalledOnce();
      expect(freeChainAdmissionQueue.snapshot()).toMatchObject({ active: 0, queued: 0 });
    } finally { held.release(); }
  });
  it('removes a disconnected queued request without assembling or calling a provider', async () => {
    const held = await freeChainAdmissionQueue.acquire({ uid: 'verified-user' });
    expect(held.admitted).toBe(true); if (!held.admitted) throw new Error('expected test lease');
    const res = mockRes();
    try {
      const pending = route()(mockReq({ body: { message: 'hello', fileAttachments: [{ type: 'text/plain', name: 'notes.txt', base64: 'AA==' }] } }), res);
      await vi.waitFor(() => expect(freeChainAdmissionQueue.snapshot().queued).toBe(1));
      res.emit('close'); await pending;
      expect(freeChainAdmissionQueue.snapshot()).toMatchObject({ active: 1, queued: 0 });
      expect(m.document).not.toHaveBeenCalled(); expect(m.live).not.toHaveBeenCalled(); expect(m.detailed).not.toHaveBeenCalled();
      expect(res.body).toBeUndefined(); expect(m.legacy).not.toHaveBeenCalled();
    } finally { held.release(); }
  });
  it('rejects oversized media turns after authenticated admission without legacy escape', async () => {
    const res = mockRes(); await route()(mockReq({ body: { message: 'x'.repeat(100_001), fileAttachments: [{ type: 'image/png', name: 'photo.png', base64: 'AA==' }] } }), res);
    expect(res.statusCode).toBe(413); expect(m.legacy).not.toHaveBeenCalled(); expect(m.verify).toHaveBeenCalledOnce(); expect(m.detailed).not.toHaveBeenCalled();
  });
});

describe('Doctor product cannot be selected with a Free chat body field', () => {
 it.each(['doctor', 'sda'])('rejects unsupported %s mode before any free or paid route', async mode => {
   vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'on'); vi.stubEnv('FREE_CHAIN_ENABLED', 'on');
   const res = mockRes(); await route()(mockReq({ body: { message: 'hello', mode } }), res);
   expect(res.statusCode).toBe(400); expect(res.body.code).toBe('DOCTOR_ROUTE_REQUIRED');
   expect(m.verify).not.toHaveBeenCalled(); expect(m.legacy).not.toHaveBeenCalled();
   expect(m.detailed).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled();
 });
});

describe('Free attachments share authenticated early admission', () => {
 it.each(['image/png','application/pdf'])('selects %s under both Free flags without legacy escape',async type=>{
  vi.stubEnv('STRICT_FREE_MODULES_ENABLED','on');let context:ReturnType<typeof currentInferenceGatewayContext>;
  m.vision.mockImplementationOnce(async()=>{context=currentInferenceGatewayContext();return {text:'vision answer',provider:'GLM'};});
  const res=mockRes();await runWithInferenceScope('free-modules',()=>route()(mockReq({body:{message:'describe this',fileAttachments:[{name:'file',type,base64:'AAAA'}]}}),res));
  expect(res.body).toMatchObject({reply:'vision answer'});expect(context).toMatchObject({principalId:'verified-user',funding:'platform-free-fallback',mode:'strict-free'});
  expect(m.verify).toHaveBeenCalledOnce();expect(m.legacy).not.toHaveBeenCalled();expect(m.detailed).not.toHaveBeenCalled();
 });
 it('does not attempt media work when verified identity is absent',async()=>{
  m.verify.mockResolvedValue(null);const res=mockRes();await route()(mockReq({body:{message:'describe',fileAttachments:[{name:'file',type:'image/png',base64:'AAAA'}]}}),res);
  expect(res.statusCode).toBe(503);expect(m.vision).not.toHaveBeenCalled();expect(m.document).not.toHaveBeenCalled();expect(m.legacy).not.toHaveBeenCalled();
 });
});

it('records selected media with verified identity and separate-ledger provenance', async () => {
    const marker = { version: 1, logicalRequestId: 'media', accounting: 'separate-ledger' };
    m.vision.mockResolvedValue({ text: 'vision answer', provider: 'GEMINI', model: 'gemini-2.5-flash', usage: { inputTokens: 100, outputTokens: 20 }, inferenceGateway: marker });
    const res = mockRes();
    await route()(mockReq({ body: { message: 'read', uid: 'forged', fileAttachments: [{ name: 'a.pdf', type: 'application/pdf', base64: 'x' }] } }), res);
    expect(res.body).toEqual({ reply: 'vision answer' });
    expect(m.add).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'verified-user', capability: 'vision-pdf', usageMeasured: true, inputTokens: 100, outputTokens: 20, inferenceGateway: marker }));
});

describe('unauthenticated Free traffic cannot escape selected admission', () => {
 it.each(['text', 'stream', 'pdf'] as const)('returns explicit unavailable for %s without a verified Firebase session', async kind => {
  m.verify.mockResolvedValue(null); const res: any = mockRes(); const chunks: string[] = [];
  res.flushHeaders = () => { res.headersSent = true; }; res.write = (chunk: string) => { chunks.push(chunk); return true; };
  await route()(mockReq({ body: { message: 'hello', ...(kind === 'stream' ? { stream: true } : {}),
    ...(kind === 'pdf' ? { fileAttachments: [{ type: 'application/pdf', name: 'file.pdf', base64: 'AAAA' }] } : {}) } }), res);
  if (kind === 'stream') { expect(res.ended).toBe(true); expect(chunks.join('')).toContain('INFERENCE_GATEWAY_UNAVAILABLE'); }
  else expect(res.statusCode).toBe(503);
  expect(m.legacy).not.toHaveBeenCalled(); expect(m.detailed).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled();
  expect(m.vision).not.toHaveBeenCalled(); expect(m.live).not.toHaveBeenCalled(); expect(m.document).not.toHaveBeenCalled();
 });
});
