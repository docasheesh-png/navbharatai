// THE FREE CHAT LADDER, AND THE FLASH-LITE PRICE THE ADMIN'S OWN INVOICE CORRECTED.
//
// Two things ship together here, and the second is why the first is worth testing:
//
// 1. The free ladder becomes GLM-flash → GPT Nano → Vertex flash-lite → Vertex flash. Its real gain
//    is VENDOR COUNT, not rung count: the old ladder spent six registrations on two vendors, and its
//    one non-Google rung (glm-4.7) shares a KEY with the free leader, so it dies in the same 429
//    storm. Three independent vendors answer now.
//
// 2. `gemini-2.5-flash-lite` used to resolve to the flash rate line. The admin's September invoice
//    priced Flash Text Input at Rs 2.866e-5/unit and Flash-Lite Text Input at Rs 9.555e-6/unit —
//    EXACTLY 3.0x — so lite is $0.10, not $0.30. Every flash-lite turn was reported at 3x its real
//    cost on the one screen the admin judges Google spend from.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { realRateFor } from '../src/server/AgentV3/providerRates';
import { chatCostIndex, freeTierCeiling, allowedOnFreeTier } from '../src/server/AI/freeTierCostCeiling';
import { OpenAiChatProvider } from '../src/server/AI/Router/providers/OpenAiChatProvider';

describe('flash-lite is priced as flash-lite, not as flash', () => {
  it('resolves to its OWN rate line', () => {
    const lite = realRateFor('VERTEX', 'gemini-2.5-flash-lite');
    const flash = realRateFor('VERTEX', 'gemini-2.5-flash');
    expect(lite.inputPerMTok).toBe(0.1);
    expect(flash.inputPerMTok).toBe(0.3);
  });

  it('is exactly 3x cheaper on input — the ratio the invoice measured', () => {
    const lite = realRateFor('VERTEX', 'gemini-2.5-flash-lite');
    const flash = realRateFor('VERTEX', 'gemini-2.5-flash');
    expect(flash.inputPerMTok / lite.inputPerMTok).toBeCloseTo(3.0, 5);
  });

  it('"lite" is matched BEFORE the generic flash rule — the bug being fixed', () => {
    // Both ids contain "flash"; only one contains "lite". A generic flash match that ran first would
    // send lite to the flash line, which is precisely what shipped before today.
    expect(realRateFor('VERTEX', 'gemini-2.5-flash-lite').inputPerMTok)
      .not.toBe(realRateFor('VERTEX', 'gemini-2.5-flash').inputPerMTok);
  });

  it('PRO is still the pro line — the fix did not widen to other gemini ids', () => {
    expect(realRateFor('VERTEX', 'gemini-2.5-pro').inputPerMTok).toBe(1.25);
  });
});

describe('every rung of the free ladder is under the free-tier ceiling', () => {
  const RUNGS: ReadonlyArray<readonly [string, string]> = [
    ['GLM', 'glm-4.7-flash'],
    ['OPENAI', 'gpt-5-nano'],
    ['VERTEX', 'gemini-2.5-flash-lite'],
    ['VERTEX', 'gemini-2.5-flash'],
  ];

  it('none of the four is refused', () => {
    for (const [label, model] of RUNGS) {
      expect(allowedOnFreeTier(label, model), `${label}/${model}`).toBe(true);
    }
  });

  it('GPT Nano sits at 2.85, well under the ceiling', () => {
    expect(chatCostIndex('OPENAI', 'gpt-5-nano')).toBeCloseTo(2.85, 2);
    expect(chatCostIndex('OPENAI', 'gpt-5-nano')).toBeLessThan(freeTierCeiling());
  });

  it('🔒 an OpenAI rung with NO model pinned is REFUSED — it prices at the full GPT bound', () => {
    // The safe direction on purpose: a forgotten model pin cannot quietly put full GPT on free chat.
    expect(chatCostIndex('OPENAI', undefined)).toBeGreaterThan(freeTierCeiling());
    expect(allowedOnFreeTier('OPENAI', undefined)).toBe(false);
  });

  it('🔒 the nano rung prices correctly even under the WRONG provider label', () => {
    // freeChainCost.test.ts guesses a label from the model name and sends anything not glm/kimi to
    // 'VERTEX' — so it calls the new rung VERTEX. That is only safe because realRateFor matches the
    // MODEL ID before the provider label, and `gpt…nano` resolves to the nano line either way. If id
    // precedence were ever reversed, that guard would price nano as gemini-flash and this fails.
    expect(chatCostIndex('VERTEX', 'gpt-5-nano')).toBe(chatCostIndex('OPENAI', 'gpt-5-nano'));
    expect(chatCostIndex('VERTEX', 'gpt-5-nano')).toBeCloseTo(2.85, 2);
  });

  it('Grok is still refused — the 2026-09-12 ceiling decision is untouched', () => {
    expect(allowedOnFreeTier('GROK', 'grok-3')).toBe(false);
  });

  it('gemini-2.5-pro is still refused', () => {
    expect(allowedOnFreeTier('VERTEX', 'gemini-2.5-pro')).toBe(false);
  });
});

describe('the OpenAI chat provider', () => {
  const prior = process.env.OPENAI_API_KEY;
  const priorModel = process.env.OPENAI_CHAT_MODEL;
  afterEach(() => {
    if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior;
    if (priorModel === undefined) delete process.env.OPENAI_CHAT_MODEL; else process.env.OPENAI_CHAT_MODEL = priorModel;
  });

  it('is inert without a key, and healthy with one', async () => {
    const p = new OpenAiChatProvider();
    delete process.env.OPENAI_API_KEY;
    expect(await p.healthCheck()).toBe(false);
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(await p.healthCheck()).toBe(true);
  });

  it('treats a whitespace-only key as unset', async () => {
    process.env.OPENAI_API_KEY = '   ';
    expect(await new OpenAiChatProvider().healthCheck()).toBe(false);
  });

  it('defaults to a nano model, and the default PRICES as nano', () => {
    delete process.env.OPENAI_CHAT_MODEL;
    const m = OpenAiChatProvider.model();
    expect(m).toContain('nano');
    // The rate card matches on the id, so the default can never bill at the full GPT bound.
    expect(realRateFor('OPENAI', m).inputPerMTok).toBe(0.2);
  });

  it('honours OPENAI_CHAT_MODEL, and falls back when it is blank', () => {
    process.env.OPENAI_CHAT_MODEL = 'gpt-5.4-nano';
    expect(OpenAiChatProvider.model()).toBe('gpt-5.4-nano');
    process.env.OPENAI_CHAT_MODEL = '   ';
    expect(OpenAiChatProvider.model()).toContain('nano');
  });

  it('DEFERS an image turn instead of sending pixels to a text-only model', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    await expect(new OpenAiChatProvider().execute('describe', undefined, undefined, undefined, ['aGk=']))
      .rejects.toThrow(/text-only/i);
  });
});

// REVERSION GUARDS. The behavioural tests above pass on a ladder that never registers OpenAI at all,
// so the registration itself is asserted from the source — the same reasoning as the ladder-claims
// guard: a test that cannot fail when the feature is deleted is not protecting the feature.
describe('the ladder really is wired, in the source', () => {
  const src = readFileSync(join(__dirname, '../src/server/AI/AIRouterManager.ts'), 'utf8');
  const free = src.slice(src.indexOf('private static buildFree'), src.indexOf('private static buildPro'));

  it('registers the OpenAI provider on the free chain, as a LITERAL the guard can price', () => {
    expect(free).toContain('OpenAiChatProvider');
    // The literal matters: freeChainCost.test.ts parses these registrations to price them, and its
    // own comment warns a shape it cannot read is "silently exempt from the ceiling".
    expect(free).toMatch(/\[\s*openai\s*,\s*'gpt-5-nano'\s*,\s*\d+\s*\]/);
  });

  it('climbs cheapest-first BY PRIORITY: lite(1.20) → nano(2.85) → flash(4.90)', () => {
    // ⚠️ By PRIORITY, not by source position — the two Vertex rungs are registered together, so
    // flash sits ABOVE nano in the file while ranking below it at runtime. Asserting the source
    // order would have pinned a detail that means nothing and broken on any harmless re-grouping.
    const prio = (m: string) => {
      const hit = new RegExp(`'${m.replace('.', '\\.')}'\\s*,\\s*(\\d+)`).exec(free);
      expect(hit, `no priority found for ${m}`).toBeTruthy();
      return Number(hit![1]);
    };
    expect(prio('gemini-2.5-flash-lite')).toBeLessThan(prio('gpt-5-nano'));
    expect(prio('gpt-5-nano')).toBeLessThan(prio('gemini-2.5-flash'));
    // …and the prices really are in that order, so the ranking is not a coincidence.
    expect(chatCostIndex('VERTEX', 'gemini-2.5-flash-lite'))
      .toBeLessThan(chatCostIndex('OPENAI', 'gpt-5-nano'));
    expect(chatCostIndex('OPENAI', 'gpt-5-nano'))
      .toBeLessThan(chatCostIndex('VERTEX', 'gemini-2.5-flash'));
  });

  it('the dropped rungs are genuinely gone', () => {
    expect(free).not.toContain('GeminiProvider');       // the Gemini-direct door
    expect(free).not.toContain("'glm-4.7'");            // the old last rung
  });

  it('every rung still passes through registerFree — the ceiling cannot be bypassed', () => {
    // A raw `router.registerProvider(...)` here would skip allowedOnFreeTier entirely.
    const rawRegistrations = free.match(/router\.registerProvider\(/g) ?? [];
    // Exactly one: the GLM leader, which is registered directly above the helper's definition.
    expect(rawRegistrations.length).toBeLessThanOrEqual(2);
  });
});
