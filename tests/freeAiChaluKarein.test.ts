import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FREE_AI_ALLOWED, FREE_AI_BUSY_CODES, FREE_AI_ENDPOINT, FREE_AI_KEY_NAME, FREE_AI_KEY_PAGE, FREE_AI_MODELS,
  freeAiKeyLooksUsable, freeAiTextLadder, isFreeAiBusy, isFreeAiModel,
} from '../src/server/lib/appFreeAi';
import { askFreeAi, ownKeyFromSecrets } from '../src/server/lib/appAiOwnKey';
import { AI_MODEL_KEY_NAMES, isAiModelKey } from '../src/server/AgentV3/secretRequest';
import { FREE_AI_KEY_URL, FREE_AI_LOGIN_URL, FREE_AI_STEPS, currentFreeAiStep, freeAiStepDone, offerFreeAi } from '../src/lib/freeAiSetup';
import { findBrowserAiKeyUse } from '../src/server/AgentV3/browserAiKeyScan';

/**
 * "FREE AI CHALU KAREIN" — the ❗ button's three steps and the three free models (admin 2026-11-25).
 *
 * Admin, verbatim: *"glm 4.5 flash, glm 4.6v flash glm 4.7 flash — yeh teeno free module hai. yahi use
 * hone chahiye only!"* and *"login button se z.ai (glm) ka login page open ho, aur api se
 * https://z.ai/manage-apikey/apikey-list api key generation wala page open ho"*.
 *
 * The CLASS each block below locks, not the instance:
 *   1. a paid model id can never be sent on the owner's own free key (the money class);
 *   2. the free key answers rather than a paid key the owner happens to also have (the promise class);
 *   3. a ✅ is never shown for a key nobody proved (the fake-feature class);
 *   4. a rate limit is reported as "busy", never as a broken key (the honest-verdict class).
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const okBody = { choices: [{ message: { content: 'ok' } }] };
const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe('🔒 only the three free models, and the list is an allowlist', () => {
  it('names exactly the three ids Z.ai prints as Free', () => {
    expect([...FREE_AI_ALLOWED].sort()).toEqual(['glm-4.5-flash', 'glm-4.6v-flash', 'glm-4.7-flash']);
    expect(FREE_AI_MODELS.chat).toBe('glm-4.7-flash');
    expect(FREE_AI_MODELS.fallback).toBe('glm-4.5-flash');
    expect(FREE_AI_MODELS.vision).toBe('glm-4.6v-flash');
  });

  it('🔴 rejects the PAID ids whose names contain "flash" — the trap providerRates.ts has paid for three times', () => {
    // glm-4.7-flashx is $0.07/$0.40 and glm-5.3-flash is $0.15/$0.50. A matcher on the word "flash"
    // would send either on the USER'S OWN key, behind a button that said "free".
    for (const paid of ['glm-4.7-flashx', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-4.6v', 'glm-5.3', 'glm-4.7']) {
      expect(isFreeAiModel(paid), paid).toBe(false);
    }
  });

  it('the price card this repo already keeps still calls all three free', () => {
    // The quoted Z.ai price page lives in providerRates.ts. If a future price change moves one of these
    // off the free list there, this test is where that must be noticed — not on a user's bill.
    const rates = read('src/server/AgentV3/providerRates.ts');
    expect(rates).toContain('GLM-4.7-Flash  FREE · GLM-4.5-Flash FREE');
    expect(rates).toContain('GLM-4.6V-Flash FREE');
  });

  it('APP_FREE_AI_MODELS may NARROW the ladder and can never extend it', () => {
    expect(freeAiTextLadder({} as NodeJS.ProcessEnv)).toEqual(['glm-4.7-flash', 'glm-4.5-flash']);
    expect(freeAiTextLadder({ APP_FREE_AI_MODELS: 'glm-4.5-flash' } as never)).toEqual(['glm-4.5-flash']);
    // A paid id in the override is dropped, and an override of nothing but paid ids falls back.
    expect(freeAiTextLadder({ APP_FREE_AI_MODELS: 'glm-5.3, glm-4.5-flash' } as never)).toEqual(['glm-4.5-flash']);
    expect(freeAiTextLadder({ APP_FREE_AI_MODELS: 'glm-5.3,gpt-4o' } as never)).toEqual(['glm-4.7-flash', 'glm-4.5-flash']);
  });

  it('🔒 askFreeAi sends NOTHING when every id it is handed is paid — it does not fall back to a call', async () => {
    const fetchImpl = vi.fn();
    const r = await askFreeAi('k'.repeat(40), 'sys', 'hi', fetchImpl as never, ['glm-5.3']);
    expect(r).toEqual({ ok: false, reason: 'failed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('calls Z.ai\'s own documented endpoint with a bearer key and the free model', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, okBody));
    await askFreeAi('key-'.repeat(8), 'sys', 'hi', fetchImpl as never);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(FREE_AI_ENDPOINT);
    expect(FREE_AI_ENDPOINT).toBe('https://api.z.ai/api/paas/v4/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer key-/);
    expect(JSON.parse(init.body).model).toBe('glm-4.7-flash');
  });
});

describe('🔒 busy is busy — the second free model answers, and a limit is never a broken key', () => {
  it('falls to the second free model on a 429 and answers from it', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(reply(429, { error: { code: '1302', message: 'Rate limit reached for requests' } }))
      .mockResolvedValueOnce(reply(200, okBody));
    const r = await askFreeAi('k'.repeat(40), 'sys', 'hi', fetchImpl as never);
    expect(r).toEqual({ ok: true, text: 'ok' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('glm-4.7-flash');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).model).toBe('glm-4.5-flash');
  });

  it('both rungs busy ⇒ `busy`, which is what makes "wait a few seconds" a true thing to say', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(429, { error: { code: '1302' } }));
    expect(await askFreeAi('k'.repeat(40), 'sys', 'hi', fetchImpl as never)).toEqual({ ok: false, reason: 'busy' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('Z.ai\'s own 429 business codes count as busy, and "no balance" does not', () => {
    expect(FREE_AI_BUSY_CODES).toContain('1302');
    for (const code of FREE_AI_BUSY_CODES) expect(isFreeAiBusy(200, { error: { code } })).toBe(true);
    expect(isFreeAiBusy(429, null)).toBe(true);
    expect(isFreeAiBusy(503, null)).toBe(true);
    // 1113 is "Insufficient balance" — waiting never fixes it, so retrying the next model is pointless.
    expect(isFreeAiBusy(200, { error: { code: '1113' } })).toBe(false);
    expect(isFreeAiBusy(200, okBody)).toBe(false);
  });

  it('🔒 a refused KEY stops the ladder — no other model on the same key can answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(401, { error: { code: '1002' } }));
    expect(await askFreeAi('k'.repeat(40), 'sys', 'hi', fetchImpl as never)).toEqual({ ok: false, reason: 'refused' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('the owner is told to WAIT on a busy free key, not to go and check a key that is fine', () => {
    const route = read('src/server/routes/appAiOwner.ts');
    expect(route).toContain("case 'own-key-busy'");
    expect(route).toMatch(/case 'own-key-busy': return 'Your free AI is busy right now\./);
    // And the answer path must produce that reason rather than flattening it into a failure.
    expect(read('src/server/lib/appAiAnswer.ts')).toContain("'own-key-busy'");
  });
});

describe('🔒 the free key is the one that answers, because the button said free', () => {
  const key = 'z'.repeat(40);

  it('wins over a paid key the owner also has saved', () => {
    expect(ownKeyFromSecrets({ [FREE_AI_KEY_NAME]: key, OPENAI_API_KEY: 'sk-' + 'x'.repeat(40) }))
      .toMatchObject({ provider: 'zai', model: 'glm-4.7-flash' });
    expect(ownKeyFromSecrets({ [FREE_AI_KEY_NAME]: key, ANTHROPIC_API_KEY: 'sk-ant-' + 'x'.repeat(40) }))
      .toMatchObject({ provider: 'zai' });
  });

  it('the paid keys still work exactly as before when there is no free one', () => {
    expect(ownKeyFromSecrets({ OPENAI_API_KEY: 'sk-' + 'x'.repeat(40) })).toMatchObject({ provider: 'openai' });
    expect(ownKeyFromSecrets({ ANTHROPIC_API_KEY: 'sk-ant-' + 'x'.repeat(40) })).toMatchObject({ provider: 'anthropic' });
    expect(ownKeyFromSecrets({})).toBeNull();
    expect(ownKeyFromSecrets(null)).toBeNull();
  });

  it('a value that cannot be a key is ignored rather than becoming the provider', () => {
    expect(ownKeyFromSecrets({ [FREE_AI_KEY_NAME]: 'paste your key here' })).toBeNull();
    expect(ownKeyFromSecrets({ [FREE_AI_KEY_NAME]: 'https://z.ai/manage-apikey/apikey-list' })).toBeNull();
    expect(freeAiKeyLooksUsable('')).toBe(false);
    expect(freeAiKeyLooksUsable('short')).toBe(false);
    expect(freeAiKeyLooksUsable('a key with spaces in it that is long enough')).toBe(false);
    expect(freeAiKeyLooksUsable('x'.repeat(40))).toBe(true);
  });
});

describe('🔒 the ✅ is earned — the key is proven before it is saved (NO FAKE FEATURE)', () => {
  const route = read('src/server/routes/appAiOwner.ts');
  const handler = route.slice(route.indexOf('app.post(FREE_KEY_PATH'), route.indexOf("app.get('/api/app-ai/settings'"));

  it('makes a real call on the pasted key, and only then saves it', () => {
    const probeAt = handler.indexOf('askFreeAi(');
    const saveAt = handler.indexOf('saveUserSecrets(');
    expect(probeAt).toBeGreaterThan(-1);
    expect(saveAt).toBeGreaterThan(probeAt);
  });

  it('🔴 a key that did not answer is NOT saved — the early return is before the write', () => {
    const beforeSave = handler.slice(0, handler.indexOf('saveUserSecrets('));
    expect(beforeSave).toContain('if (!probe.ok)');
    expect(beforeSave).toContain('return;');
  });

  it('a save that fails is reported, never ticked', () => {
    expect(handler).toContain('if (!saved)');
    expect(handler).toContain('FREE_KEY_MESSAGES.unsaved');
  });

  it('only the app\'s owner can set it, and the cached "no key" answer is dropped afterwards', () => {
    expect(handler).toContain('ownerOf(req, workspaceId)');
    expect(handler).toContain('res.status(403)');
    expect(handler).toContain('forgetOwnKey(ownerId)');
  });

  it('the key is scoped to this app, through the one shared vault write', () => {
    expect(handler).toContain('saveUserSecrets(ownerId, { [FREE_AI_KEY_NAME]: key }, workspaceId)');
  });

  it('the client never claims the key is on until the server said ok', () => {
    const card = read('src/components/agentv3/FreeAiSetupCard.tsx');
    const save = card.slice(card.indexOf('const save = useCallback'), card.indexOf('if (progress.keySaved)'));
    expect(save).toContain('if (!r.ok)');
    // The ✅ state is set only after that guard returned.
    expect(save.indexOf('keySaved: true')).toBeGreaterThan(save.indexOf('if (!r.ok)'));
  });
});

describe('the three steps the admin asked for, in order, in words a user can read', () => {
  it('is login → make the key → paste, numbered 1, 2, 3', () => {
    expect(FREE_AI_STEPS.map((s) => s.id)).toEqual(['login', 'key', 'paste']);
    expect(FREE_AI_STEPS.map((s) => s.number)).toEqual([1, 2, 3]);
  });

  it('opens exactly the two pages the admin named', () => {
    expect(FREE_AI_KEY_URL).toBe('https://z.ai/manage-apikey/apikey-list');
    expect(FREE_AI_KEY_PAGE).toBe(FREE_AI_KEY_URL);
    expect(FREE_AI_LOGIN_URL).toMatch(/^https:\/\/z\.ai\//);
    expect(FREE_AI_STEPS[0].action?.url).toBe(FREE_AI_LOGIN_URL);
    expect(FREE_AI_STEPS[1].action?.url).toBe(FREE_AI_KEY_URL);
    // The paste step has no page to open: its action is the box itself.
    expect(FREE_AI_STEPS[2].action).toBeUndefined();
  });

  it('🔒 every line is in English AND in Hindi — never Hindi alone (admin 2026-09-14)', () => {
    // "south india wale kaise padhenge isko??" — a Tamil speaker cannot read Devanagari, so English is
    // always present. Both are, for every step.
    for (const step of FREE_AI_STEPS) {
      expect(step.en.trim().length, step.id).toBeGreaterThan(0);
      expect(step.hi.trim().length, step.id).toBeGreaterThan(0);
      expect(/[ऀ-ॿ]/.test(step.hi), step.id).toBe(true);
      expect(/[ऀ-ॿ]/.test(step.en), step.id).toBe(false);
      if (step.action) {
        expect(step.action.en.trim().length).toBeGreaterThan(0);
        expect(/[ऀ-ॿ]/.test(step.action.en)).toBe(false);
      }
    }
  });

  it('never names a model to the user — they do not choose one', () => {
    const copy = JSON.stringify(FREE_AI_STEPS) + read('src/lib/freeAiSetup.ts')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const model of FREE_AI_ALLOWED) expect(copy.toLowerCase()).not.toContain(model);
  });

  it('walks the steps in order and ticks only what really happened', () => {
    const none = { loginOpened: false, keyOpened: false, keySaved: false };
    expect(currentFreeAiStep(none)).toBe('login');
    expect(currentFreeAiStep({ ...none, loginOpened: true })).toBe('key');
    expect(currentFreeAiStep({ ...none, loginOpened: true, keyOpened: true })).toBe('paste');
    expect(currentFreeAiStep({ loginOpened: true, keyOpened: true, keySaved: true })).toBeNull();
    expect(freeAiStepDone('login', none)).toBe(false);
    expect(freeAiStepDone('login', { ...none, loginOpened: true })).toBe(true);
    // The paste step is ticked by the SERVER's verdict and by nothing else.
    expect(freeAiStepDone('paste', { loginOpened: true, keyOpened: true, keySaved: false })).toBe(false);
    expect(freeAiStepDone('paste', { loginOpened: true, keyOpened: true, keySaved: true })).toBe(true);
  });
});

describe('when the ❗ tray offers it at all', () => {
  const base = { available: true, usesAi: true, ownKey: null as string | null };

  it('only for an app that really uses AI, with no key of the owner\'s own', () => {
    expect(offerFreeAi(base)).toBe(true);
    expect(offerFreeAi({ ...base, usesAi: false })).toBe(false);
    expect(offerFreeAi({ ...base, available: false })).toBe(false);
    expect(offerFreeAi(null)).toBe(false);
  });

  it('🔒 not once a key is answering — the row\'s own words would be false', () => {
    // "every answer is charged to your balance" is untrue for an owner whose own key answers.
    for (const k of ['zai', 'openai', 'anthropic']) expect(offerFreeAi({ ...base, ownKey: k }), k).toBe(false);
  });

  it('the tray renders the box, lights the badge, and counts it in its own summary', () => {
    const tray = read('src/components/agentv3/UserActionTray.tsx');
    expect(tray).toContain('freeAiCard');
    expect(tray).toContain("{section.group === 'needed' && freeAiCard}");
    // A finished build has no "needed" section at all, and the box must still show.
    expect(tray).toContain("!groups.some((g) => g.group === 'needed') && (secretCard || freeAiCard)");
    expect(tray).toContain('traySummary(openCount + (freeAiCard ? 1 : 0))');
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain('count: userActions.openCount + (freeAiOffered ? 1 : 0)');
    expect(panel).toContain('freeAiCard={freeAiCardNode}');
    expect(panel).toContain('offerFreeAi(appAiView)');
  });
});

describe('🔒 the siblings this key could have reached', () => {
  it('the build never asks the user for the free key in a popup — the ❗ box owns it', () => {
    expect(isAiModelKey('ZAI_API_KEY')).toBe(true);
    expect(isAiModelKey('Z_AI_API_KEY')).toBe(true);
    expect(AI_MODEL_KEY_NAMES.some((re) => re.test(FREE_AI_KEY_NAME))).toBe(true);
  });

  it('🔴 a built app calling api.z.ai from the PAGE is caught, like every other provider host', () => {
    // The sibling the free key created: `ZAI_API_KEY` now really exists in an app's .env, so a build
    // could reach for the one shape browserAiKeyScan exists to forbid. Found by hunting, not by failing.
    const found = findBrowserAiKeyUse({
      'src/ai.ts': 'fetch("https://api.z.ai/api/paas/v4/chat/completions")',
      'src/bundled.ts': 'const k = import.meta.env.VITE_ZAI_API_KEY;',
    });
    expect(found.map((f) => f.shape).sort()).toEqual(['bundled-key', 'provider-host']);
  });

  it('the vault name is one constant everywhere, so the writer and the reader cannot drift', () => {
    expect(FREE_AI_KEY_NAME).toBe('ZAI_API_KEY');
    for (const f of ['src/server/lib/appAiOwnKey.ts', 'src/server/routes/appAiOwner.ts']) {
      expect(read(f), f).toContain('FREE_AI_KEY_NAME');
      // Never the literal — that is how a rename leaves one half behind.
      expect(read(f).includes("'ZAI_API_KEY'"), f).toBe(false);
    }
  });
});
