import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  greenReviewPlan,
  greenReviewLeanEnabled,
  reviewerShouldWrite,
  GREEN_REVIEW_MAX_STEPS,
} from '../src/server/AgentV3/greenReviewPolicy';
import { reviewerBudgetMs, GREEN_REVIEW_BUDGET_MS } from '../src/server/AgentV3/PipelineDepth';
import { reviewerInstruction } from '../src/server/AgentV3/ReviewerAgent';

/**
 * 💸 A SUGGESTION COSTS A SUGGESTION'S PRICE (autopsy b6f88a72, 2026-09-18).
 *
 * Green Stop already makes the reviewer suggest-only on a proven-green app. It ran anyway at full
 * budget and the full 40-step cap: `src/App.tsx` read six times, `src/index.css` five, 523,374 input
 * tokens — 34% of the build's LLM spend — and zero characters back. The cut is in TOKENS, never in
 * strictness: where the reviewer can write, nothing here changes.
 */

const ENV_ON = {} as NodeJS.ProcessEnv;

describe('the plan is the write decision, reused — never a second "is it green?" rule', () => {
  it('a proven-green, successful build gets a lean, suggest-only review', () => {
    const plan = greenReviewPlan({ previewGreen: true, previewProvenBroken: false, buildOk: true, env: ENV_ON });
    expect(plan.mode).toBe('suggest');
    expect(plan.maxSteps).toBe(GREEN_REVIEW_MAX_STEPS);
    // …and that is exactly the case where the reviewer may not write.
    expect(reviewerShouldWrite({ previewGreen: true, previewProvenBroken: false, buildOk: true, env: ENV_ON })).toBe(false);
  });

  it('🔒 where the reviewer can WRITE, nothing changes — proven broken, or a failed build', () => {
    // The write rule, read from greenReviewPolicy.ts: the reviewer may write only when the app is NOT
    // green AND (the build failed OR the app was positively seen broken). Those two are the full-power
    // states, and they are untouched.
    for (const input of [
      { previewGreen: false, previewProvenBroken: true, buildOk: true },
      { previewGreen: false, previewProvenBroken: false, buildOk: false },
    ]) {
      expect(reviewerShouldWrite({ ...input, env: ENV_ON }), JSON.stringify(input)).toBe(true);
      const plan = greenReviewPlan({ ...input, env: ENV_ON });
      expect(plan, JSON.stringify(input)).toEqual({ mode: 'full', maxSteps: undefined });
    }
  });

  it('⚠️ "could not look" is ALSO lean — on purpose, because the write rule already made it suggest-only', () => {
    // Not green, not proven broken, build ok: the preview could not be opened at all. Green Stop's own
    // rule (admin 2026-08-23) says ignorance is not a licence to edit, so this review can only produce
    // an offer — and an offer costs an offer's price. The first draft of this test expected "full"
    // here and was wrong; the derived case below is what caught it.
    const input = { previewGreen: false, previewProvenBroken: false, buildOk: true };
    expect(reviewerShouldWrite({ ...input, env: ENV_ON })).toBe(false);
    expect(greenReviewPlan({ ...input, env: ENV_ON }).mode).toBe('suggest');
  });

  it('the plan can never say "suggest" where the write rule says "write"', () => {
    for (const previewGreen of [true, false]) {
      for (const previewProvenBroken of [true, false]) {
        for (const buildOk of [true, false]) {
          const plan = greenReviewPlan({ previewGreen, previewProvenBroken, buildOk, env: ENV_ON });
          const canWrite = reviewerShouldWrite({ previewGreen, previewProvenBroken, buildOk, env: ENV_ON });
          expect(plan.mode === 'suggest', `${previewGreen}/${previewProvenBroken}/${buildOk}`).toBe(!canWrite);
        }
      }
    }
  });

  it('the kill switch restores the old price; unset means on', () => {
    expect(greenReviewLeanEnabled(ENV_ON)).toBe(true);
    const off = { AGENTV3_GREEN_REVIEW_LEAN: 'off' } as NodeJS.ProcessEnv;
    expect(greenReviewLeanEnabled(off)).toBe(false);
    expect(greenReviewPlan({ previewGreen: true, previewProvenBroken: false, buildOk: true, env: off })).toEqual({ mode: 'full', maxSteps: undefined });
  });

  it('the step cap is a real cut against the ordinary sub-agent cap of 40', () => {
    expect(GREEN_REVIEW_MAX_STEPS).toBeLessThan(40);
    expect(GREEN_REVIEW_MAX_STEPS).toBeGreaterThanOrEqual(6); // glob + a few reads + an answer
  });
});

describe('the time budget on a green app', () => {
  it('is capped at the floor — never below what a not-green review gets at the wall-clock margin', () => {
    expect(GREEN_REVIEW_BUDGET_MS).toBe(45_000);
    expect(reviewerBudgetMs(40, Infinity, 40, { previewGreen: true })).toBe(45_000);   // would be 170s
    expect(reviewerBudgetMs(500, Infinity, 500, { previewGreen: true })).toBe(45_000); // would be 210s
    expect(reviewerBudgetMs(8, Infinity, 8, { previewGreen: true })).toBe(45_000);     // would be 90s
  });
  it('🔒 not-green keeps every number it always had', () => {
    expect(reviewerBudgetMs(8, Infinity)).toBe(90_000);
    expect(reviewerBudgetMs(40, Infinity)).toBe(170_000);
    expect(reviewerBudgetMs(500, Infinity)).toBe(210_000);
    expect(reviewerBudgetMs(40, 120_000)).toBe(60_000);
    expect(reviewerBudgetMs(40, Infinity, 40, { previewGreen: false })).toBe(170_000);
    expect(reviewerBudgetMs(40, Infinity, 40, {})).toBe(170_000);
  });
  it('still honours the wall-clock safety margin and the floor on a green app', () => {
    expect(reviewerBudgetMs(40, 70_000, 40, { previewGreen: true })).toBe(45_000);
    expect(reviewerBudgetMs(40, 0, 40, { previewGreen: true })).toBe(45_000);
  });
});

describe('the reviewer is TOLD it is suggest-only, and how to spend', () => {
  const base = {
    userRequest: 'a gita reader with bookmarks',
    fileTree: ['src/App.tsx', 'src/theme.tsx', 'index.html'],
    fileSample: [{ path: 'src/App.tsx', content: 'export default function App() {}' }],
    changedFiles: ['src/App.tsx'],
  };
  it('suggest mode names the fact and the budget', () => {
    const text = reviewerInstruction({ ...base, mode: 'suggest' });
    expect(text).toMatch(/PROVEN TO RENDER IN A REAL BROWSER/);
    expect(text).toMatch(/SUGGEST-ONLY/);
    expect(text).toMatch(/nothing you\s+report can fail the build/);
    expect(text).toMatch(/Read each file you need ONCE/);
    expect(text).toMatch(/Do not call\s+second_opinion/);
  });
  it('🔒 full mode is byte-identical to a review with no mode at all', () => {
    expect(reviewerInstruction({ ...base, mode: 'full' })).toBe(reviewerInstruction(base));
    expect(reviewerInstruction(base)).not.toMatch(/SUGGEST-ONLY/);
  });
  it('the ordinary review body is intact under both modes', () => {
    for (const mode of ['full', 'suggest'] as const) {
      const text = reviewerInstruction({ ...base, mode });
      expect(text).toContain('USER REQUEST: "a gita reader with bookmarks"');
      expect(text).toContain('[CRITICAL]');
      expect(text).toContain('Score: N/100');
    }
  });
});

/**
 * 🔒 REVERSION GUARD, READ FROM THE ROUTE. Every case above passes against a route that never asks
 * for the plan. The wiring is asserted where it lives: the plan is computed from the same three facts
 * the write decision uses, the lean spawn shares the hoisted deps, the budget is told, and the mode
 * reaches reviewBuild.
 */
describe('the wiring in routes/agentv3.ts', () => {
  const src = readFileSync(new URL('../src/server/routes/agentv3.ts', import.meta.url), 'utf8');
  it('the plan is asked with previewGreen, previewProvenBroken and result.ok', () => {
    expect(src).toMatch(/const reviewPlan = greenReviewPlan\(\{ previewGreen, previewProvenBroken, buildOk: result\.ok \}\);/);
  });
  it('the lean spawn is the SAME deps with only the step cap (and its own stop signal) changed', () => {
    // The review has carried its own abort signal since autopsy 3a0a8f7f — see
    // theReviewerStopsWhenWeStopWaiting.test.ts. The step cap still applies only when the plan sets one.
    expect(src).toMatch(/makeSubAgentSpawn\(\{\s*\.\.\.subAgentDeps,\s*signal: reviewAbort\.signal,\s*\.\.\.\(reviewPlan\.maxSteps !== undefined \? \{ maxSteps: reviewPlan\.maxSteps \} : \{\}\),\s*\}\)/);
    expect(src).toMatch(/const spawnSubAgent = makeSubAgentSpawn\(subAgentDeps\);/);
  });
  it('the budget and the review are both told', () => {
    expect(src).toMatch(/reviewerBudgetMs\(rFiles\.length, reviewHeadroomMs, projectFileCount, \{ previewGreen: reviewPlan\.mode === 'suggest' \}\)/);
    expect(src).toMatch(/spawn: reviewSpawn,\s*mode: reviewPlan\.mode,/);
  });
  it('and the report says so', () => {
    expect(src).toContain("code: 'REVIEW_LEAN'");
  });
});
