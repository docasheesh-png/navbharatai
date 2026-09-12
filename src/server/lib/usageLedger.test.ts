import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { summariseUsage, marginInr, type UsageLogRow } from './usageLedger';

/**
 * THE DASHBOARD REPORTED A PROFIT ON A LOSS-MAKING DAY.
 *
 * `totalProviderCost` summed a field whose only writer wrote a hardcoded 0, so cost was structurally
 * zero and "PLATFORM MARGIN" was revenue with a different label — ₹155 "margin" beside an engine-cost
 * panel showing ₹1,223 of spend, on the same screen.
 *
 * Every test here defends the one rule that prevents a repeat: **an unmeasured call is not a free
 * call.** Summing an unknown as zero is how the first version got it wrong, and doing it again more
 * carefully would be the same bug with better arithmetic.
 */

// A trivially predictable price: 1 unit per 1,000 tokens, so the expected sums are obvious.
const price = (_p: string, _m: string, u: { inputTokens: number; outputTokens: number }) =>
  (u.inputTokens + u.outputTokens) / 1000;

const measured = (provider: string, outputTokens: number, extra: Partial<UsageLogRow> = {}): UsageLogRow =>
  ({ providerName: provider, modelName: 'm1', usageMeasured: true, inputTokens: 0, outputTokens, ...extra });

describe('summariseUsage', () => {
  it('prices the calls a provider really reported', () => {
    const s = summariseUsage([measured('KIMI', 2000), measured('GLM', 1000)], price);
    expect(s.costUsd).toBeCloseTo(3);
    expect(s.outputTokens).toBe(3000);
    expect(s.measuredCalls).toBe(2);
    expect(s.complete).toBe(true);
  });

  it('🔒 an UNMEASURED call is counted, never summed as free', () => {
    const s = summariseUsage([measured('KIMI', 1000), { providerName: 'KIMI', usageMeasured: false }], price);
    expect(s.measuredCalls).toBe(1);
    expect(s.unmeasuredCalls).toBe(1);
    expect(s.costUsd).toBeCloseTo(1);
    // The important one: the total is now a FLOOR, and the caller must say so.
    expect(s.complete).toBe(false);
  });

  it('🔒 an OLD row with no usage flag is unmeasured, not zero-cost', () => {
    // These are the rows written before the chat route recorded real usage. Treating their absent
    // tokens as 0 is precisely what made the cost panel read ₹0.0000.
    const s = summariseUsage([{ providerName: 'auto', modelName: 'auto', outputTokens: 45000 }], price);
    expect(s.unmeasuredCalls).toBe(1);
    expect(s.outputTokens).toBe(0);
    expect(s.costUsd).toBe(0);
    expect(s.complete).toBe(false);
  });

  it('🔒 the literal "auto" is not a provider — it is what the old logger wrote when it did not know', () => {
    const s = summariseUsage([measured('auto', 1000)], price);
    expect(Object.keys(s.byProvider)).toEqual(['unknown']);
    expect(s.byProvider.unknown.requests).toBe(1);
  });

  it('a call whose price cannot be computed keeps the total a floor', () => {
    const s = summariseUsage([measured('KIMI', 1000)], () => NaN);
    expect(s.complete).toBe(false);
    expect(s.costUsd).toBe(0);
  });

  it('a throwing price function never takes the dashboard down', () => {
    const s = summariseUsage([measured('KIMI', 1000)], () => { throw new Error('no rate'); });
    expect(s.calls).toBe(1);
    expect(s.complete).toBe(false);
  });

  it('groups per provider with its own tokens and cost', () => {
    const s = summariseUsage([measured('KIMI', 2000), measured('KIMI', 1000), measured('GLM', 500)], price);
    expect(s.byProvider.KIMI.requests).toBe(2);
    expect(s.byProvider.KIMI.outputTokens).toBe(3000);
    expect(s.byProvider.GLM.costUsd).toBeCloseTo(0.5);
  });

  it('🔒 a MISSING latency does not drag an average down to zero', () => {
    const s = summariseUsage([
      measured('KIMI', 100, { latencyMs: 400 }),
      measured('KIMI', 100),
    ], price);
    expect(s.byProvider.KIMI.avgLatencyMs).toBe(400);
  });

  it('no latency at all is null, never 0 — "we did not record it" is not "instant"', () => {
    const s = summariseUsage([measured('KIMI', 100)], price);
    expect(s.byProvider.KIMI.avgLatencyMs).toBeNull();
  });

  it('an empty window is complete and costs nothing — nothing ran, so nothing is unknown', () => {
    const s = summariseUsage([], price);
    expect(s).toMatchObject({ calls: 0, costUsd: 0, complete: true });
  });

  it('survives junk rather than throwing', () => {
    expect(summariseUsage(null, price).calls).toBe(0);
    expect(summariseUsage([null as never, 'x' as never], price).calls).toBe(0);
    // A NEGATIVE count is present-and-corrupt, which is not the same as absent: the row is untrusted
    // whole, because pricing its other half would make a confident number out of a broken record.
    expect(summariseUsage([measured('K', -5)], price).unmeasuredCalls).toBe(1);
  });
});

describe('marginInr', () => {
  it('is exact only when every call was priced', () => {
    expect(marginInr(155, 1223, true)).toEqual({ valueInr: -1068, exact: true });
    expect(marginInr(155, 1223, false).exact).toBe(false);
  });

  it('🔒 a loss is reported as a loss', () => {
    // The real window that exposed this: ₹155 revenue against ₹1,223 of AI spend.
    expect(marginInr(155, 1223, true).valueInr).toBeLessThan(0);
  });
});

describe('🔒 the wiring — the old fabrications must be gone, not merely unused', () => {
  /**
   * Source with `//` comment lines removed.
   *
   * 🔒 EVERY ASSERTION BELOW MUST MATCH CODE, NEVER PROSE. Twice while writing these tests, an
   * assertion that the old fabricated field was gone failed against the COMMENT explaining why it is
   * gone — a test that fails while the code is right, which is worse than no test because the
   * tempting fix is to weaken it. A fix worth explaining leaves its old name in the explanation, so
   * the explanation has to be excluded once, here, rather than worked around per assertion.
   */
  const codeOf = (rel: string): string =>
    readFileSync(resolve(__dirname, rel), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

  const chat = readFileSync(resolve(__dirname, '../routes/chat.ts'), 'utf8');
  const admin = codeOf('../routes/admin.ts');
  const router = codeOf('../AI/UniversalAIRouter.ts');

  /**
   * Only the CODE of the usage-log write, never the prose around it.
   *
   * The first version of these assertions searched the whole file and failed against the comment that
   * quotes the old fabricated fields — a test that fails while the code is right, which is the trap
   * this repo has already been bitten by twice. Lines are stripped of `//` comments before matching.
   */
  const logWriteCode = (() => {
    const at = chat.indexOf("addDoc(collection(getDb() as any, 'ai_usage_logs')");
    expect(at).toBeGreaterThan(-1);
    return chat.slice(at, chat.indexOf('res.json({ reply:', at))
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  })();

  it('the chat route no longer invents a token count from string length', () => {
    expect(logWriteCode).not.toMatch(/\.length\s*\|\|\s*0\)\s*\/\s*4/);
    expect(logWriteCode).not.toContain('aiResponse.length');
  });

  it('🔒 the chat route no longer writes a hardcoded provider, model or cost', () => {
    expect(logWriteCode).not.toContain("providerName: 'auto'");
    expect(logWriteCode).not.toContain("modelName: 'auto'");
    expect(logWriteCode).not.toContain('estimated_provider_cost');
  });

  it('the chat route records whether usage was measured at all', () => {
    expect(logWriteCode).toContain('usageMeasured');
    expect(logWriteCode).toContain('routed.provider');
  });

  it('the router hands back the provider it really used', () => {
    expect(router).toContain('routeDetailed');
    expect(router).toContain('telemetry?.provider');
  });

  it('🔒 admin analytics no longer SUMS the dead field', () => {
    // The name survives in the comment explaining why it is gone; what must not survive is the sum.
    expect(admin).not.toMatch(/\+=\s*log\.estimated_provider_cost/);
    expect(admin).toContain('summariseUsage');
  });

  it('🔒 the margin carries its own certainty, so a floor cannot read as a fact', () => {
    expect(admin).toContain('providerCostComplete');
    expect(admin).toContain('marginInr(');
  });

  it('🔒 health no longer scores deploy recency as uptime — at EITHER endpoint', () => {
    // There are two health endpoints and both fed process.uptime(); fixing one would have left the
    // platform still reading CRITICAL for a day after every deploy on the other.
    expect(admin).not.toMatch(/uptimeSeconds:\s*process\.uptime\(\)/);
    expect((admin.match(/uptimeSeconds: null/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
