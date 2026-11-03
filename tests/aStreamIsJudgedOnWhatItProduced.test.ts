/**
 * Autopsy 5413e6f1 — build report #1823 ("Muje ek ai helth coach app bna ke do jisme ek camera ho"), weak tier.
 *
 * kimi-k2.7-code took ~14 s to its first byte on a 37k-token prompt in BOTH of the build's calls (openMs 14,404 /
 * 14,046). The first completed in 60 s. The second was abandoned "for crawling after 15050ms" — one second after
 * it began to answer — because the floor divided its bytes by the fifteen seconds since the REQUEST began. The
 * rung was benched, GLM answered one 429, and the build ended with nothing written. Locked here: once the first
 * byte is in, the floor measures the producing time only, after a short window of it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inBuildWroteThisTurn } from '../src/server/AgentV3/inBuildGreen';
import { streamIsCrawling, STREAM_PRODUCING_WINDOW_MS, STREAM_MIN_CHARS_PER_SEC, STREAM_THROUGHPUT_GRACE_MS } from '../src/server/AgentV3/providers/openAiStream';

const env = {} as NodeJS.ProcessEnv;

describe('🔴 the report case: a provider one second into its answer is not crawling', () => {
  it('first byte at 14,046 ms, judged at 15,050 ms ⇒ NOT crawling (it was abandoned here)', () => {
    // 60 bytes in its first second — healthy for a model that has just started; 60/15 s was under the floor.
    expect(60 / 15.05).toBeLessThan(STREAM_MIN_CHARS_PER_SEC);
    expect(streamIsCrawling({ producedBytes: 60, elapsedMs: 15_050, producingMs: 1_004 }, env)).toBe(false);
  });
  it('it is judged on its own producing rate once it has produced for the window', () => {
    // Healthy: 60 B/s over 6 s of producing.
    expect(streamIsCrawling({ producedBytes: 360, elapsedMs: 20_000, producingMs: 6_000 }, env)).toBe(false);
    // Genuinely crawling: 20 bytes in 10 s of producing.
    expect(streamIsCrawling({ producedBytes: 20, elapsedMs: 24_000, producingMs: 10_000 }, env)).toBe(true);
  });
  it('the producing window is short and the rest of the rule is unchanged', () => {
    expect(STREAM_PRODUCING_WINDOW_MS).toBe(5_000);
    // Inside the throughput grace nothing is judged; zero bytes is still "queued" until the first-byte grace.
    expect(streamIsCrawling({ producedBytes: 1, elapsedMs: STREAM_THROUGHPUT_GRACE_MS - 1, producingMs: 9_000 }, env)).toBe(false);
    expect(streamIsCrawling({ producedBytes: 0, elapsedMs: 20_000 }, env)).toBe(false);
    expect(streamIsCrawling({ producedBytes: 0, elapsedMs: 31_000 }, env)).toBe(true);
    // A caller that does not know the first byte keeps the old whole-call rate exactly.
    expect(streamIsCrawling({ producedBytes: 60, elapsedMs: 15_050 }, env)).toBe(true);
  });
});

describe('🔴 the same build: an untouched app rendering is not the app this turn built', () => {
  // 0 files written, RED gate — and the user read "Your app rendered — this working version is now protected"
  // and "⏱️ Almost done… your app is built". The browser had rendered the PREVIOUS version.
  it('a turn that wrote nothing has not changed the app', () => {
    expect(inBuildWroteThisTurn(0)).toBe(false);
    expect(inBuildWroteThisTurn(1)).toBe(true);
    expect(inBuildWroteThisTurn(Number.NaN)).toBe(false);
  });
  it("🔒 the narration and the ETA's \"app on screen\" both wait for this turn's own write; the restore point does not", () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const at = route.indexOf("if (st === 'saved') {\n                inBuildGreenAt = Date.now();");
    expect(at).toBeGreaterThan(-1);
    const block = route.slice(at, at + 900);
    const gate = block.indexOf('if (inBuildWroteThisTurn(inBuildWriteTick)) {');
    expect(gate).toBeGreaterThan(-1);
    expect(block.indexOf('inBuildGreenNarration()')).toBeGreaterThan(gate);
    expect(block.indexOf('etaAppRenderedAt = inBuildGreenAt')).toBeGreaterThan(gate);
    expect(block.indexOf('billingCtx.appFirstRenderedAt')).toBeLessThan(gate);
  });
});
