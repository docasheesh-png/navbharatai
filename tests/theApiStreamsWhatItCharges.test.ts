// 🌊 A STREAMING CLIENT GETS THE ANSWER IT PAID FOR (found 2026-09-23, in the API shipped the day before).
//
// Nothing in the developer API read `stream`. A chat UI built on a standard SDK almost always sends
// `stream: true`; it received a plain JSON body, parsed it as an event stream, found no events, and
// handed the developer an EMPTY answer — already charged to their wallet.
//
// The fix speaks the streaming protocol but carries the answer from the SAME measured call, in one
// piece, because the repo's streaming provider path reports no token counts and the ONE-WALLET law
// would then charge ₹0 — a free answer for every API caller. So the thing this file locks is parity:
// a streamed answer and a plain one cost EXACTLY the same, and both can actually be read.
//
// The end-to-end cases parse the response the way an SDK does — split on blank lines, strip `data: `,
// stop at `[DONE]` — because a test that only inspected our own builder would have passed while the
// original bug shipped.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../src/server/lib/professionalRouting', async () => {
  const { recordAiSpend } = await import('../src/server/lib/aiSpendZone');
  return {
    callProfessionalAIWithUsage: vi.fn(async (_system: string, prompt: string) => {
      const spend = { provider: 'GLM', model: 'glm-4.7-flash', inputTokens: 120, outputTokens: 30 };
      recordAiSpend(spend);
      return { content: `echo: ${prompt.slice(-40)}`, spend };
    }),
  };
});
vi.mock('../src/server/professionals/engine', async () => {
  const { recordAiSpend } = await import('../src/server/lib/aiSpendZone');
  return {
    runProfessionalChatWithUsage: vi.fn(async (_config: unknown, message: string) => {
      const spend = { provider: 'KIMI', model: 'kimi-k2.7-code', inputTokens: 200, outputTokens: 50 };
      recordAiSpend(spend);
      return { reply: `teacher says: ${message.slice(-30)}`, spend };
    }),
  };
});
vi.mock('../src/server/AgentV3/WalletBalance', () => ({
  firestoreWalletReader: () => ({}),
  readWalletBalanceInr: vi.fn(async () => 250),
}));
vi.mock('../src/server/lib/aiTurnCharge', () => ({
  chargeForAiTurns: vi.fn(async () => ({ charge: true, reason: 'charged', billedInr: 0.1, debited: true, tokensDebited: 10 })),
}));

import { wantsStream, wantsStreamUsage, chatCompletionStream, PUBLIC_MODEL_NAME } from '../src/server/lib/developerApi';
import { apiKeyStore } from '../src/server/lib/ApiKeyStore';
import { apiKeyUsageStore } from '../src/server/lib/ApiKeyUsageStore';
import { chargeForAiTurns } from '../src/server/lib/aiTurnCharge';
import { callProfessionalAIWithUsage } from '../src/server/lib/professionalRouting';
import { registerApiKeyRoutes } from '../src/server/routes/apiKeys';
import { registerDeveloperApiRoutes } from '../src/server/routes/developerApi';

const VENDOR = /\b(GLM|Z\.ai|Kimi|Moonshot|Claude|Anthropic|Gemini|Vertex|Grok|xAI|Bedrock|OpenAI|gpt)\b/i;

/** Parse an event-stream body exactly as a chat-completions SDK does. */
function readEvents(raw: string): { chunks: any[]; done: boolean } {
  const chunks: any[] = [];
  let done = false;
  for (const block of raw.split('\n\n')) {
    const line = block.trim();
    if (!line.startsWith('data: ')) continue;
    const data = line.slice('data: '.length);
    if (data === '[DONE]') { done = true; break; }
    chunks.push(JSON.parse(data));
  }
  return { chunks, done };
}
/** The text a client would assemble from the deltas. */
const assembled = (chunks: any[]) => chunks.map((c) => c.choices?.[0]?.delta?.content ?? '').join('');

// ── the pure builder ──────────────────────────────────────────────────────────────────────────

describe('reading the request', () => {
  it('only the literal `true` turns streaming on — a format change needs real consent', () => {
    expect(wantsStream({ stream: true })).toBe(true);
    for (const v of [false, 'true', 1, 'yes', null, undefined]) expect(wantsStream({ stream: v }), String(v)).toBe(false);
    expect(wantsStream(null)).toBe(false);
    expect(wantsStream('nonsense')).toBe(false);
  });

  it('the usage chunk is opt-in, by the standard spelling', () => {
    expect(wantsStreamUsage({ stream: true, stream_options: { include_usage: true } })).toBe(true);
    expect(wantsStreamUsage({ stream: true })).toBe(false);
    expect(wantsStreamUsage({ stream_options: { include_usage: 'true' } })).toBe(false);
    expect(wantsStreamUsage({ stream_options: null })).toBe(false);
  });
});

describe('chatCompletionStream — the events themselves', () => {
  const opts = { id: 'x1', createdMs: 1_700_000_000_000 };

  it('the whole answer arrives, then a stop, then [DONE] — in that order', () => {
    const { chunks, done } = readEvents(chatCompletionStream('Namaste, GST is a tax.', opts).join(''));
    expect(done).toBe(true);
    expect(assembled(chunks)).toBe('Namaste, GST is a tax.');
    expect(chunks[0].choices[0].delta.role).toBe('assistant');
    expect(chunks[chunks.length - 1].choices[0].finish_reason).toBe('stop');
    for (const c of chunks) {
      expect(c.object).toBe('chat.completion.chunk');
      expect(c.model).toBe(PUBLIC_MODEL_NAME);
      expect(c.id).toBe('chatcmpl-x1');
    }
  });

  it('an answer containing newlines, quotes and a literal blank line survives the framing intact', () => {
    // A raw "\n\n" inside the content would end an event early if it were not JSON-encoded.
    const tricky = 'line one\n\nline "two"\n\ndata: [DONE]\nend';
    const { chunks, done } = readEvents(chatCompletionStream(tricky, opts).join(''));
    expect(done).toBe(true);
    expect(assembled(chunks)).toBe(tricky);
  });

  it('usage is sent only when it was ASKED for AND measured — never a zero dressed as a count', () => {
    const measured = { inputTokens: 120, outputTokens: 30 };
    const withUsage = readEvents(chatCompletionStream('a', { ...opts, includeUsage: true, usage: measured }).join('')).chunks;
    const last = withUsage[withUsage.length - 1];
    expect(last.choices).toEqual([]);
    expect(last.usage).toEqual({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 });

    const notAsked = readEvents(chatCompletionStream('a', { ...opts, usage: measured }).join('')).chunks;
    expect(notAsked.some((c) => c.usage)).toBe(false);

    for (const usage of [null, undefined, { inputTokens: 0, outputTokens: 0 }, {}]) {
      const unmeasured = readEvents(chatCompletionStream('a', { ...opts, includeUsage: true, usage }).join('')).chunks;
      expect(unmeasured.some((c) => c.usage), JSON.stringify(usage)).toBe(false);
    }
  });

  it('an expert answers under its own brand name', () => {
    const { chunks } = readEvents(chatCompletionStream('a', { ...opts, model: 'navbharatai/teacher_ai' }).join(''));
    for (const c of chunks) expect(c.model).toBe('navbharatai/teacher_ai');
  });
});

// ── end to end, through the real route ─────────────────────────────────────────────────────────

type Handler = (req: any, res: any, next?: () => void) => unknown;
function fakeApp() {
  const routes = new Map<string, Handler[]>();
  const reg = (method: string) => (path: string, ...handlers: Handler[]) => { routes.set(`${method} ${path}`, handlers); };
  return { app: { get: reg('GET'), post: reg('POST'), patch: reg('PATCH'), delete: reg('DELETE') } as any, routes };
}
/** A response that records EVERYTHING a real one would put on the wire — headers, writes and JSON. */
function wireRes() {
  const res: any = { statusCode: 200, headers: {} as Record<string, string>, written: '', json: undefined as unknown, ended: false };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; return res; };
  res.write = (chunk: string) => { res.written += chunk; return true; };
  res.end = () => { res.ended = true; return res; };
  res.json = (b: unknown) => { res.json = b; res.headers['content-type'] = 'application/json'; res.ended = true; return res; };
  return res;
}
async function run(handlers: Handler[], req: any) {
  const res = wireRes();
  for (const h of handlers) {
    let advanced = false;
    await h(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

describe('🔒 THROUGH THE ROUTE — what a streaming SDK actually receives', () => {
  const { app, routes } = fakeApp();
  registerApiKeyRoutes(app);
  registerDeveloperApiRoutes(app);
  const chat = routes.get('POST /api/chat/completions')!;
  const expert = routes.get('POST /api/professionals/:id/chat')!;
  const withKey = (scopes: string[]) =>
    vi.spyOn(apiKeyStore, 'findByHash').mockResolvedValue({ userId: 'u1', keyId: 'k1', scopes, dailyCapInr: 50 });
  const req = (body: unknown, params: Record<string, string> = {}) =>
    ({ headers: { 'x-api-key': 'nbai_test', 'user-agent': 't' }, body, ip: '1.1.1.1', params, query: {} });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiKeyStore, 'touchLastUsed').mockResolvedValue(undefined);
    vi.spyOn(apiKeyUsageStore, 'spentToday').mockResolvedValue({ spentInr: 0, calls: 0, known: true });
    vi.spyOn(apiKeyUsageStore, 'record').mockResolvedValue(undefined);
    (chargeForAiTurns as unknown as ReturnType<typeof vi.fn>).mockClear();
    (callProfessionalAIWithUsage as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('🔒 `stream: true` gets a REAL event stream carrying the whole answer — not an empty one', async () => {
    withKey(['ai:chat']);
    const res = await run(chat, req({ stream: true, messages: [{ role: 'user', content: 'What is GST?' }] }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.ended).toBe(true);
    const { chunks, done } = readEvents(res.written);
    expect(done).toBe(true);
    expect(assembled(chunks)).toContain('What is GST?');
    expect(chunks[chunks.length - 1].choices[0].finish_reason).toBe('stop');
  });

  it('🔒 a streamed answer is charged EXACTLY like a plain one — once, from the same measured call', async () => {
    withKey(['ai:chat']);
    await run(chat, req({ stream: true, messages: [{ role: 'user', content: 'hi' }] }));
    await new Promise((r) => setTimeout(r, 0));
    const streamed = (chargeForAiTurns as any).mock.calls.map((c: any[]) => c[2]);
    expect(callProfessionalAIWithUsage).toHaveBeenCalledTimes(1);

    (chargeForAiTurns as any).mockClear();
    await run(chat, req({ messages: [{ role: 'user', content: 'hi' }] }));
    await new Promise((r) => setTimeout(r, 0));
    const plain = (chargeForAiTurns as any).mock.calls.map((c: any[]) => c[2]);

    expect(streamed).toHaveLength(1);
    expect(streamed).toEqual(plain);
    // The spend it charged is a MEASURED one — the thing a live token stream could not have provided.
    expect(streamed[0][0]).toMatchObject({ inputTokens: 120, outputTokens: 30 });
  });

  it('`stream_options.include_usage` gets the measured counts in the final chunk', async () => {
    withKey(['ai:chat']);
    const res = await run(chat, req({ stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content: 'hi' }] }));
    const { chunks } = readEvents(res.written);
    expect(chunks[chunks.length - 1].usage).toEqual({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 });
  });

  it('🔒 a refusal is ordinary JSON with its status — an SDK reads the status before it reads a stream', async () => {
    withKey(['read:profile']);
    const res = await run(chat, req({ stream: true, messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.statusCode).toBe(403);
    expect(res.written).toBe('');
    expect((res.json as any).error.code).toBe('missing_scope');
    expect(callProfessionalAIWithUsage).not.toHaveBeenCalled();
    expect(chargeForAiTurns).not.toHaveBeenCalled();
  });

  it('without `stream`, nothing changed — the same JSON body as before', async () => {
    withKey(['ai:chat']);
    const res = await run(chat, req({ messages: [{ role: 'user', content: 'What is GST?' }] }));
    expect(res.written).toBe('');
    expect((res.json as any).object).toBe('chat.completion');
    expect((res.json as any).choices[0].message.content).toContain('What is GST?');
  });

  it('🔒 an EXPERT streams too — through the plain door by model name, and through its own door', async () => {
    withKey(['ai:chat', 'ai:professionals']);
    const byModel = await run(chat, req({ stream: true, model: 'navbharatai/teacher_ai', messages: [{ role: 'user', content: 'explain photosynthesis' }] }));
    const a = readEvents(byModel.written);
    expect(a.done).toBe(true);
    expect(assembled(a.chunks)).toContain('teacher says:');
    for (const c of a.chunks) expect(c.model).toBe('navbharatai/teacher_ai');

    const byDoor = await run(expert, req({ stream: true, messages: [{ role: 'user', content: 'explain photosynthesis' }] }, { id: 'teacher_ai' }));
    const b = readEvents(byDoor.written);
    expect(b.done).toBe(true);
    expect(assembled(b.chunks)).toContain('teacher says:');
  });

  it('🔒 WHITE-LABEL: no chunk names the vendor that answered', async () => {
    withKey(['ai:chat', 'ai:professionals']);
    const res = await run(chat, req({ stream: true, stream_options: { include_usage: true }, model: 'navbharatai/teacher_ai', messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.written).not.toMatch(VENDOR);
  });
});

// ── the design, locked at the source ───────────────────────────────────────────────────────────

describe('🔒 SOURCE — the stream is built from the measured call, never a live provider stream', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/developerApi.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  it('no door in the developer API reaches a streaming provider path — it would report no usage, and bill ₹0', () => {
    for (const unmeasured of ['routeStream(', 'executeStream(', 'routeStream', 'onChunk']) {
      expect(route, unmeasured).not.toContain(unmeasured);
    }
  });

  it('both chat doors answer through ONE writer, so they cannot drift on streaming', () => {
    expect((route.match(/function sendCompletion\(/g) || []).length).toBe(1);
    expect((route.match(/sendCompletion\(res,/g) || []).length).toBe(2);
    expect(route).not.toMatch(/res\.status\(200\)\.json\(chatCompletionResponse\(/);
  });
});
