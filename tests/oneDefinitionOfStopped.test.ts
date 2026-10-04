// ONE DEFINITION OF "WAS THE BUILD STOPPED?" (Q-131, 2026-10-04).
//
// The question had two answers: the abort signal (retry, run proof) and the timeline OR a `stop_build`
// tool call (the upsell). They agree only because of two invariants, and this file pins both, so the
// second definition cannot come back and cannot become necessary:
//   1. the model's `stop_build` records USER_STOPPED_BUILD and THEN raises the same 'user-stop' abort
//      the Stop button raises — one stop, both sources;
//   2. every other stop is copied from the signal onto the timeline after the run (the back-fill).
// And the old second half is never used as a stop definition again: a `stop_build` call the dispatcher
// could not carry out is not a stop.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const route = stripComments(readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8'));
const dispatcher = stripComments(readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8'));

describe('the model\'s stop_build is the same stop as the button', () => {
  it('records USER_STOPPED_BUILD, then raises the user-stop abort', () => {
    const at = route.indexOf('dispatcher.setStopBuild(');
    expect(at).toBeGreaterThan(0);
    const body = route.slice(at, at + 2500);
    const recorded = body.indexOf("code: 'USER_STOPPED_BUILD'");
    const aborted = body.indexOf("'user-stop')");
    expect(recorded).toBeGreaterThan(0);
    expect(aborted).toBeGreaterThan(recorded);
  });

  it('an unwired stop_build says it could not stop — it never claims a stop', () => {
    const at = dispatcher.indexOf("case 'stop_build':");
    const body = dispatcher.slice(at, at + 800);
    expect(body).toContain('if (!this.stopBuild)');
    expect(body).toContain('Could not stop this build');
  });
});

describe('every stop reaches the timeline, and the timeline is the only definition', () => {
  it('back-fills a signal-only stop onto the timeline after the run, before any verdict reads it', () => {
    const backfill = route.indexOf("abortCauseOf(abort.signal) === 'user-stop' && !buildWasStopped(buildDiag.report().issues)");
    const upsell = route.indexOf('const stopped = buildWasStopped(buildDiag.report().issues);');
    expect(backfill).toBeGreaterThan(0);
    expect(upsell).toBeGreaterThan(backfill);
  });

  it('never reads a stop_build tool call as a stop', () => {
    expect(route).not.toMatch(/toolWasUsed\(\s*['"]stop_build['"]\s*\)/);
  });
});
