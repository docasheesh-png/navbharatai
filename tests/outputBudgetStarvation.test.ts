// A TURN THAT COULD NOT BEGIN AN ANSWER IS A FAILURE, NEVER AN ANSWER (autopsy ee20478d, 2026-09-15).
//
// Build ee20478d: three calls, all `ok: true`, all `finish_reason: max_tokens`, all `outputTokens:
// 4833`, all `responseChars: 0`, all `toolCalls: 0`, ~97 s each. Zero files in five minutes. The user
// was told "the model replied without building" and asked to buy a stronger engine.
//
// 4,833 is not a model behaviour — it is FLOOR_TIMEOUT_CAP_MS minus the call overhead, divided by the
// floor rate. The same number appears three times on Kimi in report 58fe8254 and three times on GLM
// here, on different models. Every case below encodes one link in that chain.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  turnStarvedItsBudget, isStarvedBudgetError, starvedBudgetError, STARVED_BUDGET_MESSAGE,
  reconcileFloorBudget, floorTimeoutForTokens,
} from '../src/server/AgentV3/floorBudget';
import { classifyProviderFailure, buildStarvedItsOutputBudget, BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { isTimeoutProviderError, isFatalProviderError, isRateLimitProviderError, isServiceOverloadedError, isHopelesslyOversizedError } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { isModelUnavailableError } from '../src/server/AgentV3/providerErrorClass';
import { isBudgetEndedError } from '../src/server/AgentV3/turnDeadline';
import { parseOpenAiCompletion } from '../src/server/AgentV3/providers/OpenAiToolAdapter';

describe('turnStarvedItsBudget — the real shape from report ee20478d', () => {
  it('the exact turn that failed three times is recognised', () => {
    // finish_reason 'length', reasoning only, nothing to salvage.
    const turn = parseOpenAiCompletion({
      choices: [{ message: { role: 'assistant', content: '', reasoning_content: 'x'.repeat(2000) }, finish_reason: 'length' }],
      usage: { prompt_tokens: 26_344, completion_tokens: 4_833 },
      model: 'glm-5.3-flash',
    } as never);
    expect(turn.text).toBe('');
    expect(turn.toolUses).toHaveLength(0);
    expect(turnStarvedItsBudget(turn)).toBe(true);
  });

  it('a vendor that reports NO reasoning field is caught too — the predicate is provider-independent', () => {
    // This is the half that matters: `reasoning_content` is a GLM/OpenAI-compatible extra. Keying the
    // whole detection on it is how the same class hid across two vendors on two nights.
    expect(turnStarvedItsBudget({ text: '', toolUses: [], truncated: true })).toBe(true);
    expect(turnStarvedItsBudget({ text: '   ', toolUses: [], truncated: true })).toBe(true);
  });

  it('a reasoning-only turn is starved even when the stop reason is not `length`', () => {
    expect(turnStarvedItsBudget({ text: '', toolUses: [], reasoningOnly: true })).toBe(true);
  });

  it('🔒 ANY produced output makes it FALSE — a truncated tool call is a partial success, not a loss', () => {
    // The truncation guard salvages the path of a tool call cut mid-arguments. That must keep flowing
    // to the loop; turning it into a rung failure would throw away files the build already has.
    expect(turnStarvedItsBudget({ text: '', toolUses: [{ id: 'a' }], truncated: true })).toBe(false);
    expect(turnStarvedItsBudget({ text: 'Creating the files now.', toolUses: [], truncated: true })).toBe(false);
  });

  it('an ordinary complete turn is never starved', () => {
    expect(turnStarvedItsBudget({ text: 'Done.', toolUses: [] })).toBe(false);
    expect(turnStarvedItsBudget({ text: '', toolUses: [] })).toBe(false); // empty but NOT truncated
    expect(turnStarvedItsBudget(null)).toBe(false);
    expect(turnStarvedItsBudget(undefined)).toBe(false);
  });
});

describe('🔒 the error must survive every classifier it passes — each miss sends the reader somewhere wrong', () => {
  const err = starvedBudgetError(4_833, 32_000);

  it('is recognised as itself', () => {
    expect(isStarvedBudgetError(err)).toBe(true);
    expect(isStarvedBudgetError(new Error('something else'))).toBe(false);
    expect(isStarvedBudgetError(null)).toBe(false);
  });

  it('carries the arithmetic, so the admin report shows numbers rather than an adjective', () => {
    expect(err.message).toContain('4833');
    expect(err.message).toContain('32000');
  });

  it('is NOT a timeout — benching a healthy vendor for our own ceiling is the wrong repair', () => {
    expect(isTimeoutProviderError(err)).toBe(false);
  });

  it('is NOT model-unavailable — the rung is perfectly reachable and must not be retired for ever', () => {
    expect(isModelUnavailableError(err)).toBe(false);
  });

  it('is not mistaken for any other provider class', () => {
    expect(isFatalProviderError(err)).toBe(false);
    expect(isRateLimitProviderError(err)).toBe(false);
    expect(isServiceOverloadedError(err)).toBe(false);
    expect(isHopelesslyOversizedError(err)).toBe(false);
    expect(isBudgetEndedError(err)).toBe(false);
  });

  it('gets its OWN bucket — never `context-length`, which would blame the user’s prompt', () => {
    expect(classifyProviderFailure(err)).toBe('output-budget');
    expect(classifyProviderFailure(err.message)).toBe('output-budget');
  });
});

describe('the honesty path — an HTTP 200 that produced nothing must reach the checks that read the ledger', () => {
  it('one occurrence is enough, because the budget is a constant for the run', () => {
    expect(buildStarvedItsOutputBudget({ GLM: '1 output-budget' })).toBe(true);
    expect(buildStarvedItsOutputBudget({ GLM: '3 rate-limit, 1 output-budget' })).toBe(true);
    expect(buildStarvedItsOutputBudget({ GLM: '3 rate-limit' })).toBe(false);
    expect(buildStarvedItsOutputBudget({})).toBe(false);
    expect(buildStarvedItsOutputBudget(null)).toBe(false);
  });

  it('a starved rung raises OUTPUT_BUDGET_STARVED on its FIRST occurrence, once per provider', () => {
    const diag = new BuildDiagnostics();
    diag.recordProviderFailure('GLM', starvedBudgetError(4_833, 32_000));
    diag.recordProviderFailure('GLM', starvedBudgetError(4_833, 32_000));
    const hits = diag.report().issues.filter((f) => f.code === 'OUTPUT_BUDGET_STARVED');
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('warning');
    expect(hits[0].autoResolved).toBe(false);
    expect(buildStarvedItsOutputBudget(diag.providerFailureBreakdown())).toBe(true);
  });

  it('🔒 the finding never names a vendor product or blames the user (White-Label Law)', () => {
    const diag = new BuildDiagnostics();
    diag.recordProviderFailure('GLM', starvedBudgetError(4_833, 32_000));
    const msg = diag.report().issues.find((f) => f.code === 'OUTPUT_BUDGET_STARVED')!.message;
    // Admin-facing, so the bench NAME is allowed; what must not appear is the claim that the provider
    // was down or that the prompt was at fault — the two readings that send someone to the wrong fix.
    expect(msg.toLowerCase()).toContain('not a provider outage');
    expect(msg.toLowerCase()).toContain('our own output ceiling');
  });
});

describe('🔒 the wiring — every half of this fix, pinned where it lives', () => {
  const runner = readFileSync('src/server/AgentV3/providers/OpenAiToolRunner.ts', 'utf8');
  const chain = readFileSync('src/server/AgentV3/providers/MultiProviderTurnRunner.ts', 'utf8');
  const loop = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('the rung THROWS instead of returning a turn nobody can use', () => {
    // ⚠️ The pinned literal gained a third argument on 2026-09-17 (autopsy f5351721). The behaviour
    // this case guards — throw, never return an unusable turn — is unchanged; the flag only tells the
    // report whether the ceiling that ran out was OURS or the full ask, so an unclamped starvation
    // cannot be mis-reported as our arithmetic. Updated rather than loosened: a substring match on
    // `throw starvedBudgetError(` would have survived this edit and every future one, which is the
    // opposite of what a reversion guard is for.
    // ⚠️ Updated again on 2026-09-17: the throw is now inside a block, because a CLAMPED starvation is
    // first recorded in the learned-capability memo (`rememberStarvedWhileClamped`) so this model is
    // never clamped again in this process. The behaviour this case guards — throw, never return an
    // unusable turn — is unchanged, and the two lines are pinned together so neither can be dropped.
    expect(runner).toContain('if (!budget.reasoningUnclamped) rememberStarvedWhileClamped(thinkingModel);');
    expect(runner).toContain('throw starvedBudgetError(budget.maxTokens, budget.requested, budget.reasoningUnclamped);');
    expect(runner).toContain('if (turnStarvedItsBudget(result)) {');
  });

  it('the chain retires the starved rung by MODEL, so sibling rungs and the backstop survive', () => {
    expect(chain).toContain('(isModelUnavailableError(err) || isStarvedBudgetError(err)) && entry.modelId');
    expect(chain).toContain('isFatalProviderError(err) || isModelUnavailableError(err) || isStarvedBudgetError(err)');
  });

  it('the loop does not nudge a model that never got to answer, and does not append an empty turn', () => {
    expect(loop).toContain('const starvedTurn = turnStarvedItsBudget(turn);');
    expect(loop).toContain('if (!starvedTurn && expectsArtifacts && totalToolUses === 0 && noBuildNudges < MAX_BUILD_NUDGES)');
    expect(loop).toContain('if (!starvedTurn) {\n          messages.push({ role: \'assistant\', content: turn.rawContent });');
  });

  it('the free-tier upsell is suppressed — a fuller wallet buys a different model, not a different ceiling', () => {
    expect(route).toContain('&& buildStarvedItsOutputBudget(buildDiag.providerFailureBreakdown());');
    expect(route).toContain('const emptyCause = misconfigured || starved');
    expect(route).toContain('if (refused || degraded || misconfigured || starved) {');
  });

  it('the user-facing sentence stops claiming the model replied', () => {
    // It never replied. That sentence is what made "add credits" look like the right next step.
    expect(loop).toContain('ran out of room to answer before it began');
  });
});

describe('the arithmetic behind all of it, restated so a retune cannot pass unnoticed', () => {
  it('every floor rung is authorised 4,833 tokens, whatever the loop asks for', () => {
    const budget = reconcileFloorBudget(32_000, floorTimeoutForTokens(32_000));
    expect(budget.maxTokens).toBe(4_833);
    expect(budget.clamped).toBe(true);
  });

  it('the marker is a single shared constant, not a string repeated at each site', () => {
    expect(starvedBudgetError(1, 2).message.startsWith(STARVED_BUDGET_MESSAGE)).toBe(true);
  });
});
