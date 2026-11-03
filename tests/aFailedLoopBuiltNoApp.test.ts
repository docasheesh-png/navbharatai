/**
 * Autopsy 8cdb4817 — build report #1817 ("VidyaSetu" concept + database structure), weak tier on SURPLUS.
 *
 * Eight calls wrote four planning documents; the ninth died ("The build engine is temporarily unavailable") with
 * the starter page still showing — and the user then read "⏱️ Almost done… your app is built — running the final
 * checks." The Q-1024 guard asked only "were files written?". Locked here: a loop that ended in failure built no
 * app, whatever it wrote, on BOTH paths that write the line (the immediate announcement and the heartbeat tick).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { etaAppExists, finalChecksEtaLine } from '../src/server/AgentV3/progressEta';

describe('🔴 the report case: files written by a loop that failed are not "your app is built"', () => {
  it('four documents written, then the engine died ⇒ no claim', () => {
    expect(etaAppExists(4, true)).toBe(false);
    expect(finalChecksEtaLine(167_000, etaAppExists(4, true))).not.toContain('your app is built');
  });
  it('the claim still stands for a loop that succeeded with files, and never for zero files', () => {
    expect(etaAppExists(4, false)).toBe(true);
    expect(finalChecksEtaLine(167_000, etaAppExists(4, false))).toContain('your app is built');
    expect(etaAppExists(0, false)).toBe(false);
    expect(etaAppExists(Number.NaN, false)).toBe(false);
  });
  it('🔒 CLASS LOCK: every place the route decides appExists goes through etaAppExists with the loop outcome', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const sites = route.match(/appExists:\s*\S.{0,80}/g) ?? [];
    expect(sites.length).toBeGreaterThanOrEqual(2);
    for (const site of sites) expect(site).toMatch(/^appExists:\s*etaAppExists\(.*, etaLoopFailed\)/);
    expect(route).toMatch(/etaFinalChecks = true;\n\s*etaLoopFailed = !result\.ok;/);
  });
});

describe('🔴 the same class in the report itself: the fallback line says when it fired', () => {
  it('after-write fail-open is not reported as "before any user file"', async () => {
    const { surplusFallbackMessage } = await import('../src/server/AI/SurplusRegistry/surplusPreWriteFailOpen');
    expect(surplusFallbackMessage('mid_build_after_write')).toContain('after the builder had written files');
    expect(surplusFallbackMessage('mid_build_after_write')).not.toContain('before any user file');
    expect(surplusFallbackMessage('mid_build_engine_unavailable')).toContain('before any user file');
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('message: surplusFallbackMessage(reason),');
  });
});
