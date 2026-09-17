// THE NAVBHARATAI API — "api keys farzi nahi ho, kam kare" (admin 2026-09-17).
//
// The API Keys card at the bottom of My Profile offered three scopes and enforced one. This suite is
// the contract that every scope now opens a real door, that the AI door spends the ONE wallet under a
// per-key ceiling, and that nothing a developer receives ever names the vendor behind the answer.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The real `callProfessionalAIWithUsage` RECORDS its spend into the ambient spend zone (aiSpendZone.ts);
// the route reads the zone, never the return value — so the stand-in must record the same way, or the
// route honestly reports "unmeasured" and the test would be checking a shape the product never emits.
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
vi.mock('../src/server/AgentV3/WalletBalance', () => ({
  firestoreWalletReader: () => ({}),
  readWalletBalanceInr: vi.fn(async () => 250),
}));
vi.mock('../src/server/lib/aiTurnCharge', () => ({
  chargeForAiTurns: vi.fn(async () => ({ charge: false, reason: 'disabled', billedInr: 0, debited: false, tokensDebited: 0 })),
}));

import { API_SCOPES, API_SCOPE_DESCRIPTIONS, normalizeScopes } from '../src/server/lib/ApiKeyManager';
import {
  normalizeDailyCapInr, DEFAULT_KEY_DAILY_CAP_INR, MAX_KEY_DAILY_CAP_INR,
  readChatCompletionRequest, foldMessagesToPrompt, keyDecision, chatCompletionResponse, apiError,
  refusalMessage, refusalStatus, takeRateSlot, KEY_REQUESTS_PER_MINUTE, SCOPE_ROUTES, PUBLIC_MODEL_NAME,
  DEVELOPER_API_SYSTEM_PROMPT, MAX_CHAT_MESSAGES, MAX_CHAT_TOTAL_CHARS,
} from '../src/server/lib/developerApi';
import { apiKeyStore } from '../src/server/lib/ApiKeyStore';
import { apiKeyUsageStore } from '../src/server/lib/ApiKeyUsageStore';
import { chargeForAiTurns } from '../src/server/lib/aiTurnCharge';
import { callProfessionalAIWithUsage } from '../src/server/lib/professionalRouting';
import { registerApiKeyRoutes } from '../src/server/routes/apiKeys';
import { registerDeveloperApiRoutes } from '../src/server/routes/developerApi';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const VENDOR = /\b(GLM|Z\.ai|Kimi|Moonshot|Claude|Anthropic|Gemini|Vertex|Grok|xAI|Bedrock|OpenAI|gpt)\b/i;

// ── 1 · every scope is a real door ─────────────────────────────────────────────────────────────

describe('🔴 every scope a user can tick opens a real endpoint', () => {
  it('the four scopes exist, are described in plain words, and each names its route', () => {
    expect([...API_SCOPES]).toEqual(['read:profile', 'read:usage', 'read:builds', 'ai:chat']);
    for (const s of API_SCOPES) {
      expect(API_SCOPE_DESCRIPTIONS[s].title.length).toBeGreaterThan(2);
      expect(API_SCOPE_DESCRIPTIONS[s].detail.length).toBeGreaterThan(10);
      expect(SCOPE_ROUTES[s].path.startsWith('/api/v1/')).toBe(true);
    }
  });

  it('🔒 …and the route each scope names is REGISTERED and GUARDED by that scope', () => {
    const keys = read('src/server/routes/apiKeys.ts');
    const dev = read('src/server/routes/developerApi.ts');
    const src = keys + dev;
    for (const s of API_SCOPES) {
      const r = SCOPE_ROUTES[s];
      const unversioned = r.path.replace('/api/v1/', '/api/');
      // `app.get('/api/usage', …, requireScope('read:usage')` — the scope on the same registration.
      const re = new RegExp(`app\\.${r.method.toLowerCase()}\\('${unversioned.replace(/[/]/g, '\\/')}'[^\\n]*requireScope\\('${s.replace(':', '\\:')}'\\)`);
      expect(src, `${s} must guard ${r.method} ${r.path}`).toMatch(re);
    }
  });

  it('the scope descriptions never name a vendor (they are shown to users)', () => {
    for (const s of API_SCOPES) expect(`${API_SCOPE_DESCRIPTIONS[s].title} ${API_SCOPE_DESCRIPTIONS[s].detail}`).not.toMatch(VENDOR);
  });

  it('normalizeScopes accepts the new scope and still drops junk', () => {
    expect(normalizeScopes(['ai:chat', 'bogus', 'ai:chat'])).toEqual(['ai:chat']);
  });

  it('🔒 /me no longer hands out usage to a key that only has read:profile', () => {
    const keys = read('src/server/routes/apiKeys.ts');
    expect(keys).toContain("const canReadUsage = hasScope(auth.scopes, 'read:usage');");
    expect(keys).toMatch(/canReadUsage\s*\?\s*userCostStore\.get\(auth\.userId\)/);
  });
});

// ── 2 · the daily cap ──────────────────────────────────────────────────────────────────────────

describe('the per-key daily cap — a leaked key can cost at most one day', () => {
  it('blank or junk means the default, never zero and never unlimited', () => {
    expect(normalizeDailyCapInr(undefined)).toBe(DEFAULT_KEY_DAILY_CAP_INR);
    expect(normalizeDailyCapInr('')).toBe(DEFAULT_KEY_DAILY_CAP_INR);
    expect(normalizeDailyCapInr('lots')).toBe(DEFAULT_KEY_DAILY_CAP_INR);
    expect(normalizeDailyCapInr(0)).toBe(1);
    expect(normalizeDailyCapInr(-5)).toBe(1);
    expect(normalizeDailyCapInr(10_000)).toBe(MAX_KEY_DAILY_CAP_INR);
    expect(normalizeDailyCapInr('75')).toBe(75);
    expect(normalizeDailyCapInr(75.6)).toBe(76);
  });

  it('the cap comes BEFORE the wallet, and bites even on a rich account', () => {
    expect(keyDecision({ spentTodayInr: 50, capInr: 50, walletBalanceInr: 5000, freeListed: false })).toEqual({ allow: false, reason: 'key-cap' });
    expect(keyDecision({ spentTodayInr: 49.99, capInr: 50, walletBalanceInr: 5000, freeListed: false })).toEqual({ allow: true });
  });

  it('🔒 the cap bites for a free-listed account too — a leaked key is a leaked key whoever owns it', () => {
    expect(keyDecision({ spentTodayInr: 50, capInr: 50, walletBalanceInr: null, freeListed: true })).toEqual({ allow: false, reason: 'key-cap' });
  });

  it('an empty wallet is refused before any model is called; free-listed accounts are not', () => {
    expect(keyDecision({ spentTodayInr: 0, capInr: 50, walletBalanceInr: 0, freeListed: false })).toEqual({ allow: false, reason: 'wallet-empty' });
    expect(keyDecision({ spentTodayInr: 0, capInr: 50, walletBalanceInr: -3, freeListed: false })).toEqual({ allow: false, reason: 'wallet-empty' });
    expect(keyDecision({ spentTodayInr: 0, capInr: 50, walletBalanceInr: 0, freeListed: true })).toEqual({ allow: true });
  });

  it('an UNREADABLE balance is allowed through — fail-open, like every other money gate here', () => {
    expect(keyDecision({ spentTodayInr: 0, capInr: 50, walletBalanceInr: null, freeListed: false })).toEqual({ allow: true });
  });

  it('a junk cap falls back to the default rather than to "no cap"', () => {
    expect(keyDecision({ spentTodayInr: DEFAULT_KEY_DAILY_CAP_INR, capInr: NaN, walletBalanceInr: 100, freeListed: false })).toEqual({ allow: false, reason: 'key-cap' });
  });

  it('the refusal names whose limit it is, and the status is the standard one', () => {
    expect(refusalMessage('key-cap', 50)).toContain('₹50');
    expect(refusalMessage('key-cap', 50)).toContain('Developer Tools');
    expect(refusalStatus('key-cap')).toBe(429);
    expect(refusalMessage('wallet-empty', 50)).toMatch(/wallet is empty/);
    expect(refusalStatus('wallet-empty')).toBe(402);
    expect(refusalMessage('key-cap', 50) + refusalMessage('wallet-empty', 50)).not.toMatch(VENDOR);
  });
});

// ── 3 · the OpenAI-compatible shape ────────────────────────────────────────────────────────────

describe('the chat request is read the way every AI SDK sends it', () => {
  it('messages in, system folded, last user turn required', () => {
    const v = readChatCompletionRequest({ messages: [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'what is GST?' },
    ] });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.system).toBe('Be brief.');
      expect(v.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    }
  });

  it('a bare `prompt` string is accepted as a courtesy', () => {
    const v = readChatCompletionRequest({ prompt: 'namaste' });
    expect(v.ok && v.messages[0].content).toBe('namaste');
  });

  it('OpenAI content parts are accepted; anything but text is refused', () => {
    expect(readChatCompletionRequest({ messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }] }).ok).toBe(true);
    expect(readChatCompletionRequest({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }] })).toEqual({ ok: false, reason: 'bad-message' });
  });

  it('refuses the shapes that would waste a call, each with its own reason', () => {
    expect(readChatCompletionRequest({})).toEqual({ ok: false, reason: 'no-messages' });
    expect(readChatCompletionRequest(null)).toEqual({ ok: false, reason: 'no-messages' });
    expect(readChatCompletionRequest({ messages: [{ role: 'user', content: '   ' }] })).toEqual({ ok: false, reason: 'no-user-turn' });
    expect(readChatCompletionRequest({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] })).toEqual({ ok: false, reason: 'no-user-turn' });
    expect(readChatCompletionRequest({ messages: [{ role: 'tool', content: 'x' }, { role: 'user', content: 'y' }] })).toEqual({ ok: false, reason: 'bad-message' });
    expect(readChatCompletionRequest({ messages: [{ role: 'user', content: 42 }] })).toEqual({ ok: false, reason: 'bad-message' });
    expect(readChatCompletionRequest({ messages: Array.from({ length: MAX_CHAT_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' })) })).toEqual({ ok: false, reason: 'too-many' });
    expect(readChatCompletionRequest({ messages: [{ role: 'user', content: 'x'.repeat(MAX_CHAT_TOTAL_CHARS + 1) }] })).toEqual({ ok: false, reason: 'too-long' });
  });

  it('folds a conversation into one prompt the shared chain can answer, keeping the thread', () => {
    expect(foldMessagesToPrompt([{ role: 'user', content: 'only' }])).toBe('only');
    const folded = foldMessagesToPrompt([
      { role: 'user', content: 'My name is Asha.' }, { role: 'assistant', content: 'Hi Asha.' }, { role: 'user', content: 'What is my name?' },
    ]);
    expect(folded).toContain('User: My name is Asha.');
    expect(folded).toContain('Assistant: Hi Asha.');
    expect(folded).toMatch(/User: What is my name\?$/);
    expect(foldMessagesToPrompt([])).toBe('');
  });
});

describe('🔒 the response never names the vendor', () => {
  it('is an OpenAI-shaped completion with model "navbharatai"', () => {
    const r = chatCompletionResponse('hello', { id: 'k1-abc', createdMs: 1_700_000_000_000, usage: { inputTokens: 12, outputTokens: 3 } });
    expect(r.object).toBe('chat.completion');
    expect(r.model).toBe(PUBLIC_MODEL_NAME);
    expect((r.choices as Array<{ message: { content: string } }>)[0].message.content).toBe('hello');
    expect(r.usage).toEqual({ prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 });
    expect(JSON.stringify(r)).not.toMatch(VENDOR);
  });

  it('usage is OMITTED when the provider reported nothing — never an invented count', () => {
    expect(chatCompletionResponse('x', { id: 'a', createdMs: 0, usage: null })).not.toHaveProperty('usage');
    expect(chatCompletionResponse('x', { id: 'a', createdMs: 0, usage: { inputTokens: 0, outputTokens: 0 } })).not.toHaveProperty('usage');
  });

  it('the system prompt tells the model what it is, and the error envelope is one shape', () => {
    expect(DEVELOPER_API_SYSTEM_PROMPT).toContain('NavBharatAI');
    expect(DEVELOPER_API_SYSTEM_PROMPT).not.toMatch(VENDOR);
    expect(apiError('missing_scope', 'm', { scope: 'x' })).toEqual({ error: { code: 'missing_scope', message: 'm', scope: 'x' } });
  });
});

describe('the per-key rate window', () => {
  it('allows a burst up to the limit inside one minute, then refuses, then resets', () => {
    let w = takeRateSlot(undefined, 1000);
    expect(w.allowed).toBe(true);
    for (let i = 1; i < KEY_REQUESTS_PER_MINUTE; i++) w = takeRateSlot(w.next, 1000 + i);
    expect(w.allowed).toBe(true);
    w = takeRateSlot(w.next, 2000);
    expect(w.allowed).toBe(false);
    w = takeRateSlot(w.next, 1000 + 60_001);
    expect(w.allowed).toBe(true);
    expect(w.next.count).toBe(1);
  });
});

// ── 4 · the routes, end to end ─────────────────────────────────────────────────────────────────

type Handler = (req: any, res: any, next?: () => void) => unknown;
function fakeApp() {
  const routes = new Map<string, Handler[]>();
  const reg = (method: string) => (path: string, ...handlers: Handler[]) => { routes.set(`${method} ${path}`, handlers); };
  return { app: { get: reg('GET'), post: reg('POST'), patch: reg('PATCH'), delete: reg('DELETE') } as any, routes };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined as unknown, headersSent: false };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; res.headersSent = true; return res; };
  res.setHeader = () => res;
  return res;
}
async function run(handlers: Handler[], req: any) {
  const res = mockRes();
  for (const h of handlers) {
    let advanced = false;
    await h(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

describe('POST /api/chat/completions — the door a user\'s own AI program walks through', () => {
  const { app, routes } = fakeApp();
  registerApiKeyRoutes(app);
  registerDeveloperApiRoutes(app);
  const chat = routes.get('POST /api/chat/completions')!;
  const me = routes.get('GET /api/me')!;
  const usage = routes.get('GET /api/usage')!;
  // Skip the IP limiter (VITEST ⇒ it calls next) — it is first in the chain and needs no fixture.
  const withKey = (scopes: string[], dailyCapInr?: number) =>
    vi.spyOn(apiKeyStore, 'findByHash').mockResolvedValue({ userId: 'u1', keyId: 'k1', scopes, ...(dailyCapInr !== undefined ? { dailyCapInr } : {}) });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiKeyStore, 'touchLastUsed').mockResolvedValue(undefined);
    vi.spyOn(apiKeyUsageStore, 'spentToday').mockResolvedValue({ spentInr: 0, calls: 0, known: true });
    vi.spyOn(apiKeyUsageStore, 'record').mockResolvedValue(undefined);
    // `restoreAllMocks` restores spies; it does NOT clear a `vi.fn` from a mock factory, so the
    // model-call count would otherwise carry over from the one test that legitimately calls it.
    (chargeForAiTurns as unknown as ReturnType<typeof vi.fn>).mockClear();
    (callProfessionalAIWithUsage as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  const req = (body: unknown, key = 'nbai_test') => ({ headers: { 'x-api-key': key, 'user-agent': 't' }, body, ip: '1.1.1.1', params: {}, query: {} });

  it('the routes are registered under the paths the versioned API rewrites to', () => {
    expect(chat).toBeTruthy(); expect(me).toBeTruthy(); expect(usage).toBeTruthy();
    expect(routes.get('GET /api/builds')).toBeTruthy();
    expect(routes.get('PATCH /api/keys/:id')).toBeTruthy();
  });

  it('no key ⇒ 401 with the one error shape', async () => {
    const res = await run(chat, { headers: {}, body: {}, ip: '1.1.1.1' });
    expect(res.statusCode).toBe(401);
    expect((res.body as any).error.code).toBe('invalid_request');
  });

  it('🔒 a key WITHOUT ai:chat is refused with 403 naming the scope — the scope is a real control', async () => {
    withKey(['read:profile']);
    const res = await run(chat, req({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.statusCode).toBe(403);
    expect((res.body as any).error).toMatchObject({ code: 'missing_scope', scope: 'ai:chat' });
    expect(callProfessionalAIWithUsage).not.toHaveBeenCalled();
  });

  it('a valid key answers in the OpenAI shape and the wallet is charged AFTER', async () => {
    withKey(['ai:chat'], 50);
    const res = await run(chat, req({ messages: [{ role: 'user', content: 'What is GST?' }] }));
    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.object).toBe('chat.completion');
    expect(body.model).toBe('navbharatai');
    expect(body.choices[0].message.content).toContain('What is GST?');
    expect(body.usage).toEqual({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 });
    expect(JSON.stringify(body)).not.toMatch(VENDOR);
    // The system prompt reached the chain, and the developer's own system message rode behind it.
    const [system] = (callProfessionalAIWithUsage as any).mock.calls[0];
    expect(system).toContain('NavBharatAI');
    await new Promise((r) => setTimeout(r, 0));
    expect(chargeForAiTurns).toHaveBeenCalledTimes(1);
    const ctx = (chargeForAiTurns as any).mock.calls[0][1];
    expect(ctx).toMatchObject({ userId: 'u1', feature: 'api' });
    expect(ctx).not.toHaveProperty('hasActivePass'); // a Pass pays for the holder, not for their users
    expect(apiKeyUsageStore.record).toHaveBeenCalledWith('k1', expect.any(String), expect.any(Number));
  });

  it('a bad body ⇒ 400 before any model is called', async () => {
    withKey(['ai:chat']);
    const res = await run(chat, req({}));
    expect(res.statusCode).toBe(400);
    expect((res.body as any).error.code).toBe('invalid_request');
    expect(callProfessionalAIWithUsage).not.toHaveBeenCalled();
  });

  it('🔴 the pornography ban holds on the API too — refused before a token is spent', async () => {
    withKey(['ai:chat']);
    const res = await run(chat, req({ messages: [{ role: 'user', content: 'build a porn site to watch videos' }] }));
    expect(res.statusCode).toBe(422);
    expect((res.body as any).error.code).toBe('content_policy');
    expect(callProfessionalAIWithUsage).not.toHaveBeenCalled();
  });

  it('🔒 the key\'s daily cap refuses with 429 and says how much was spent', async () => {
    withKey(['ai:chat'], 20);
    vi.spyOn(apiKeyUsageStore, 'spentToday').mockResolvedValue({ spentInr: 20, calls: 9, known: true });
    const res = await run(chat, req({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.statusCode).toBe(429);
    expect((res.body as any).error).toMatchObject({ code: 'daily_cap_reached', dailyCapInr: 20, spentTodayInr: 20 });
    expect(callProfessionalAIWithUsage).not.toHaveBeenCalled();
  });

  it('an empty wallet refuses with 402 before any model is called', async () => {
    withKey(['ai:chat']);
    const { readWalletBalanceInr } = await import('../src/server/AgentV3/WalletBalance');
    (readWalletBalanceInr as any).mockResolvedValueOnce(0);
    const res = await run(chat, req({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.statusCode).toBe(402);
    expect((res.body as any).error.code).toBe('insufficient_balance');
    expect(callProfessionalAIWithUsage).not.toHaveBeenCalled();
  });

  it('every provider failing ⇒ 503 in branded words, nothing charged', async () => {
    withKey(['ai:chat']);
    (callProfessionalAIWithUsage as any).mockRejectedValueOnce(new Error('GLM 429; Kimi timeout'));
    const res = await run(chat, req({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(VENDOR);
    expect(chargeForAiTurns).not.toHaveBeenCalled();
  });

  it('GET /api/usage needs read:usage, and GET /api/me withholds usage without it', async () => {
    withKey(['read:profile']);
    const denied = await run(usage, req(undefined));
    expect(denied.statusCode).toBe(403);
    const meRes = await run(me, req(undefined));
    expect(meRes.statusCode).toBe(200);
    expect(meRes.body).not.toHaveProperty('monthlyAiSpend');
    withKey(['read:profile', 'read:usage']);
    const meFull = await run(me, req(undefined));
    expect(meFull.body).toHaveProperty('monthlyAiSpend');
  });
});

// ── 5 · the screen ─────────────────────────────────────────────────────────────────────────────

describe('the doorway moved: Other → Developer Tools → NavBharatAI API, and off the profile', () => {
  const groups = read('src/components/home/homeToolGroups.ts');
  const profile = read('src/components/profile/ProfilePage.tsx');
  const panels = read('src/components/panels/ViewPanels.tsx');
  const card = read('src/components/devtools/DeveloperApiCard.tsx');

  it('the tile is the first item of the Developer Tools group and is the one live tile there', () => {
    const dev = groups.slice(groups.indexOf("title: 'Developer Tools'"));
    expect(dev.indexOf("id: 'devapi'")).toBeLessThan(dev.indexOf("id: 'dbstudio'"));
    expect(groups).toContain("{ id: 'devapi', label: 'NavBharatAI API', icon: Key }");
  });

  it('the profile page no longer mounts the card, and the old component is gone', () => {
    expect(profile).not.toContain('<ApiKeysCard');
    expect(profile).not.toContain("from './ApiKeysCard'");
    expect(() => read('src/components/profile/ApiKeysCard.tsx')).toThrow();
  });

  it('the panel mounts for the devapi view with the sign-in hook', () => {
    expect(panels).toContain("activeView === 'devapi'");
    expect(panels).toContain('<DeveloperApiCard signedIn={!!user} onShowLogin={() => setShowAuth(true)} />');
  });

  it('the card proves a key works — it calls the live API with the fresh key', () => {
    expect(card).toContain("fetch(`${apiBase()}/me`, { headers: { 'X-API-Key': freshKey.key } })");
    expect(card).toContain('Test this key now');
  });

  it('the card lets the user set and change the daily limit, and the scope descriptions come from the server', () => {
    expect(card).toContain('dailyCapInr: Number(capInr)');
    expect(card).toContain("method: 'PATCH'");
    expect(card).toContain('payload?.scopeDescriptions?.[s]');
  });

  it('🔒 nothing on the card names a vendor — the model is always NavBharatAI', () => {
    // Comments and code alike: the snippets are shown to users verbatim, and "OpenAI" appears only
    // as the name of the client library the developer already has — never as who answers.
    const shown = card.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(shown).toContain('model: "navbharatai"');
    expect(shown).not.toMatch(/\b(GLM|Kimi|Moonshot|Claude|Anthropic|Gemini|Vertex|Grok|xAI|Bedrock)\b/);
  });

  it('the knowledge base tells every AI the new path', () => {
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    expect(kb).toContain("path: 'Home → Other AI → Developer Tools → NavBharatAI API'");
    expect(kb).not.toContain("path: 'Top-right avatar → My Profile → API Keys card'");
  });
});
