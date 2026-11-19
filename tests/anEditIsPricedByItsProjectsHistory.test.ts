// 🔴 failedbr #2437 (fe73bca3); admin 2026-11-19: "edit/update se pahle estimate kharcha napa jaye; user ke wallet me paise
// kam hon to build shuru hi na ho". The admission gate already refused a build the balance could not cover — but priced it
// from the PROMPT'S WORDS: "Fix this error and continue building the app: network error" names nothing, so an edit of a
// 37-file app got the minimum estimate, started, and was stopped by the wallet mid-build. The estimate is now the larger
// of the prompt estimate and the median real cost of this workspace's recent builds, priced with the SAME billedAmountInr.
// Reversion: drop the history floor from either admission path and this fails.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { historyEstimateInr, estimateBuildCost } from '../src/server/AgentV3/PreflightEstimate';
import { billedAmountInr } from '../src/server/AgentV3/pricing';

const RATE = 85;
const big = { inputTokens: 900_000, outputTokens: 14_000, cacheReadInputTokens: 600_000 };

describe('historyEstimateInr', () => {
  it('no history ⇒ null (the prompt estimate stands alone)', () => {
    expect(historyEstimateInr([], 'weak', RATE)).toBeNull();
    expect(historyEstimateInr([{}, { tokenUsage: { inputTokens: 0, outputTokens: 0 } }], 'weak', RATE)).toBeNull();
  });
  it('the median of the recent builds, priced with the same billedAmountInr', () => {
    const one = billedAmountInr({ inputTokens: 100_000, outputTokens: 5_000 }, 'weak', RATE);
    const two = billedAmountInr(big, 'weak', RATE);
    const three = billedAmountInr({ inputTokens: 5_000_000, outputTokens: 80_000 }, 'weak', RATE);
    const got = historyEstimateInr([{ tokenUsage: { inputTokens: 100_000, outputTokens: 5_000 } }, { tokenUsage: big }, { tokenUsage: { inputTokens: 5_000_000, outputTokens: 80_000 } }], 'weak', RATE);
    expect(got).toBeCloseTo(two, 6);
    expect(got).toBeGreaterThan(one);
    expect(got).toBeLessThan(three); // one huge build is not the rule
  });
  it('cache-served input is priced at its own rate, never as full input', () => {
    const withCache = historyEstimateInr([{ tokenUsage: big }], 'weak', RATE) as number;
    const asFull = billedAmountInr({ inputTokens: big.inputTokens, outputTokens: big.outputTokens }, 'weak', RATE);
    expect(withCache).toBeLessThanOrEqual(asFull);
  });
  it('the #2437 shape: an edit prompt with no named features is priced far below its project history', () => {
    const prompt = 'Fix this error and continue building the app:\n\nnetwork error';
    expect(estimateBuildCost(prompt, 'weak', RATE).inr).toBeLessThan(historyEstimateInr([{ tokenUsage: big }], 'weak', RATE) as number);
  });
});

describe('the admission gate uses it on both estimate paths', () => {
  const src = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  it('both estimates take the history floor', () => {
    expect((src.match(/const estimate = withHistoryFloor\(surplusSession/g) ?? []).length).toBe(2);
    expect((src.match(/await workspaceHistoryEstimateInr\(workspaceId, powerLevelReqEffective\)\)/g) ?? []).length).toBe(2);
  });
  it('the route passes the workspace', () => {
    expect(src).toMatch(/checkBuilderPaidAdmission\(\{ userId, email, onlyOpus, prompt, powerLevelReqEffective, surplusSession, res, workspaceId,/);
  });
  it('history entries carry the real token totals', () => {
    expect(readFileSync(join(__dirname, '..', 'src/server/AgentV3/DiagnosticsStore.ts'), 'utf8')).toMatch(/tokenUsage: \{ inputTokens, outputTokens/);
  });
});
