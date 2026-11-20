// 🔴 A PROVIDER OUTAGE IS NOT A BUILD-BREAKING BLOCKER OF THE APP (failedbr #2424, b3ca7df0, 2026-11-17).
//
// "Build a quiz game": the app rendered and 12 real presses broke nothing, then a later pass hit the outage — KIMI
// suspended, GLM overloaded — and "All NavBharatAI Pro providers failed …" arrived as an error event. It was filed as
// a BUILD-phase BUILD_ERROR, so the release gate listed it as "1 build-breaking blocker" and the user's summary named
// the outage as "the main thing still broken". The sibling of the admin-pause fix (aPausedServiceIsNotABrokenApp):
// the pause was taken out of the build phase, the provider-exhaustion sentences were not.
// Reversion: file the error in the 'build' phase again and the first two tests fail.

import { describe, it, expect } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const errorEvent = (message: string) => ({ type: 'error', message, ts: 1 }) as never;
/** The report's own words (the account id is redacted exactly as the report redacts it). */
const REAL = 'All NavBharatAI Pro providers failed (ENGINE_R1 → ENGINE_BM → GLM ×50 keys → KIMI → GLM ×50 keys). Last error: 429 The service may be temporarily overloaded, please try again later';

describe('the outage sentences are provider facts', () => {
  it.each([
    ['#2424 — all providers failed', REAL],
    ['#2428 — the public engine sentence', 'The build engine is temporarily unavailable. Please try again shortly.'],
    ['the unavailable variant', 'All NavBharatAI Pro providers are unavailable right now'],
    ['an engine step wall clock', 'The build step timed out after 240s'],
  ])('%s: recorded, unresolved, in the provider phase — and not a shipping blocker', (_label, message) => {
    const d = new BuildDiagnostics();
    d.ingestEvent(errorEvent(message));
    const issue = d.report().issues.find((i) => i.code === 'BUILD_ERROR');
    expect(issue?.phase).toBe('provider');
    expect(issue?.autoResolved).toBe(false);          // still honest: the run DID hit the outage
    expect(d.shippingIssueCount('error')).toBe(0);
  });
  it('a real build error is still a build-phase blocker', () => {
    const d = new BuildDiagnostics();
    d.ingestEvent(errorEvent('Build stopped — an unexpected error occurred: x is not defined'));
    expect(d.report().issues.find((i) => i.code === 'BUILD_ERROR')?.phase).toBe('build');
    expect(d.shippingIssueCount('error')).toBeGreaterThan(0);
  });
});
