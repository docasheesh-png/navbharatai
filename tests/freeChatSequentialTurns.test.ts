import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { captureRoutes, mockReq } from './helpers/routeTestUtils';

const m = vi.hoisted(() => ({ database: null as unknown, execute: vi.fn(), add: vi.fn(), legacy: vi.fn(), live: vi.fn() }));
vi.mock('../src/server/lib/authMiddleware', async original => ({
  ...await original<typeof import('../src/server/lib/authMiddleware')>(),
  verifyFirebaseToken: async (req: { headers: Record<string, string> }) => req.headers['x-test-principal'] ?? 'sequential-user',
  verifyFirebaseIdentity: async (req: { headers: Record<string, string> }) => ({ uid: req.headers['x-test-principal'] ?? 'sequential-user', email: null, emailVerified: false }),
}));
vi.mock('../src/server/lib/serverDb', async original => ({
  ...await original<typeof import('../src/server/lib/serverDb')>(),
  getServerDb: () => m.database, collection: () => ({}), addDoc: m.add,
}));
vi.mock('../src/server/AI/AIRouterManager', () => ({ AIRouterManager: { getRouter: m.legacy } }));
vi.mock('../src/server/lib/liveSearchContext', () => ({ liveSearchContext: m.live, needsLiveSearch: () => false }));
vi.mock('../src/server/AI/FreeChain/providers/openAiCompatProvider', () => ({
  OpenAiCompatProvider: class { constructor(readonly config: unknown) {} executeTurn(input: unknown) { return m.execute(input, this.config); } },
  FreeChainProviderError: class extends Error { constructor(readonly code: string) { super(code); } },
}));
import { registerChatRoutes } from '../src/server/routes/chat';
import { registerFreeAnswerQuotaRoutes } from '../src/server/lib/freeAnswerQuota';
import { freeChainAdmissionQueue } from '../src/server/AI/FreeChain/admissionQueue';
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
import { FreeChainProviderError } from '../src/server/AI/FreeChain/providers/openAiCompatProvider';
import { runWithInferenceScope } from '../src/server/AI/inferencePolicy';

/** Native Firestore snapshots expose exists as a property, and Dates return as Timestamps. */
function stored(value: unknown): any {
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (value instanceof Timestamp) return new Timestamp(value.seconds, value.nanoseconds);
  if (Array.isArray(value)) return value.map(stored);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, stored(child)]));
  return value;
}
function database() {
  const docs = new Map<string, any>();
  let serial = Promise.resolve();
  function ref(path: string): any {
    return { path, get: async () => snapshot(path), set: async (value: unknown) => { docs.set(path, stored(value)); },
      collection: (name: string) => collection(`${path}/${name}`) };
  }
  function collection(path: string): any { return { doc: (id: string) => ref(`${path}/${id}`) }; }
  function snapshot(path: string) { return { exists: docs.has(path), data: () => stored(docs.get(path)) }; }
  const db = {
    doc: ref, collection,
    runTransaction: (run: (tx: any) => Promise<unknown>) => {
      const result = serial.then(async () => {
        const writes = new Map<string, unknown>();
        const value = await run({
          get: async (target: { path: string }) => { if (writes.size) throw new Error('Read after write'); return snapshot(target.path); },
          set: (target: { path: string }, value: unknown) => writes.set(target.path, stored(value)),
        });
        for (const [path, value] of writes) docs.set(path, value);
        return value;
      });
      serial = result.then(() => {}, () => {});
      return result;
    },
  };
  return { db: db as unknown as Firestore, docs };
}
class ResponseFixture extends EventEmitter {
  statusCode = 200;
  body: any;
  headersSent = false;
  writableFinished = false;
  writableEnded = false;
  destroyed = false;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  status(code: number) { this.statusCode = code; return this; }
  setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; }
  flushHeaders() { this.headersSent = true; }
  write(chunk: string) { this.chunks.push(chunk); return true; }
  json(value: unknown) { this.body = value; this.headersSent = true; return this.end(); }
  end(chunk?: string) { if (chunk !== undefined) this.write(chunk); this.writableFinished = true; this.writableEnded = true; this.emit('finish'); this.emit('close'); return this; }
  disconnect() { this.destroyed = true; this.emit('close'); }
}
const requestId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function request(n: number, body: Record<string, unknown> = {}, uid = 'sequential-user') {
  return mockReq({ body: { message: 'Tell me about triangles.', ...body }, headers: { 'x-nb-answer-request': requestId(n), 'x-test-principal': uid } });
}
function route(path = '/api/chat/navbharatai') {
  const handler = captureRoutes(registerChatRoutes as any, () => {}).get(`POST ${path}`)!;
  return (req: ReturnType<typeof request>, res: ResponseFixture) => runWithInferenceScope('free-modules', () => handler(req, res));
}
async function status(uid = 'sequential-user') {
  const res = new ResponseFixture();
  await captureRoutes(registerFreeAnswerQuotaRoutes as any).get('GET /api/free-answers/status')!(request(999, {}, uid), res);
  expect(res.statusCode).toBe(200);
  return res.body;
}
function successful(input: { onChunk: (text: string) => void }, config: { provider: string; model: string }) {
  input.onChunk('A synthetic useful answer.');
  return { content: 'A synthetic useful answer.', provider: config.provider, model: config.model, latencyMs: 1,
    completeUsage: true, usage: { inputTokens: 10, outputTokens: 5 }, rateLimitHeaders: {} };
}
beforeEach(() => {
  vi.clearAllMocks(); resetAllBreakers();
  m.database = database().db;
  m.add.mockResolvedValue(undefined); m.live.mockResolvedValue(''); m.execute.mockImplementation(successful);
  m.legacy.mockImplementation(() => { throw new Error('Unexpected legacy provider dispatch'); });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Real network is forbidden in this fixture'); }));
  const env = {
    FREE_CHAIN_ENABLED: 'on', FREE_CHAIN_ROLLOUT_PERCENT: '100', FREE_CHAIN_ORDER: 'groq,cloudflare',
    FREE_CHAIN_GROQ_API_KEY: 'synthetic-test-key', FREE_CHAIN_GROQ_FREE_VERIFIED_UNTIL: '2099-01-01',
    FREE_CHAIN_CF_API_TOKEN: 'synthetic-test-key', FREE_CHAIN_CF_FREE_VERIFIED_UNTIL: '2099-01-01', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    // Synthetic provider ceilings. The assertion below is the signed-in user ledger.
    // Production Groq RPM and Cloudflare neuron caps are separate protections; they are
    // not this user's 50-answer ceiling, and a refusal there still refunds the credit.
    FREE_CHAIN_GROQ_RPM: '1000', FREE_CHAIN_GROQ_RPD: '10000', FREE_CHAIN_GROQ_TPM: '100000000', FREE_CHAIN_GROQ_TPD: '100000000',
    FREE_CHAIN_CF_TPM: '1000000', FREE_CHAIN_CF_TPD: '10000000',
    FREE_CHAIN_CACHE_ENABLED: 'off', FREE_CHAIN_MONTHLY_CAP_ENABLED: 'off', FREE_CHAIN_PAID_DAILY_CAP_USD: '0',
    CHEAPERINFERENCE: 'off', STRICT_FREE_MODULES_ENABLED: 'off', INFERENCE_GATEWAY_ENABLED: 'off',
    GUEST_DAILY_MESSAGES: 'off', DOSE_DIRECT_ANSWER: 'off', UNIFIED_WALLET_ENABLED: 'off', UNIFIED_WALLET_FREE_LIMIT: 'off',
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  expect(freeChainAdmissionQueue.snapshot()).toEqual({ active: 0, queued: 0, activeUsers: 0, queuedUsers: 0 });
  expect(m.legacy).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});

describe('registered Free Chat routes with real user quota, admission queue and FreeChain storage', () => {
  it.each(['/api/chat/navbharat', '/api/chat/navbharatai'])('%s releases all ownership after success and serves a second turn with history', async path => {
    const send = route(path);
    for (let n = 1; n <= 2; n++) {
      const res = new ResponseFixture();
      await send(request(n, n === 2 ? { message: 'Why?', history: [{ sender: 'user', text: 'Tell me about triangles.' }, { sender: 'ai', text: 'A synthetic useful answer.' }] } : {}), res);
      expect(res.statusCode).toBe(200); expect(res.body.reply).toBe('A synthetic useful answer.');
      expect(await status()).toMatchObject({ used: n, reserved: 0, remaining: 50 - n, inProgress: false });
    }
    expect(m.execute).toHaveBeenCalledTimes(2);
    expect(m.execute.mock.calls.map(call => call[1].provider)).toEqual(['GROQ', 'GROQ']);
  });
  it('counts 25 unique successful turns, ignores a replay, and blocks only the 51st', async () => {
    const send = route('/api/chat/navbharat');
    const sibling = route('/api/chat/navbharatai');
    for (let n = 1; n <= 24; n++) {
      const res = new ResponseFixture();
      await send(request(n, { message: `Unique question ${n}`, stream: true }), res);
      expect(res.chunks.join('')).toContain('A synthetic useful answer.');
      expect(res.chunks.join('')).toContain('[DONE]');
    }
    const siblingRes = new ResponseFixture();
    await sibling(request(25, { message: 'Unique question 25', stream: true }), siblingRes);
    expect(siblingRes.chunks.join('')).toContain('[DONE]');
    expect(await status()).toMatchObject({ limit: 50, used: 25, reserved: 0, remaining: 25, inProgress: false });
    const replay = new ResponseFixture();
    await send(request(1, { message: 'Unique question 1 again', stream: true }), replay);
    expect(replay.statusCode).toBe(429);
    expect(replay.body.code).toBe('FREE_ANSWER_DUPLICATE');
    expect(await status()).toMatchObject({ used: 25, remaining: 25, inProgress: false });
    for (let n = 26; n <= 50; n++) {
      const res = new ResponseFixture();
      await send(request(n, { message: `Unique question ${n}`, stream: true }), res);
      expect(res.chunks.join('')).toContain('[DONE]');
      expect(res.chunks.join('')).toContain('A synthetic useful answer.');
    }
    expect(await status()).toMatchObject({ used: 50, remaining: 0, inProgress: false });
    const blocked = new ResponseFixture();
    await send(request(51, { message: 'One past the shared ceiling', stream: true }), blocked);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body.code).toBe('FREE_ANSWER_DAILY_LIMIT');
    expect(await status()).toMatchObject({ used: 50, remaining: 0 });
    expect(await status('another-ordinary-user')).toMatchObject({ used: 0, remaining: 50 });
  });
  it('a provider fallback still charges the logical answer once', async () => {
    m.execute.mockRejectedValueOnce(new FreeChainProviderError('TIMEOUT'));
    const res = new ResponseFixture();
    await route()(request(1, { stream: true }), res);
    expect(res.chunks.join('')).toContain('A synthetic useful answer.');
    expect(m.execute.mock.calls.length).toBeGreaterThan(1);
    expect(await status()).toMatchObject({ used: 1, remaining: 49, reserved: 0, inProgress: false });
  });
  it('preserves a requested script through real-route follow-ups and provider fallback', async () => {
    const history: Array<{ sender: string; text: string }> = [];
    const messages = ['India ki rajdhani kya hai? Ek chhota jawab.', 'devnaagri me bataao', 'wahan ka ek prasiddh smarak batao.'];
    for (let i = 0; i < messages.length; i++) {
      if (i === 1) m.execute.mockRejectedValueOnce(new FreeChainProviderError('RATE_LIMIT'));
      const res = new ResponseFixture();
      await route()(request(i + 1, { message: messages[i], history, stream: true }), res);
      expect(res.chunks.join('')).toContain('[DONE]');
      history.push({ sender: 'user', text: messages[i] }, { sender: 'ai', text: 'A synthetic answer.' });
    }
    expect(m.execute).toHaveBeenCalledTimes(4);
    expect(m.execute.mock.calls.map(call => call[1].provider)).toEqual(['GROQ', 'GROQ', 'CLOUDFLARE', 'CLOUDFLARE']);
    for (const [input] of m.execute.mock.calls.slice(1)) {
      expect(input.systemPrompt).toContain('Hindi using Devanagari script, not Romanized Hindi or Hinglish');
      expect(input.systemPrompt).not.toContain('Reply in Hinglish using Roman script.');
    }
    expect(await status()).toMatchObject({ used: 3, reserved: 0, remaining: 47, inProgress: false });
  });
  it('keeps the real streaming sibling available after its first completed reply', async () => {
    for (let n = 1; n <= 2; n++) {
      const res = new ResponseFixture(); await route()(request(n, { stream: true }), res);
      expect(res.chunks.join('')).toContain('A synthetic useful answer.');
      expect(res.chunks.join('')).toContain('[DONE]');
      expect(res.chunks.join('')).not.toContain('CHAT_ROUTE_UNAVAILABLE');
    }
    expect(m.execute).toHaveBeenCalledTimes(2);
    expect(await status()).toMatchObject({ used: 2, reserved: 0, remaining: 48, inProgress: false });
  });
  it('does not consume an answer on no-output terminal failure, and a new request can succeed', async () => {
    m.execute.mockRejectedValueOnce(new FreeChainProviderError('INVALID_REQUEST'));
    const failed = new ResponseFixture(); await route()(request(1), failed);
    expect(failed.statusCode).toBe(503); expect(failed.body.code).toBe('CHAT_ROUTE_UNAVAILABLE');
    expect(await status()).toMatchObject({ used: 0, remaining: 50, inProgress: false });
    const retried = new ResponseFixture(); await route()(request(2, { message: 'Why?' }), retried);
    expect(retried.statusCode).toBe(200); expect(await status()).toMatchObject({ used: 1, remaining: 49, inProgress: false });
  });
  it('falls back after the first provider fails and keeps serving on the next user turn', async () => {
    m.execute.mockRejectedValueOnce(new FreeChainProviderError('RATE_LIMIT'));
    const first = new ResponseFixture(); await route()(request(1), first);
    const second = new ResponseFixture(); await route()(request(2), second);
    expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(200);
    expect(m.execute.mock.calls.map(call => call[1].provider)).toEqual(['GROQ', 'CLOUDFLARE', 'CLOUDFLARE']);
    expect(await status()).toMatchObject({ used: 2, remaining: 48, inProgress: false });
  });
  it('rejects concurrent same-account work while allowing another account, then releases the first account', async () => {
    let release!: () => void;
    m.execute.mockImplementationOnce(async (input, config) => { await new Promise<void>(resolve => { release = resolve; }); return successful(input, config); });
    const first = new ResponseFixture(); const pending = route()(request(1), first);
    await vi.waitFor(() => expect(m.execute).toHaveBeenCalledTimes(1));
    const blocked = new ResponseFixture(); await route()(request(2), blocked);
    expect(blocked.statusCode).toBe(429); expect(blocked.body.code).toBe('FREE_ANSWER_BUSY');
    const other = new ResponseFixture(); await route()(request(1, {}, 'another-user'), other);
    expect(other.statusCode).toBe(200);
    release(); await pending;
    const next = new ResponseFixture(); await route()(request(3), next);
    expect(next.statusCode).toBe(200); expect(await status()).toMatchObject({ used: 2, remaining: 48, inProgress: false });
  });
  it('releases a disconnected no-output request after upstream abort and admits the next turn', async () => {
    m.execute.mockImplementationOnce((input: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(new FreeChainProviderError('ABORTED')), { once: true });
    }));
    const first = new ResponseFixture(); const pending = route()(request(1), first);
    await vi.waitFor(() => expect(m.execute).toHaveBeenCalledOnce()); first.disconnect(); await pending;
    expect(await status()).toMatchObject({ used: 1, remaining: 49, inProgress: false });
    const next = new ResponseFixture(); await route()(request(2), next);
    expect(next.statusCode).toBe(200); expect(await status()).toMatchObject({ used: 2, remaining: 48, inProgress: false });
  });
});
