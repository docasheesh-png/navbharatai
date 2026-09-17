/**
 * ONE BUILD, THREE STORIES (autopsy b89ba6f8, 2026-09-17).
 *
 * A free user pressed Stop 94 seconds into a build. The report then carried, simultaneously:
 *
 *   summary       "Stopped, as you asked."                        ← read from the abort SIGNAL
 *   narration     "NavBharatAI's engine is running slowly right now and your build could not
 *                  finish — this one is on us, not on your app."  ← read from the TOOL log
 *   release gate  "Not shippable — the build did not succeed."    ← read from the TIMELINE
 *
 * `abortBuild(…, 'user-stop')` is reached from three places — the Stop BUTTON, UNSEND, and the
 * model's own `stop_build` tool — and only the last recorded `USER_STOPPED_BUILD`. So a build
 * stopped by the BUTTON was invisible to two of its three readers, and both invented an explanation:
 * the user was apologised to for a failure that never happened, and the admin's failure panel logged
 * a phantom "engine did not respond".
 *
 * The fix is a back-fill from the signal (the one funnel every stop path already goes through), so
 * every existing timeline reader becomes correct without learning anything new.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BuildDiagnostics, buildWasStopped, stoppedByUser } from '../src/server/AgentV3/BuildDiagnostics';

/** The exact sentence build b89ba6f8 reported as its rootCause. */
const UPSELL_SENTENCE =
  'Did not ask this user to add credits: the build failed because the engine did not respond, not '
  + 'because the app needed a stronger one. Charging for our own slowness is what this check exists to prevent.';

/** That build's problems, replayed in order. */
function b89ba6f8(): BuildDiagnostics {
  const d = new BuildDiagnostics({ prompt: 'Continue from where you left off and finish/fix the build so the app works end-to-end.' } as never);
  d.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'Provider GLM failed — falling back to the next provider', autoResolved: true });
  d.record({ phase: 'build', severity: 'warning', code: 'DESIGN_CONSISTENCY', message: 'Design consistency 80/100 (B) across 21 file(s).', autoResolved: false });
  d.record({ phase: 'readiness', severity: 'error', code: 'RELEASE_GATE', message: 'Release gate: RED — Not shippable — the build did not succeed.', autoResolved: false });
  d.record({ phase: 'build', severity: 'warning', code: 'UPSELL_SUPPRESSED', message: UPSELL_SENTENCE, autoResolved: false });
  // The real build ENDED. Without this the report reads as still-running and derives a different
  // rootCause entirely — the first draft of this file omitted it and measured the wrong sentence.
  d.finish(false, 'Stopped, as you asked. Your files so far are saved — send another message and I\'ll continue from here.');
  return d;
}

/** What the back-fill writes for an ordinary Stop press. */
const STOP_RECORD = {
  phase: 'build', severity: 'info', code: 'USER_STOPPED_BUILD', autoResolved: true,
  message: 'The user asked for this build to stop, and it was stopped.',
} as const;

/** What it writes when the build's own prompt was composed by NavBharatAI (autopsy fdd59ef8). */
const PLATFORM_STOP_RECORD = {
  phase: 'build', severity: 'info', code: 'USER_STOPPED_BUILD', autoResolved: true,
  message: 'The build was stopped while working on a request NavBharatAI itself composed — not by the user.',
} as const;

describe('the two questions a stop has to answer, and why they are two', () => {
  it('🔴 the bug: with no record on the timeline, a stopped build reads as one nobody stopped', () => {
    const r = b89ba6f8().report();
    expect(buildWasStopped(r.issues)).toBe(false);
    expect(stoppedByUser(r.issues)).toBe(false);
  });

  it('the back-fill makes BOTH true for an ordinary Stop press', () => {
    const d = b89ba6f8();
    d.record({ ...STOP_RECORD });
    const r = d.report();
    expect(buildWasStopped(r.issues)).toBe(true);
    expect(stoppedByUser(r.issues)).toBe(true);
  });

  it('a PLATFORM-composed prompt stops the build without blaming the user — the narrow answer stays no', () => {
    // `buildWasStopped` asks "did this reach the point of having a capability to judge?" (no, either
    // way). `stoppedByUser` asks "is it fair to say the USER did this?" (no — we composed the prompt).
    const d = b89ba6f8();
    d.record({ ...PLATFORM_STOP_RECORD });
    const r = d.report();
    expect(buildWasStopped(r.issues)).toBe(true);
    expect(stoppedByUser(r.issues)).toBe(false);
  });

  it('never throws on junk, and an unrelated timeline is not a stop', () => {
    expect(buildWasStopped(null)).toBe(false);
    expect(buildWasStopped(undefined)).toBe(false);
    expect(buildWasStopped([{ code: 'RELEASE_GATE' } as never])).toBe(false);
  });
});

describe('a note about our own billing decision is not a reason a build failed', () => {
  it('the exact rootCause b89ba6f8 reported is no longer reachable', () => {
    const r = b89ba6f8().report();
    expect(r.rootCause).not.toBe(UPSELL_SENTENCE);
    expect(r.rootCause).not.toMatch(/Did not ask this user to add credits/);
  });

  it('…and it is named as an advisory that can carry no cause, rather than silently dropped', () => {
    // Nothing is hidden: the finding stays on the timeline and in the honest "none of these can name
    // a cause" sentence — which is the difference between not blaming it and pretending it is absent.
    const r = b89ba6f8().report();
    expect(r.rootCause).toMatch(/UPSELL_SUPPRESSED/);
    expect(r.issues.some((i) => i.code === 'UPSELL_SUPPRESSED')).toBe(true);
  });
});

describe('the route wiring — the CODE of the build handler, comments stripped', () => {
  const code = readFileSync('src/server/routes/agentv3.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the back-fill copies the abort SIGNAL onto the timeline, and only when nothing recorded it', () => {
    const at = code.indexOf("if (abortCauseOf(abort.signal) === 'user-stop' && !buildWasStopped(buildDiag.report().issues)) {");
    expect(at).toBeGreaterThan(-1);
    const body = code.slice(at, at + 900);
    expect(body).toContain("code: 'USER_STOPPED_BUILD'");
    // The platform-composed test travels with it, so the record never blames the user for our prompt.
    expect(body).toContain('isPlatformFixRequest(prompt)');
    expect(body).toContain('not by the user.');
  });

  it('it runs BEFORE both readers it exists to correct — the gate and the empty-build explanation', () => {
    const backfill = code.indexOf("if (abortCauseOf(abort.signal) === 'user-stop' && !buildWasStopped(");
    const gate = code.indexOf('gateEvidence.stoppedByUser = stoppedByUser(buildDiag.report().issues);');
    const emptyBuild = code.indexOf('const stopped = buildWasStopped(buildDiag.report().issues)');
    expect(backfill).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(backfill);
    expect(emptyBuild).toBeGreaterThan(backfill);
  });

  it('the empty-build explanation asks the timeline, so "our engine is slow" cannot follow a stop', () => {
    const at = code.indexOf('const stopped = buildWasStopped(buildDiag.report().issues)');
    expect(at).toBeGreaterThan(-1);
    // `degraded`, `refused`, `misconfigured` and `starved` all stand down on a stopped build, and the
    // narration itself is gated on it — that ordering is what the original block already claimed.
    const body = code.slice(at, at + 1400);
    expect(body).toContain('const degraded = !stopped && !refused');
    expect(body).toContain('if (!refused && !stopped) {');
  });

  it('the Stop BUTTON and UNSEND still reach the run only through the one funnel', () => {
    // If a future stop path stopped calling `abortBuild`, the back-fill would go blind — so this
    // pins the premise the fix rests on rather than the fix alone.
    expect(code).toContain("abortBuild(rb.abort, 'user-stop');");
    expect(code.match(/abortBuild\(rb\.abort, 'user-stop'\);/g)?.length).toBe(2);
  });
});
