/**
 * Autopsy f04421ef, part 2 — a build report must never print an ABSENT measurement as a zero.
 *
 * The report I handed the admin said `GLM: 54 call(s) · 0 in · 0 out` and carried no cache figure. I
 * read both as measurements and told the admin the build had served ZERO tokens from its prefix cache,
 * leaving a 75% saving on the table. Neither number existed: the build had not settled, so nothing had
 * been written to `providerTokens` or `cacheReadInputTokens` at all.
 *
 * These tests hold the three states apart — settled, live, unknown — so the renderer can never again
 * present the third as the first.
 */
import { describe, it, expect } from 'vitest';
import { BuildDiagnostics, tokenUsageView, renderDiagnosticsText, userFacingReport } from '../src/server/AgentV3/BuildDiagnostics';

const tokens = (i: number, o: number) => ({ inputTokens: i, outputTokens: o });

describe('tokenUsageView — three states, never collapsed into one', () => {
  it('settled: the reconciled figure wins and carries no caveat', () => {
    const v = tokenUsageView({ providerTokens: { GLM: tokens(100, 10) }, cacheReadInputTokens: 80 });
    expect(v.state).toBe('settled');
    expect(v.tokens).toEqual({ GLM: tokens(100, 10) });
    expect(v.cacheReadInputTokens).toBe(80);
    expect(v.label).toBe('');
    expect(v.caveat).toBeNull();
  });

  it('live: real numbers, labelled unsettled, and stated to be an UNDER-count', () => {
    const v = tokenUsageView({ liveTokens: { GLM: tokens(50, 5) }, liveCacheReadInputTokens: 40 });
    expect(v.state).toBe('live');
    expect(v.tokens).toEqual({ GLM: tokens(50, 5) });
    expect(v.cacheReadInputTokens).toBe(40);
    expect(v.label).toMatch(/LIVE/);
    // The direction of the error matters: a reader must know the real figure is HIGHER, not lower.
    expect(v.caveat).toMatch(/HIGHER/);
  });

  it('unknown: no tokens at all, and the caveat says absence — not zero', () => {
    const v = tokenUsageView({});
    expect(v.state).toBe('unknown');
    expect(v.tokens).toBeUndefined();
    expect(v.caveat).toMatch(/not a measured zero/i);
  });

  it('an EMPTY token record is not a settled measurement', () => {
    expect(tokenUsageView({ providerTokens: {} }).state).toBe('unknown');
    expect(tokenUsageView({ providerTokens: {}, liveTokens: { GLM: tokens(1, 1) } }).state).toBe('live');
  });

  it('settled beats live even when both are present', () => {
    const v = tokenUsageView({ providerTokens: { GLM: tokens(9, 9) }, liveTokens: { GLM: tokens(1, 1) } });
    expect(v.state).toBe('settled');
    expect(v.tokens).toEqual({ GLM: tokens(9, 9) });
  });
});

describe('the rendered report', () => {
  const render = (build: (d: BuildDiagnostics) => void): string => {
    let n = 1_000;
    const d = new BuildDiagnostics({ now: () => (n += 1_000) });
    build(d);
    return renderDiagnosticsText(d.report());
  };

  it('THE BUG: a provider with call counts but no tokens says so, instead of printing 0 in / 0 out', () => {
    const text = render((d) => { d.recordProviderTurn('GLM'); d.recordProviderTurn('GLM'); });
    expect(text).toMatch(/GLM\s*: 2 call\(s\) · tokens not recorded/);
    expect(text).not.toMatch(/0 in · 0 out/);
  });

  it('a mid-build report prints the live totals and labels them unsettled', () => {
    const text = render((d) => {
      d.recordProviderTurn('GLM');
      d.setLiveUsage({ GLM: tokens(120_000, 3_400) }, 90_000);
    });
    expect(text).toMatch(/LIVE, build not settled/);
    expect(text).toMatch(/120,000 in/);
    expect(text).toMatch(/HIGHER/);
  });

  it('a settled report is byte-identical in shape to before — no LIVE label, no caveat', () => {
    const text = render((d) => {
      d.recordProviderTurn('GLM');
      d.setProviderTokens({ GLM: tokens(120_000, 3_400) });
    });
    expect(text).toMatch(/120,000 in · 3,400 out · 123,400 total/);
    expect(text).not.toMatch(/LIVE/);
    expect(text).not.toMatch(/tokens not recorded/);
  });
});

describe('setLiveUsage — the separation that keeps it out of billing', () => {
  it('settling REPLACES the live snapshot rather than leaving two answers on one report', () => {
    const d = new BuildDiagnostics();
    d.setLiveUsage({ GLM: tokens(50, 5) }, 40);
    expect(d.report().liveTokens).toEqual({ GLM: tokens(50, 5) });
    d.setProviderTokens({ GLM: tokens(120, 12) });
    expect(d.report().liveTokens).toBeUndefined();
    expect(d.report().liveCacheReadInputTokens).toBeUndefined();
    expect(d.report().providerTokens).toEqual({ GLM: tokens(120, 12) });
  });

  it('a late live snapshot can never overwrite the settled, billed figure', () => {
    const d = new BuildDiagnostics();
    d.setProviderTokens({ GLM: tokens(120, 12) });
    d.setLiveUsage({ GLM: tokens(1, 1) });
    expect(d.report().providerTokens).toEqual({ GLM: tokens(120, 12) });
    expect(d.report().liveTokens).toBeUndefined();
  });

  it('an empty snapshot writes nothing, and a bad cache count is dropped rather than stored as junk', () => {
    const d = new BuildDiagnostics();
    d.setLiveUsage({});
    expect(d.report().liveTokens).toBeUndefined();
    d.setLiveUsage({ GLM: tokens(5, 1) }, Number.NaN);
    expect(d.report().liveCacheReadInputTokens).toBeUndefined();
    d.setLiveUsage({ GLM: tokens(5, 1) }, -3);
    expect(d.report().liveCacheReadInputTokens).toBeUndefined();
  });

  it('it replaces, never accumulates — the ledger already holds the running total', () => {
    const d = new BuildDiagnostics();
    d.setLiveUsage({ GLM: tokens(10, 1) });
    d.setLiveUsage({ GLM: tokens(30, 3) });
    expect(d.report().liveTokens).toEqual({ GLM: tokens(30, 3) });
  });

  it('persists in real time, so a report read mid-build actually has the numbers', () => {
    const seen: number[] = [];
    const d = new BuildDiagnostics({ onUpdate: (r) => seen.push(r.liveTokens?.GLM?.inputTokens ?? -1) });
    d.setLiveUsage({ GLM: tokens(10, 1) });
    expect(seen).toContain(10);
  });
});

describe('the White-Label Law still holds', () => {
  it('liveTokens never reaches a user-facing report', () => {
    const d = new BuildDiagnostics();
    d.setLiveUsage({ GLM: tokens(10, 1) }, 5);
    const out = userFacingReport(d.report()) as Record<string, unknown>;
    expect(out.liveTokens).toBeUndefined();
    expect(out.liveCacheReadInputTokens).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/GLM/);
  });
});

describe('a weak build leaking Sonnet is catchable BEFORE it settles', () => {
  it('claudeProviderDelivered sees the live snapshot, not only the settled one', () => {
    const d = new BuildDiagnostics();
    d.setLiveUsage({ CLAUDE: tokens(10, 1) });
    expect(d.claudeProviderDelivered()).toBe('CLAUDE');
  });

  it('the authorized Haiku backstop is still clean', () => {
    const d = new BuildDiagnostics();
    d.setLiveUsage({ CLAUDE_HAIKU: tokens(10, 1) });
    expect(d.claudeProviderDelivered()).toBeNull();
  });
});
