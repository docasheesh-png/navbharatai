import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
const m = vi.hoisted(() => ({ verify: vi.fn(), identity: vi.fn(), legacy: vi.fn(), detailed: vi.fn(), stream: vi.fn(), oldContext: vi.fn(), add: vi.fn(), live: vi.fn(), document: vi.fn(), vision: vi.fn(), reserve: vi.fn(), renew: vi.fn(), settle: vi.fn(), status: vi.fn() }));
vi.mock('../src/server/lib/authMiddleware', async original => ({ ...await original<typeof import('../src/server/lib/authMiddleware')>(), verifyFirebaseToken: m.verify, verifyFirebaseIdentity: m.identity }));
vi.mock('../src/server/AI/FreeChain/entryAdmission', () => ({ withFreeChainEntryAdmission: (_req: unknown, _res: unknown, run: () => unknown) => { m.legacy(); return run(); } }));
vi.mock('../src/server/AI/FreeChain/requestContext', () => ({ freeChainRequestContext: m.oldContext }));
vi.mock('../src/server/lib/aiRouter', () => ({ aiRouter: { routeDetailed: m.detailed, routeStream: m.stream } }));
vi.mock('../src/server/lib/liveSearchContext', () => ({ liveSearchContext: m.live, needsLiveSearch: () => false }));
vi.mock('../src/server/lib/visionChain', () => ({ runVisionChain: m.vision }));
vi.mock('../src/server/lib/attachmentText', () => ({ buildDocumentContext: m.document }));
vi.mock('../src/server/lib/serverDb', async original => ({ ...await original<typeof import('../src/server/lib/serverDb')>(), getServerDb: () => null, collection: () => ({}), addDoc: m.add }));
vi.mock('../src/server/lib/freeAnswerQuotaStore', () => ({ FREE_ANSWER_LEASE_MS: 30_000, FREE_ANSWER_REQUEST_MS: 90_000, FreeAnswerQuotaStore: class {
  reserve = m.reserve; renew = m.renew; settle = m.settle; status = m.status;
} }));
vi.mock('../src/server/lib/imageEditRun', () => ({ checkEditable: () => ({ ok: false, outcome: { badInput: 'Test edit cannot be completed.' } }), runImageEdit: vi.fn() }));
import { registerChatRoutes } from '../src/server/routes/chat';
import { currentInferenceGatewayContext } from '../src/server/AI/InferenceGateway/runtime';
import { firestoreGuestUsageStore } from '../src/server/lib/guestDailyQuota';

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
function route(path = '/api/chat/navbharat') { return captureRoutes(registerChatRoutes as any, () => {}).get(`POST ${path}`)!; }
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off');
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off'); vi.stubEnv('GUEST_DAILY_MESSAGES', 'off'); vi.stubEnv('DOSE_DIRECT_ANSWER', 'off');
  m.verify.mockResolvedValue('verified-user'); m.identity.mockResolvedValue({ uid: 'verified-user' });
  m.live.mockResolvedValue(''); m.document.mockResolvedValue('document text'); m.oldContext.mockResolvedValue(undefined); m.add.mockResolvedValue(undefined);
  m.detailed.mockResolvedValue({ ok: true, content: 'A useful answer.', provider: 'synthetic', model: 'synthetic', latencyMs: 1 });
  m.stream.mockImplementation(async (...args: any[]) => { args[4]('A useful answer.'); return { ok: true, provider: 'synthetic', model: 'synthetic', latencyMs: 1 }; });
  m.reserve.mockImplementation(async (_subject, _id, now) => ({ allowed: true, reservation: { id: 'a'.repeat(64), owner: requestId, principalHash: 'b'.repeat(64), day: '2026-10-23', startedAt: now, deadlineAt: now + 90_000, leaseExpiresAt: now + 30_000 }, status: { limit: 20, used: 0, reserved: 1, remaining: 19, inProgress: true, day: '2026-10-23', resetsAt: now + 100_000 } }));
  m.renew.mockResolvedValue(true); m.settle.mockResolvedValue(true);
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('real chat ingress enforces shared answer admission without changing providers', () => {
  it.each(['/api/chat/navbharat', '/api/chat/navbharatai'])('enforces %s against only the verified account and does not activate gateway', async path => {
    const res = response();
    m.detailed.mockImplementationOnce(async () => { expect(currentInferenceGatewayContext()).toBeUndefined(); return { ok: true, content: 'A useful answer.' }; });
    await route(path)(request({ uid: 'victim', userId: 'victim', tier: 'paid', freeAnswerQuota: false }), res);
    expect(m.reserve).toHaveBeenCalledWith({ key: 'user:verified-user', limit: 20 }, requestId, expect.any(Number));
    expect(m.settle).toHaveBeenCalledWith(expect.any(Object), 'answered', expect.any(Number));
    expect(m.legacy).toHaveBeenCalledOnce(); expect(m.detailed).toHaveBeenCalledOnce();
    expect(res.body).toEqual({ reply: 'A useful answer.' });
  });
  it('uses five guest answers and trusted address backstop despite forged account metadata and old unlimited knob', async () => {
    m.verify.mockResolvedValue(null); m.identity.mockResolvedValue(null);
    const res = response(); await route()(request({ uid: 'victim', userId: 'victim', tenantId: 'victim' }), res);
    expect(m.reserve).toHaveBeenCalledWith({ key: 'guest-device:22222222-2222-4222-8222-222222222222', limit: 5, ipKey: 'ip:203.0.113.9' }, requestId, expect.any(Number));
    expect(res.body.reply).toBe('A useful answer.');
  });
  it.each(['daily-limit', 'busy', 'duplicate', 'attempt-limit'])('stops %s before documents, prompt lookup and inference', async reason => {
    m.reserve.mockResolvedValue({ allowed: false, reason });
    const res = response(); await route()(request({ fileAttachments: [{ type: 'text/plain', name: 'secret.txt', base64: 'QQ==' }] }), res);
    expect(res.statusCode).toBe(429); expect(res.body.code).toMatch(/^FREE_ANSWER_/);
    expect(m.document).not.toHaveBeenCalled(); expect(m.live).not.toHaveBeenCalled(); expect(m.detailed).not.toHaveBeenCalled();
    expect(m.stream).not.toHaveBeenCalled(); expect(m.settle).not.toHaveBeenCalled();
  });
  it('fails closed on storage outage without a paid or legacy inference fallback', async () => {
    m.reserve.mockRejectedValue(new Error('storage unavailable'));
    const res = response(); await route()(request(), res);
    expect(res.statusCode).toBe(503); expect(res.body.code).toBe('FREE_ANSWER_UNAVAILABLE');
    expect(m.legacy).not.toHaveBeenCalled(); expect(m.detailed).not.toHaveBeenCalled();
  });
  it('restores the answer reservation when the existing guest attempt backstop rejects before dispatch', async () => {
    vi.stubEnv('GUEST_DAILY_MESSAGES', '10'); m.verify.mockResolvedValue(null); m.identity.mockResolvedValue(null);
    const consume=vi.spyOn(firestoreGuestUsageStore,'consume').mockResolvedValue({allow:false,reason:'device'});
    const res=response(); await route()(request(),res);
    expect(consume).toHaveBeenCalledOnce(); expect(res.statusCode).toBe(403); expect(res.body.code).toBe('guest_limit_reached');
    expect(m.reserve.mock.calls[0][0]).toMatchObject({limit:5});
    expect(m.settle).toHaveBeenCalledWith(expect.any(Object),'provider-failed',expect.any(Number));
    expect(m.legacy).not.toHaveBeenCalled(); expect(m.detailed).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled(); expect(m.add).not.toHaveBeenCalled();
  });
  it('restores credit on a provider failure represented as HTTP200 reply text', async () => {
    m.detailed.mockResolvedValue({ ok: false, content: 'AI service temporarily busy.', reason: 'all-failed' });
    await route()(request(), response());
    expect(m.settle).toHaveBeenCalledWith(expect.any(Object), 'provider-failed', expect.any(Number));
  });
  it('does not count synthetic streamed notices as a useful answer', async () => {
    m.stream.mockImplementation(async (...args: any[]) => { args[4]('AI service temporarily busy.', 'notice'); return { ok: false, reason: 'all-failed' }; });
    const res = response(); await route()(request({ stream: true }), res);
    expect(res.chunks.join('')).toContain('temporarily busy');
    expect(m.settle).toHaveBeenCalledWith(expect.any(Object), 'provider-failed', expect.any(Number));
  });
  it('keeps a partially delivered answer charged and holds the slot until upstream settles after disconnect', async () => {
    const res = response(); let finish!: () => void;
    m.stream.mockImplementationOnce(async (...args: any[]) => {
      args[4]('A genuine partial answer.');
      await new Promise<void>(resolve => { finish = resolve; });
      return { ok: false, reason: 'aborted' };
    });
    const pending = route()(request({ stream: true }), res);
    await vi.waitFor(() => expect(m.stream).toHaveBeenCalledOnce());
    res.emit('close'); expect(m.settle).not.toHaveBeenCalled();
    finish(); await pending;
    expect(m.settle).toHaveBeenCalledTimes(1);
    expect(m.settle).toHaveBeenCalledWith(expect.any(Object), 'answered', expect.any(Number));
  });
  it('does not refund an uncertain no-output disconnect', async () => {
    const res = response(); let finish!: () => void;
    m.stream.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve; }); return { ok: false, reason: 'aborted' }; });
    const pending = route()(request({ stream: true }), res);
    await vi.waitFor(() => expect(m.stream).toHaveBeenCalledOnce()); res.emit('close'); finish(); await pending;
    expect(m.settle).toHaveBeenCalledWith(expect.any(Object), 'uncertain', expect.any(Number));
  });
  it('fences late output when the durable renewal loses ownership', async () => {
    vi.useFakeTimers();
    m.renew.mockResolvedValue(false);
    const res = response(); let finish!: () => void;
    m.stream.mockImplementationOnce(async (...args: any[]) => {
      await new Promise<void>(resolve => { finish = resolve; });
      args[4]('Late output from a fenced owner.');
      return { ok: true };
    });
    const pending = route()(request({ stream: true }), res);
    await vi.waitFor(() => expect(m.stream).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(m.renew).toHaveBeenCalledOnce();
    finish(); await pending;
    expect(res.chunks.join('')).not.toContain('Late output');
    expect(m.settle).toHaveBeenCalledWith(expect.any(Object), 'uncertain', expect.any(Number));
  });
  it('keeps actual image editing outside the answer allowance', async () => {
    const res = response(); await route()(request({ message: 'Make the shirt red', fileAttachments: [{ type: 'image/png', name: 'photo.png', base64: 'AAAA' }] }), res);
    expect(m.reserve).not.toHaveBeenCalled(); expect(m.settle).not.toHaveBeenCalled();
    expect(m.detailed).not.toHaveBeenCalled(); expect(m.vision).not.toHaveBeenCalled();
    expect(res.body.reply).toContain('Test edit cannot be completed.');
  });
});
