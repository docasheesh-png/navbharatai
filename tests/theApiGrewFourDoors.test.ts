import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  API_SCOPES, API_SCOPE_DESCRIPTIONS, FULL_ACCESS_SCOPE, SPECIFIC_API_SCOPES,
  hasScope, effectiveScopes, normalizeScopes,
} from '../src/server/lib/ApiKeyManager';
import {
  SCOPE_ROUTES, PUBLIC_MODEL_NAME, PROFESSIONAL_MODEL_PREFIX,
  professionalIdFromModel, professionalModelName,
  readImageRequest, imageGenerationResponse, MAX_IMAGES_PER_REQUEST, MAX_IMAGE_PROMPT_CHARS,
} from '../src/server/lib/developerApi';
import { listProfessionals, getProfessional } from '../src/server/professionals/registry';

/**
 * 🔌 THE NAVBHARATAI API GREW FOUR DOORS (admin 2026-09-22).
 *
 * > *"NAVBHARATAI API, jisko thoda aur modify karo! isme kuch cheeze aur add karo, jaise full access,
 * > professionals, images generator, aur aap jo bhi chaho."*
 *
 * What went in: **full access**, the **~80 expert AIs**, an **image generator**, and — Claude's own
 * two — `GET /api/v1/key` (what this key may do and what it spent today) and `GET /api/v1/models`
 * (so a standard SDK's `models.list()` works).
 *
 * ## The four things this file exists to stop, each of which fails silently
 *
 * 1. **A scope that is a label.** The original API's whole root cause: two of three scopes opened
 *    nothing. `all` is the shape most likely to repeat it, because it has no single route to point
 *    at — so it is proven against `hasScope` itself, the one function every guard calls.
 * 2. **A second copy of the paid image engine.** The rungs moved into `lib/imageProEngine.ts` so both
 *    doors share them; a copy would be the drifted-copy class this repo has paid for five times.
 * 3. **A door that bills without a triage, a cap or a wallet check.** Three money doors now, one gate.
 * 4. **A vendor name reaching a developer.** `navbharatai/teacher_ai` is our brand; the engine under
 *    it is admin-only (White-Label Law), and a developer is a user.
 *
 * Every SOURCE case below was proven by reversion — `tsc` and `vitest` cannot see a missing gate, a
 * duplicated engine or a scope check that was never wired.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const DEV_ROUTE = 'src/server/routes/developerApi.ts';
const IMG_ROUTE = 'src/server/routes/imageGen.ts';
const ENGINE = 'src/server/lib/imageProEngine.ts';
const UI = 'src/components/devtools/DeveloperApiCard.tsx';
const VENDOR = /\b(GLM|Z\.ai|Kimi|Moonshot|Claude|Anthropic|Gemini|Vertex|Grok|xAI|Bedrock|OpenAI|Pollinations|NVIDIA|Nemotron)\b/i;

/** Source with its prose removed — every guard here is about CODE, never about a comment. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// ── 1 · full access ────────────────────────────────────────────────────────────────────────────

describe('🔑 FULL ACCESS — one scope that really is every scope', () => {
  it('it is first in the list, and it is the one the UI treats specially', () => {
    expect(API_SCOPES[0]).toBe(FULL_ACCESS_SCOPE);
    expect(code(UI)).toContain("const FULL_ACCESS = 'all'");
  });

  it('🔒 it satisfies every check — including the ones that do not exist yet', () => {
    for (const s of API_SCOPES) expect(hasScope([FULL_ACCESS_SCOPE], s), s).toBe(true);
    // The proof that it covers the FUTURE: the check lives in `hasScope`, which every guard calls,
    // rather than in a list of scopes somebody has to remember to extend.
    expect(code('src/server/lib/ApiKeyManager.ts')).toMatch(/granted\.includes\(FULL_ACCESS_SCOPE\) \|\| granted\.includes\(required\)/);
  });

  it('🔒 NO OTHER SCOPE IS a wildcard — a narrow key opens its own door and nothing else', () => {
    for (const s of SPECIFIC_API_SCOPES) {
      const others = API_SCOPES.filter((x) => x !== s && x !== FULL_ACCESS_SCOPE);
      for (const o of others) expect(hasScope([s], o), `${s} must not satisfy ${o}`).toBe(false);
    }
  });

  it('effectiveScopes expands `all`, so a key can SHOW what it can do rather than say "all"', () => {
    expect(effectiveScopes([FULL_ACCESS_SCOPE])).toEqual([...API_SCOPES]);
    expect(effectiveScopes(['ai:chat', 'read:profile'])).toEqual(['read:profile', 'ai:chat']);
    expect(effectiveScopes([])).toEqual([]);
    expect(effectiveScopes(undefined)).toEqual([]);
  });

  it('it is a real, grantable scope and junk beside it is still dropped', () => {
    expect(normalizeScopes(['all', 'bogus'])).toEqual(['all']);
    expect(normalizeScopes(['ai:images', 'ai:professionals'])).toEqual(['ai:images', 'ai:professionals']);
  });

  it('🔒 its description WARNS that it auto-grants what does not exist yet — the one thing a tick cannot show', () => {
    const d = API_SCOPE_DESCRIPTIONS[FULL_ACCESS_SCOPE].detail;
    expect(d).toMatch(/later/i);
    expect(d).toMatch(/daily limit still applies/i);
  });

  it('🔒 the form makes full access and the narrow permissions mutually exclusive', () => {
    const ui = code(UI);
    expect(ui).toMatch(/if \(s === FULL_ACCESS\) return prev\.includes\(FULL_ACCESS\) \? \[\] : \[FULL_ACCESS\];/);
    expect(ui).toMatch(/const rest = prev\.filter\(\(x\) => x !== FULL_ACCESS\);/);
  });

  it('a full-access key is still bound by its daily ₹ cap — `all` widens WHAT, never HOW MUCH', () => {
    // The cap is read from the key and compared by `keyDecision`, which never sees a scope at all.
    expect(code('src/server/lib/developerApi.ts')).not.toMatch(/keyDecision[\s\S]{0,400}scope/);
  });
});

// ── 2 · the experts ────────────────────────────────────────────────────────────────────────────

describe('🧑‍🏫 THE EXPERT AIs, reachable by name', () => {
  it('the model prefix is OUR brand, and an id round-trips', () => {
    expect(PROFESSIONAL_MODEL_PREFIX).toBe(`${PUBLIC_MODEL_NAME}/`);
    expect(professionalModelName('teacher_ai')).toBe('navbharatai/teacher_ai');
    expect(professionalIdFromModel('navbharatai/teacher_ai')).toBe('teacher_ai');
    expect(professionalIdFromModel(' NavBharatAI/Teacher_AI ')).toBe('teacher_ai');
  });

  it('🔒 the PLAIN model name is not an expert — it must keep routing to the general assistant', () => {
    expect(professionalIdFromModel(PUBLIC_MODEL_NAME)).toBeNull();
    expect(professionalIdFromModel('')).toBeNull();
    expect(professionalIdFromModel(undefined)).toBeNull();
    expect(professionalIdFromModel('gpt-4o')).toBeNull();
  });

  it('🔒 an id that is not an id is refused BEFORE the registry is asked', () => {
    for (const bad of ['navbharatai/../../etc/passwd', 'navbharatai/a b', 'navbharatai/', 'navbharatai/x'.repeat(40), 'navbharatai/A-B']) {
      expect(professionalIdFromModel(bad), bad).toBeNull();
    }
  });

  it('the ids it accepts are ids the registry really has', () => {
    const ids = listProfessionals().map((p) => p.id);
    expect(ids.length).toBeGreaterThan(50);
    for (const id of ids.slice(0, 10)) {
      expect(professionalIdFromModel(professionalModelName(id))).toBe(id);
      expect(getProfessional(id)).toBeTruthy();
    }
  });

  it('🔒 BOTH entry points reach ONE handler — two copies would drift the moment either changed', () => {
    const src = code(DEV_ROUTE);
    expect((src.match(/async function answerAsExpert\(/g) || []).length).toBe(1);
    expect((src.match(/await answerAsExpert\(/g) || []).length).toBe(2);
  });

  it('🔒 a model name reaching a DIFFERENT persona needs the expert scope as well as ai:chat', () => {
    const src = code(DEV_ROUTE);
    expect(src).toMatch(/const expertId = professionalIdFromModel\(/);
    expect(src).toMatch(/if \(!hasScope\(auth\.scopes, 'ai:professionals'\)\)/);
    // …and the check is BEFORE the handler, not after it has already answered.
    expect(src.indexOf("!hasScope(auth.scopes, 'ai:professionals')")).toBeLessThan(src.indexOf('await answerAsExpert('));
  });

  it('🔒 it calls the SAME engine the app screen calls — an API caller gets the real expert, not an imitation', () => {
    expect(code(DEV_ROUTE)).toContain('runProfessionalChatWithUsage(config,');
  });

  it('an unknown expert is a 404 that says how to find the right name', () => {
    const src = read(DEV_ROUTE);
    expect(src).toMatch(/apiError\('not_found',/);
    expect(src).toContain('GET /api/v1/professionals');
  });

  it('🔒 the API does NOT re-register the public list — that path was already claimed, and a second one is never reached', () => {
    // A `GET /api/professionals` WAS written here and `routeCollision.test.ts` caught it:
    // `routes/professionals.ts` has owned that path since long before this API, so the duplicate
    // would have been dead code serving nobody while looking like a feature. The discovery need is
    // met by that public route and by `/models`; this asserts the duplicate has not crept back.
    expect(code(DEV_ROUTE)).not.toMatch(/app\.get\('\/api\/professionals'/);
    expect(code('src/server/routes/professionals.ts')).toMatch(/app\.get\('\/api\/professionals'/);
  });

  it('🔒 the ADDRESSABLE names come from the REGISTRY — a new expert reaches developers with no edit here', () => {
    expect(code(DEV_ROUTE)).toMatch(/ids\.push\(\.\.\.listProfessionals\(\)\.map\(\(p\) => professionalModelName\(p\.id\)\)\)/);
  });
});

// ── 3 · images ─────────────────────────────────────────────────────────────────────────────────

describe('🖼️ THE IMAGE GENERATOR', () => {
  it('a request needs a prompt, and the shape is the standard one', () => {
    expect(readImageRequest({ prompt: 'a cat' })).toEqual({ ok: true, prompt: 'a cat', n: 1, size: undefined, format: 'b64_json' });
    expect(readImageRequest({})).toEqual({ ok: false, reason: 'no-prompt' });
    expect(readImageRequest({ prompt: '   ' })).toEqual({ ok: false, reason: 'no-prompt' });
    expect(readImageRequest(null)).toEqual({ ok: false, reason: 'no-prompt' });
    expect(readImageRequest({ prompt: 'x'.repeat(MAX_IMAGE_PROMPT_CHARS + 1) })).toEqual({ ok: false, reason: 'too-long' });
  });

  it('🔒 an out-of-range `n` is REFUSED, never clamped — when money is the unit, say no rather than guess', () => {
    for (const bad of [0, -1, 5, 50, 1.5, 'lots']) {
      expect(readImageRequest({ prompt: 'a cat', n: bad }), String(bad)).toEqual({ ok: false, reason: 'bad-n' });
    }
    expect(readImageRequest({ prompt: 'a cat', n: MAX_IMAGES_PER_REQUEST }).ok).toBe(true);
  });

  it('🔒 `response_format: "url"` is refused — we never hand out a third-party origin', () => {
    expect(readImageRequest({ prompt: 'a cat', response_format: 'url' })).toEqual({ ok: false, reason: 'bad-format' });
    expect(readImageRequest({ prompt: 'a cat', response_format: 'data_url' }).ok).toBe(true);
    // Absent or blank means the standard default, not a refusal.
    expect(readImageRequest({ prompt: 'a cat', response_format: '' }).ok).toBe(true);
  });

  it('b64_json is BARE base64 (the standard); data_url keeps the prefix', () => {
    const img = [{ image: 'data:image/png;base64,AAAB', mimeType: 'image/png' }];
    const std = imageGenerationResponse(img, { createdMs: 1_700_000_000_000, format: 'b64_json', chargedInr: 1 });
    expect((std.data as Array<{ b64_json: string }>)[0].b64_json).toBe('AAAB');
    const dataUrl = imageGenerationResponse(img, { createdMs: 1_700_000_000_000, format: 'data_url', chargedInr: 1 });
    expect((dataUrl.data as Array<{ data_url: string }>)[0].data_url).toBe('data:image/png;base64,AAAB');
    expect(std.model).toBe(PUBLIC_MODEL_NAME);
    expect(std.chargedInr).toBe(1);
  });

  it('🔒 the price is the platform’s existing ₹1, never a number invented here', () => {
    const src = code(DEV_ROUTE);
    expect(src).toContain('IMAGE_PRO_PRICE_INR');
    // No literal rupee price anywhere in the image door — the constant is the only source.
    expect(src).not.toMatch(/n \* 1\b/);
  });

  it('🔒 the cap is checked against the KNOWN price, so a request that would cross it is refused first', () => {
    const src = code(DEV_ROUTE);
    expect(src).toMatch(/const quotedInr = request\.n \* IMAGE_PRO_PRICE_INR;/);
    expect(src).toMatch(/spendGate\(res, auth, now, request\.prompt, 'image', quotedInr\)/);
    expect(src).toMatch(/spentTodayInr: spent\.spentInr \+ Math\.max\(0, quotedInr\)/);
  });

  it('🔒 charged on what was DELIVERED, never on what was asked for', () => {
    expect(code(DEV_ROUTE)).toMatch(/const chargedInr = gate\.freeListed \? 0 : images\.length \* IMAGE_PRO_PRICE_INR;/);
  });

  it('🔒 an unconfigured Pro engine is an honest 503 — never a silent fall back to the free provider', () => {
    const src = code(DEV_ROUTE);
    expect(src).toMatch(/if \(!imageProAvailable\(\)\) \{/);
    expect(src.indexOf('if (!imageProAvailable()) {')).toBeLessThan(src.indexOf('generateProImages('));
  });
});

// ── 4 · one engine, not two ────────────────────────────────────────────────────────────────────

describe('🔒 THE PAID IMAGE ENGINE LIVES IN ONE FILE', () => {
  it('both doors call it, and NEITHER carries a copy of the rungs', () => {
    for (const p of [DEV_ROUTE, IMG_ROUTE]) {
      expect(code(p), `${p} must call the shared engine`).toContain('generateProImages(');
      // The two rung calls are the engine's alone. A route holding either has a copy.
      expect(code(p), `${p} must not call rung 1 itself`).not.toContain('fetchPollinationsPaidImage(');
      expect(code(p), `${p} must not call rung 2 itself`).not.toContain('await fetch(imageProEndpoint()');
    }
    const engine = code(ENGINE);
    expect(engine).toContain('fetchPollinationsPaidImage(');
    expect(engine).toContain('await fetch(imageProEndpoint()');
  });

  it('🔒 the engine charges nobody and reads no wallet — each door pays differently, so that stayed with the door', () => {
    const engine = code(ENGINE);
    for (const forbidden of ['debitWalletRolledUp', 'readWalletBalanceInr', 'chargeForAiTurn', 'IMAGE_PRO_PRICE_INR', 'res.json', 'res.status']) {
      expect(engine, forbidden).not.toContain(forbidden);
    }
  });

  it('🔒 the engine runs no triage — the triage belongs to the DOOR, and BOTH doors run one', () => {
    expect(code(ENGINE)).not.toMatch(/triage/i);
    expect(code(IMG_ROUTE)).toContain('await triageImageRequest(');
    expect(code(DEV_ROUTE)).toContain('decideImageSafety(');
  });
});

// ── 5 · one gate for every door that spends ────────────────────────────────────────────────────

describe('🔒 EVERY MONEY DOOR PASSES THROUGH ONE GATE', () => {
  const src = code(DEV_ROUTE);

  it('there is exactly one gate, and all three spending doors use it', () => {
    expect((src.match(/async function spendGate\(/g) || []).length).toBe(1);
    // chat, the expert handler, and images.
    expect((src.match(/await spendGate\(/g) || []).length).toBe(3);
  });

  it('🔒 it refuses in cheap-first order: rate slot, triage, cap, wallet — before any provider is called', () => {
    const gate = src.slice(src.indexOf('async function spendGate('), src.indexOf('function settleKeyTurn('));
    const order = ['keyAllowedNow(', 'triagePrompt(', 'apiKeyUsageStore.spentToday(', 'readWalletBalanceInr(', 'keyDecision('];
    let at = -1;
    for (const step of order) {
      const i = gate.indexOf(step);
      expect(i, `${step} missing from the gate`).toBeGreaterThan(-1);
      expect(i, `${step} out of order`).toBeGreaterThan(at);
      at = i;
    }
  });

  it('🔒 no door calls a provider before its gate', () => {
    for (const call of ['callProfessionalAIWithUsage(', 'runProfessionalChatWithUsage(', 'generateProImages(']) {
      const i = src.indexOf(call);
      expect(i, `${call} not found`).toBeGreaterThan(-1);
      const before = src.slice(0, i);
      expect(before, `${call} runs before a gate`).toContain('await spendGate(');
    }
  });

  it('🔒 the money lands AFTER the answer, through one settlement both AI doors share', () => {
    expect((src.match(/function settleKeyTurn\(/g) || []).length).toBe(1);
    expect((src.match(/settleKeyTurn\(auth, now, gate\.freeListed, run\.spend\)/g) || []).length).toBe(2);
    // The response is sent first in both — a money-path failure must never cost the caller the answer.
    for (const marker of ['res.status(200).json(chatCompletionResponse(', 'res.status(200).json({']) {
      expect(src.indexOf(marker)).toBeGreaterThan(-1);
    }
  });

  it('🔒 a Professional Pass does NOT make a key’s traffic free — it pays for the holder, not their users', () => {
    expect(src).toMatch(/\{ userId: auth\.userId, feature: 'api', isFreeListed: freeListed \}/);
    expect(src).not.toContain('hasActivePass');
  });

  it('an image flag is recorded against the REAL uid, not `anon`', () => {
    const gate = src.slice(src.indexOf('async function spendGate('), src.indexOf('function settleKeyTurn('));
    expect(gate).toMatch(/uid: auth\.userId, triage: safety\.triage, surface: 'image'/);
  });
});

// ── 6 · the two free endpoints, and white-label ────────────────────────────────────────────────

describe('the two doors that need no scope, and the law that binds all of them', () => {
  it('`/key` and `/models` take a valid key and no scope — the 403 debugging endpoint cannot itself 403', () => {
    const src = code(DEV_ROUTE);
    expect(src).toMatch(/app\.get\('\/api\/key', ipLimiter, apiKeyAuth, async/);
    expect(src).toMatch(/app\.get\('\/api\/models', ipLimiter, apiKeyAuth, \(/);
    expect(src.slice(src.indexOf("app.get('/api/key'"))).not.toMatch(/^[^\n]*requireScope/);
  });

  it('`/key` reports an unreadable counter as null, never a confident zero', () => {
    expect(code(DEV_ROUTE)).toMatch(/todaySpentInr: spent && spent\.known \? Math\.round\(spent\.spentInr \* 100\) \/ 100 : null/);
  });

  it('🔒 `/models` lists the experts ONLY when the key may address them — a name that 403s is worse than no name', () => {
    expect(code(DEV_ROUTE)).toMatch(/if \(hasScope\(auth\.scopes, 'ai:professionals'\)\) ids\.push\(/);
  });

  it('🔒 WHITE-LABEL: no vendor name in any scope description, model name or developer-facing string', () => {
    for (const s of API_SCOPES) {
      expect(`${API_SCOPE_DESCRIPTIONS[s].title} ${API_SCOPE_DESCRIPTIONS[s].detail}`, s).not.toMatch(VENDOR);
    }
    expect(PROFESSIONAL_MODEL_PREFIX).not.toMatch(VENDOR);
    for (const id of listProfessionals().map((p) => p.id)) expect(professionalModelName(id)).not.toMatch(VENDOR);
    // Every string the API sends a developer. Vendor names may appear only in `console.*` (admin-only).
    const src = code(DEV_ROUTE);
    const sent = src.split('\n').filter((l) => /res\.(status\(\d+\)\.)?json\(|apiError\(/.test(l));
    for (const line of sent) expect(line, line.trim()).not.toMatch(VENDOR);
  });

  it('every new endpoint is documented where the key is made', () => {
    const ui = read(UI);
    for (const path of ['/professionals/teacher_ai/chat', '/images/generations', '/key']) {
      expect(ui, `${path} is undocumented`).toContain(path);
    }
    expect(ui).toContain('navbharatai/teacher_ai');
  });

  it('…and in the knowledge base every NavBharatAI AI reads', () => {
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    const entry = kb.slice(kb.indexOf("id: 'api_keys'"), kb.indexOf("id: 'api_keys'") + 9000);
    for (const must of ['ai:professionals', 'ai:images', 'GET /api/v1/key', 'GET /api/v1/models', 'FULL ACCESS']) {
      expect(entry, must).toContain(must);
    }
  });
});
