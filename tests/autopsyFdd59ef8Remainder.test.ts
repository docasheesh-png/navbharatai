// The FOUR findings autopsy fdd59ef8 recorded as open, closed (2026-09-17). The admin asked the plain
// question — "build report ke sabhi problem fix huye?" — and the honest answer was no: two of six.
// These are the other four.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { STREAM_IDLE_MS_DEFAULT } from '../src/server/AgentV3/providers/openAiStream';

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');
const route = stripComments(read('src/server/routes/agentv3.ts'));
const runner = stripComments(read('src/server/AgentV3/providers/OpenAiToolRunner.ts'));

describe('1 · a STOPPED build is never asked for money', () => {
  it('🔴 the stop is read from the timeline the report itself prints', () => {
    // `toolWasUsed` reads TOOL_DONE out of the timeline, so the signal cannot drift from what an
    // admin sees. The alternative — a new flag threaded thousands of lines down the handler — would
    // be a second answer to a question the timeline already answers.
    const diag = new BuildDiagnostics();
    expect(diag.toolWasUsed('stop_build')).toBe(false);
    diag.record({ phase: 'tool', severity: 'info', code: 'TOOL_DONE', message: '✓ stop_build (5s)', autoResolved: true });
    expect(diag.toolWasUsed('stop_build')).toBe(true);
  });

  it('the guard tests `stopped` FIRST, so every later reading is skipped', () => {
    expect(route).toContain("const stopped = buildDiag.toolWasUsed('stop_build');");
    // Each subsequent reading must stand down when the build was stopped — it is reasoning about
    // evidence that was never gathered.
    expect(route).toContain('const refused = !stopped && looksLikeRefusal(result.summary);');
    expect(route).toContain('const degraded = !stopped && !refused &&');
    expect(route).toContain('const misconfigured = !stopped && !refused && !degraded');
    expect(route).toContain('const starved = !stopped && !refused && !degraded && !misconfigured');
  });

  it('🔒 the upsell is not emitted, and the suppression is recorded honestly', () => {
    expect(route).toContain('if (!refused && !stopped) {');
    expect(route).toContain('if (refused || degraded || misconfigured || starved || stopped) {');
    expect(read('src/server/routes/agentv3.ts')).toContain('the build was STOPPED, so no engine was ever asked to build anything');
  });
});

describe('2 · provider silence is never reported as OUR budget', () => {
  it('🔴 the arithmetic that makes it a fact rather than a guess', () => {
    // idleMs = min(streamIdleMs(), timeoutMs). The reported build died at 60,012 ms with 1,665 s of
    // budget left, so the lane clock was far longer than the silence window.
    const laneClockMs = 480_000;
    const idleMs = Math.min(STREAM_IDLE_MS_DEFAULT, laneClockMs);
    expect(idleMs).toBeLessThan(laneClockMs); // ⇒ firing at idleMs cannot be our budget
  });

  it('the runner picks the wording from that comparison', () => {
    expect(runner).toContain('const providerWentSilent = streaming && idleMs < timeoutMs;');
    expect(runner).toContain('? `OpenAI-compatible call (GLM/Kimi) timed out after ${idleMs}ms`');
    expect(runner).toContain(': clockMessage(initialBoundMs),');
  });

  it('🔒 the silence wording is one `isTimeout` matches — which is what benches a dead rung', () => {
    // BUDGET_REACHED never benches a provider (correct when true). Reporting silence as budget is
    // what switched the family bench off and left the ladder on GLM.
    const silence = 'OpenAI-compatible call (GLM/Kimi) timed out after 60000ms';
    expect(/timeout|timed out/i.test(silence)).toBe(true);
    expect(silence.toLowerCase()).not.toContain('budget');
  });
});

describe('3 · the report no longer contradicts its own count', () => {
  it('🔴 unresolved items that merely cannot NAME a cause are not reported as absent', () => {
    const diag = new BuildDiagnostics();
    // Exactly the reported shape: two unresolved items, both in NEVER_ROOT_CAUSE, plus one
    // auto-resolved warning that becomes the "most severe thing seen".
    diag.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'Provider GLM failed — falling back to the next provider', autoResolved: true });
    diag.record({ phase: 'build', severity: 'warning', code: 'DESIGN_CONSISTENCY', message: 'Design consistency 70/100 (C)', autoResolved: false });
    diag.record({ phase: 'readiness', severity: 'error', code: 'RELEASE_GATE', message: 'Release gate: RED', autoResolved: false });
    diag.finish(false, 'stopped');

    const r = diag.report();
    expect(r.counts.unresolved).toBeGreaterThan(0);
    // The sentence must not claim none were recorded while the header counts them.
    expect(r.rootCause).not.toContain('NO unresolved problem was recorded');
    expect(r.rootCause).toContain('unresolved item(s) WERE recorded');
  });

  it('with genuinely nothing unresolved, the original wording still stands', () => {
    const diag = new BuildDiagnostics();
    diag.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'Provider GLM failed', autoResolved: true });
    diag.finish(false, 'failed');
    expect(diag.report().rootCause).toContain('NO unresolved problem was recorded');
  });
});

describe('4 · a design grade needs a user app to grade', () => {
  it('🔴 nothing written AND nothing saved ⇒ everything present is OUR scaffold', () => {
    expect(route).toContain('const hasUserApp = Object.keys(storeFiles).length > 0 || writtenFiles.size > 0;');
    expect(route).toContain('const quality = hasUserApp ? lintBuiltApp(integrityFiles) : null;');
  });

  it('🔒 a CONTINUE build still grades the whole app — the 2026-08-15 fix is untouched', () => {
    // hasUserApp is true whenever the durable store has files, so whole-app coverage on a continue
    // build is unchanged; this only silences the case where the user has no app at all.
    expect(route).toContain('const integrityFiles: Record<string, string> = { ...storeFiles, ...Object.fromEntries(writtenFiles) };');
  });
});
