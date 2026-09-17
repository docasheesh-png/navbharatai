import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { glmCanDisableThinking, glmThinkingParam } from '../src/server/AgentV3/providers/glmThinking';
import { parseOpenAiCompletion } from '../src/server/AgentV3/providers/OpenAiToolAdapter';
import { shouldContinue, MAX_CONTINUATIONS } from '../src/server/AgentV3/FastLaneContinuation';
import { providerFailuresLookMisconfigured, providerFailuresLookDegraded } from '../src/server/AgentV3/BuildDiagnostics';
import { freeTierUpsellMessage } from '../src/server/AgentV3/FreeTierBuildRouting';
import { TIER_LADDERS, PLAN_RUNG } from '../src/server/AgentV3/tierLadder';

/**
 * AUTOPSY of build `58fe8254` (workspace …f769ced8, 2026-09-15).
 *
 * Prompt: "Continue the build from where it left off and finish the remaining steps."
 * Outcome: 0 files, RELEASE_GATE RED, `providerFailures: { GLM: 280 }` — every one the same hard 400:
 *   "This model always engages in thinking and cannot be disabled; please use low, high, or max"
 * then three Kimi calls at `outputTokens: 4833, responseChars: 0, finish=max_tokens`,
 * then: "Your app needs our strongest engine to finish cleanly. Add credits."
 */

describe('🔴 1 · the first rung of every ladder could not succeed', () => {
  it('never asks an always-reasoning model to stop reasoning', () => {
    // The exact model and request that produced 279 bad-requests.
    // ⚠️ UPDATED 2026-09-15 (autopsy ee20478d) — the INVARIANT is unchanged, the REMEDY is not.
    // What must never happen is sending `disabled` to a model that rejects it; that is what cost 280
    // failures and it is what every case here still asserts. But the original remedy — send NOTHING —
    // turned out to select the model's DEFAULT effort, i.e. the MOST reasoning, which then ate the
    // whole output ceiling and produced zero files. The field is now the provider's own lowest level.
    expect(glmThinkingParam('glm-5.3-flash', false)).not.toEqual({ thinking: { type: 'disabled' } });
    expect(glmThinkingParam('glm-5.3', false)).not.toEqual({ thinking: { type: 'disabled' } });
    expect(glmThinkingParam('glm-5.3-flash', false)).toEqual({ thinking: { type: 'low' } });
  });

  it('but still lets the toggle turn reasoning ON — that is accepted everywhere', () => {
    expect(glmThinkingParam('glm-5.3-flash', true)).toEqual({ thinking: { type: 'enabled' } });
  });

  it('keeps the disable for the older families where it genuinely worked', () => {
    expect(glmCanDisableThinking('glm-4.7')).toBe(true);
    expect(glmCanDisableThinking('glm-4.7-flash')).toBe(true);
    expect(glmCanDisableThinking('glm-5.2')).toBe(true);
    expect(glmThinkingParam('glm-4.7', false)).toEqual({ thinking: { type: 'disabled' } });
  });

  it('DEFAULT-DENY on anything unrecognised — an omitted param never 400s, an unsupported one is fatal', () => {
    for (const id of ['glm-5.4', 'glm-6', 'glm-9.9-flash', 'kimi-k2.6', 'gpt-5.4', '', undefined, null]) {
      expect(glmCanDisableThinking(id as string), String(id)).toBe(false);
      expect(glmThinkingParam(id as string, false), String(id)).not.toEqual({ thinking: { type: 'disabled' } });
    }
  });

  it('no opinion means no field at all (unchanged behaviour)', () => {
    expect(glmThinkingParam('glm-4.7', undefined)).toEqual({});
    expect(glmThinkingParam('glm-5.3-flash', 'yes' as unknown as boolean)).toEqual({});
  });

  it('🔑 EVERY GLM rung of EVERY tier — build AND plan — asks the capability question, never assumes', () => {
    // Swept from the real source, so a ladder edited later is checked without anybody remembering to.
    //
    // 🔴 THIS CASE CHANGED SHAPE ON 2026-09-17, AND THE REASON MATTERS MORE THAN THE EDIT. It used to
    // assert that NO rung ever receives `{thinking: disabled}` — correct only while every rung was a
    // 5.3+ model, which rejects that field with the hard 400 that produced 280 failures in one build
    // (ee20478d). `glm-4.7-flashx` now leads Weak and Normal, and it is 4.x: sending `disabled` to it
    // is not the bug, it is THE POINT — the whole output budget then goes to code instead of to
    // mandatory reasoning. A blanket "never disabled" would have banned the fix.
    //
    // So the invariant is restated as what it always really was: the field a rung receives must match
    // that rung's CAPABILITY. `disabled` only where it is accepted; never where it would 400. Deleting
    // the assertion would have been the easy way through and would have thrown the guard away with it.
    const rungs = [...Object.values(TIER_LADDERS).flatMap((l) => [...l]), ...Object.values(PLAN_RUNG)];
    const glmRungs = rungs.filter((r) => r.provider === 'GLM');
    expect(glmRungs.length).toBeGreaterThan(0);
    for (const rung of glmRungs) {
      const sent = glmThinkingParam(rung.model, false);
      if (glmCanDisableThinking(rung.model)) {
        // A family that accepts it gets it — this is what makes FlashX immune to budget starvation.
        expect(sent, rung.model).toEqual({ thinking: { type: 'disabled' } });
      } else {
        // The original 280-failure guard, preserved exactly for the always-reasoning families.
        expect(sent, rung.model).not.toEqual({ thinking: { type: 'disabled' } });
      }
    }
  });

  it('🔒 the lead rung of Weak and Normal can be told to stop reasoning — the reason it was chosen', () => {
    // Pins the PROPERTY rather than the id: whatever leads these two tiers must be a family that
    // accepts `disabled`, so the OUTPUT_BUDGET_STARVED class (b3a2c81e: 52 of 68 GLM failures) cannot
    // return through a future lead-rung change that quietly picks an always-reasoning model again.
    for (const tier of ['weak', 'off'] as const) {
      const lead = TIER_LADDERS[tier][0];
      expect(lead.provider, tier).toBe('GLM');
      expect(glmCanDisableThinking(lead.model), `${tier} lead ${lead.model}`).toBe(true);
    }
  });

  it('the runner asks the capability question rather than assembling the field itself', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/providers/OpenAiToolRunner.ts'), 'utf8');
    // The model id is resolved once into `thinkingModel` (ee20478d added a per-model rejection memo
    // that needs the same id), so the call reads differently — the point it pins is unchanged: the
    // runner ASKS the shared helper rather than assembling the field itself.
    expect(src).toContain('glmThinkingParam(thinkingModel, params.thinking)');
    expect(src).not.toMatch(/thinking:\s*\{\s*type:\s*'disabled'\s*\}/);
    // The shape that produced the 400 must be gone from the runner entirely.
    expect(src).not.toContain("params.thinking ? 'enabled' as const : 'disabled' as const");
  });
});

describe('🔴 2 · "spent its budget reasoning" is not "returned nothing"', () => {
  const reasoningOnlyCompletion = {
    model: 'kimi-k2.6',
    choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'let me think…' }, finish_reason: 'length' }],
    usage: { prompt_tokens: 341, completion_tokens: 4833 },
  };

  it('the adapter says so, instead of looking like an empty answer', () => {
    const r = parseOpenAiCompletion(reasoningOnlyCompletion as never);
    expect(r.text).toBe('');
    expect(r.reasoningOnly).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.usage.outputTokens).toBe(4833);
  });

  it('reasoning is NEVER added to the transcript — it is not the answer', () => {
    const r = parseOpenAiCompletion(reasoningOnlyCompletion as never);
    expect(r.rawContent).toEqual([]);
    expect(JSON.stringify(r.rawContent)).not.toContain('let me think');
  });

  it('a real answer is never mislabelled, even when the model also reasoned', () => {
    const r = parseOpenAiCompletion({
      choices: [{ message: { role: 'assistant', content: '<<<FILE a.tsx>>>x<<<ENDFILE>>>', reasoning_content: 'hmm' }, finish_reason: 'stop' }],
    } as never);
    expect(r.reasoningOnly).toBeUndefined();
    expect(r.text).toContain('a.tsx');
  });

  it('a genuinely empty response is not claimed to have been reasoning', () => {
    const r = parseOpenAiCompletion({ choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }] } as never);
    expect(r.reasoningOnly).toBeUndefined();
  });
});

describe('🔴 3 · continuing from nothing is re-issuing the same call', () => {
  it('does NOT continue a truncated response that produced no text', () => {
    // The reported loop: max_tokens + empty body, three times, ~160 s each.
    expect(shouldContinue('max_tokens', 0, '')).toBe(false);
    expect(shouldContinue('length', 0, '   ')).toBe(false);
  });

  it('still continues a genuinely partial answer — the case the feature exists for', () => {
    expect(shouldContinue('max_tokens', 0, '<<<FILE a.tsx>>>const a =')).toBe(true);
    expect(shouldContinue('length', 2, 'partial')).toBe(true);
  });

  it('the attempt cap and the stop-reason test are unchanged', () => {
    expect(shouldContinue('max_tokens', MAX_CONTINUATIONS, 'partial')).toBe(false);
    expect(shouldContinue('stop', 0, 'partial')).toBe(false);
    expect(shouldContinue('end_turn', 0, 'partial')).toBe(false);
  });

  it('a caller that passes no text keeps exactly its old behaviour', () => {
    // Opting in is explicit, so no unread lane changes silently.
    expect(shouldContinue('max_tokens', 0)).toBe(true);
  });

  it('the fast lane passes the text, so the guard is actually live', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(src).toContain('while (shouldContinue(stopReason, attempts, text))');
  });
});

describe('🔴 4 · we asked for money for our own misconfiguration', () => {
  // The report's own breakdown line, verbatim.
  const reported = { GLM: '279 bad-request, 1 other: build budget exhausted before this call could start' };

  it('a repeating permanent failure is recognised as OURS', () => {
    expect(providerFailuresLookMisconfigured(reported)).toBe(true);
  });

  it('and is NOT called a transient outage — it would still be wrong tomorrow', () => {
    expect(providerFailuresLookDegraded(reported)).toBe(false);
  });

  it('covers the two sibling buckets that had the identical hole', () => {
    expect(providerFailuresLookMisconfigured({ KIMI: '12 model-unavailable' })).toBe(true);
    expect(providerFailuresLookMisconfigured({ GLM: '5 auth' })).toBe(true);
  });

  it('one stray failure is NOT enough — suppressing an honest outcome on noise is its own dishonesty', () => {
    expect(providerFailuresLookMisconfigured({ GLM: '1 bad-request' })).toBe(false);
    expect(providerFailuresLookMisconfigured({ GLM: '2 bad-request' })).toBe(false);
  });

  it('a genuine outage is untouched — it stays "degraded", not "ours"', () => {
    const outage = { GLM: '7 rate-limit, 1 timeout' };
    expect(providerFailuresLookMisconfigured(outage)).toBe(false);
    expect(providerFailuresLookDegraded(outage)).toBe(true);
  });

  it('empty / junk input never accuses anybody', () => {
    for (const v of [null, undefined, {}, { GLM: '' }, { GLM: 'nonsense' }]) {
      expect(providerFailuresLookMisconfigured(v as never)).toBe(false);
    }
  });

  it('🔒 the user is NOT asked for money, and is not blamed either', () => {
    const msg = freeTierUpsellMessage('our-configuration');
    expect(msg).not.toMatch(/add credits/i);
    expect(msg).not.toMatch(/strongest engine/i);
    expect(msg).toMatch(/on us/i);
    // Not the user's wording, either — that was the 2026-09-13 mistake in a different coat.
    expect(msg).not.toMatch(/tell me|what the app should do/i);
  });

  it('🔒 WHITE-LABEL — it names no provider and no model', () => {
    const msg = freeTierUpsellMessage('our-configuration').toLowerCase();
    for (const vendor of ['glm', 'z.ai', 'kimi', 'moonshot', 'claude', 'anthropic', 'gemini', 'vertex', 'grok', 'openai', 'gpt']) {
      expect(msg, vendor).not.toContain(vendor);
    }
  });

  it('the other two causes are unchanged', () => {
    expect(freeTierUpsellMessage('engine')).toMatch(/add credits/i);
    expect(freeTierUpsellMessage('no-instruction')).not.toMatch(/add credits/i);
    expect(freeTierUpsellMessage()).toMatch(/add credits/i);
  });

  it('the route consults it, and records the suppression', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(src).toContain('providerFailuresLookMisconfigured(buildDiag.providerFailureBreakdown())');
    // ⚠️ Pinned as a SET, not as a literal condition. The literal was `if (refused || degraded ||
    // misconfigured) {` and broke the day a fourth reason was added (ee20478d's `starved`) — a guard
    // that fails on a CORRECT widening teaches the next reader to edit the test rather than read it.
    // What must hold is that this cause reaches the suppression, and that the suppression still ANDs
    // every cause together in one place.
    const suppress = /if \(([^)]*\bmisconfigured\b[^)]*)\) \{\s*\n\s*buildDiag\.record\(\{\s*\n\s*phase: 'build', severity: 'warning', code: 'UPSELL_SUPPRESSED'/.exec(src);
    expect(suppress, 'the misconfigured cause no longer reaches UPSELL_SUPPRESSED').not.toBeNull();
    expect(suppress![1]).toContain('refused');
    expect(suppress![1]).toContain('degraded');
  });
});
