import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { canFinishAfterPreamble, preambleBailReason, canFinishRemainingTiers } from '../src/server/AgentV3/FastLaneBudget';

/**
 * ADMIN REPORT 2026-08-12 — the dukaan stock app. A lane that sat for its entire budget and produced
 * nothing, when it could have known better before writing file one.
 *
 *     SIMPLE_BUILD_FALLBACK   detail: "simple-build timed out after 240000ms"
 *     PROVIDER_FALLBACK ×8    "Provider KIMI failed"  detail: "Request timed out."
 *     PROVIDER_FALLBACK ×4    "Provider GLM failed"   detail: "429 … temporarily overloaded"
 *
 * `canFinishRemainingTiers` was built for exactly this — bail when the arithmetic says the lane cannot
 * finish. It did not fire, and the reason is structural: it runs BETWEEN tiers, so it needs a COMPLETED
 * tier to measure. It therefore protects a lane that starts well and slows down, and not at all a lane
 * whose FIRST tier never completes — which is precisely what a timing-out provider produces.
 *
 * And it was knowable. The PLAN call — a real model call, on the same failing provider chain, already
 * finished — had taken **86.6 seconds** (`latencyMs: 86616` in the report's own call log). Three tiers at
 * that latency need ~260s. The lane had ~144s left. It was doomed with 8 files unwritten and 144 seconds
 * still to burn.
 */

const DUKAAN = { preambleCallMs: 86_616, tiers: 3, elapsedMs: 96_000, overallMs: 240_000 };

describe('the 144 seconds spent after the answer was already knowable', () => {
  it('bails on the report\'s exact numbers', () => {
    expect(canFinishAfterPreamble(DUKAAN)).toBe(false);
  });

  it('the reason names the measurement, in the user\'s terms and no vendor\'s', () => {
    const r = preambleBailReason(DUKAAN);
    expect(r).toMatch(/planning alone took 87s/);
    expect(r).toMatch(/3 stage\(s\) would need about 356s against a 240s budget/);
    expect(r).not.toMatch(/\b(glm|kimi|claude|anthropic|openai|gemini|grok|sonnet|opus)\b/i);
  });

  it('a HEALTHY lane is untouched — this must not become a lane that quits', () => {
    /**
     * The whole risk of this guard is that it aborts builds that would have finished. A normal plan
     * call is seconds, not a minute and a half, and leaves the projection far inside the budget.
     */
    expect(canFinishAfterPreamble({ preambleCallMs: 8_000, tiers: 3, elapsedMs: 20_000, overallMs: 240_000 })).toBe(true);
    expect(canFinishAfterPreamble({ preambleCallMs: 25_000, tiers: 3, elapsedMs: 40_000, overallMs: 240_000 })).toBe(true);
    expect(canFinishAfterPreamble({ preambleCallMs: 45_000, tiers: 3, elapsedMs: 60_000, overallMs: 240_000 })).toBe(true);
  });

  it('sits exactly on the boundary the same way its sibling does — fits is fits', () => {
    expect(canFinishAfterPreamble({ preambleCallMs: 50_000, tiers: 2, elapsedMs: 140_000, overallMs: 240_000 })).toBe(true);
    expect(canFinishAfterPreamble({ preambleCallMs: 50_001, tiers: 2, elapsedMs: 140_000, overallMs: 240_000 })).toBe(false);
  });

  it('NEVER bails on an absent signal — the rule it inherits from its sibling', () => {
    /**
     * Without a real measured call duration we know nothing, and guessing "too slow" from no evidence
     * abandons healthy builds. Every unknown resolves toward continuing.
     */
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(canFinishAfterPreamble({ ...DUKAAN, preambleCallMs: bad }), String(bad)).toBe(true);
    }
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(canFinishAfterPreamble({ ...DUKAAN, overallMs: bad }), String(bad)).toBe(true);
    }
    expect(canFinishAfterPreamble({ ...DUKAAN, tiers: 0 })).toBe(true);
  });

  it('fewer stages means the same slow plan can still fit', () => {
    // A single-tier manifest runs one stage, so it is judged on one stage — not on three it will
    // never run. 96 + 86.6 = 183 ≤ 240.
    expect(canFinishAfterPreamble({ ...DUKAAN, tiers: 1 })).toBe(true);
    expect(canFinishAfterPreamble({ ...DUKAAN, tiers: 2 })).toBe(false); // 96 + 173 = 269 > 240
  });

  it('does not disturb the between-tiers check it sits beside', () => {
    // Two guards, two moments: this one before file one, that one after each tier. Both still hold.
    expect(canFinishRemainingTiers({ tiersRemaining: 2, lastTierMs: 60_000, elapsedMs: 156_000, overallMs: 240_000 })).toBe(false);
    expect(canFinishRemainingTiers({ tiersRemaining: 2, lastTierMs: 10_000, elapsedMs: 60_000, overallMs: 240_000 })).toBe(true);
  });
});

describe('WIRING — measured from the real call, counted from the real manifest', () => {
  const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8');

  it('the projection uses the PLAN call\'s own measured duration', () => {
    // A configured cap would be a guess about the provider; the elapsed time of a call that really ran
    // is a fact about it.
    expect(src).toContain('const planCallMs = Date.now() - laneStartedAt;');
    expect(src).toContain('preambleCallMs: planCallMs');
  });

  it('it counts only the tiers that actually HAVE files', () => {
    // A manifest whose files are all foundation-tier runs one stage; charging it for three would bail
    // lanes that were going to finish.
    expect(src).toContain('const populatedTiers = depOrder');
    expect(src).toContain('manifest.some((s) => generationTier(s.path) === t)');
  });

  it('it runs BEFORE the first file is generated', () => {
    const bail = src.indexOf('canFinishAfterPreamble(');
    const genLoop = src.indexOf('for (let ti = 0; ti < tiers.length; ti++)');
    expect(bail).toBeGreaterThan(-1);
    expect(bail).toBeLessThan(genLoop);
  });

  it('nothing is salvaged, because nothing was generated', () => {
    // The salvage path keys on files that exist. Bailing here produces none, so the handoff is the
    // same one the timeout would have performed — minutes earlier.
    const at = src.indexOf('canFinishAfterPreamble(');
    expect(src.slice(at - 400, at + 600)).toMatch(/nothing to salvage/);
    expect(src).toContain("reason.includes('timed out') || reason.includes('stopped early')");
  });
});
