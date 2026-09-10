import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "LIVE PREVIEW WAKEUP HI NAHI HO RAHA" (admin screenshot, 2026-08-28).
 *
 * The screenshot carried THREE banners at once:
 *   • green — "Your preview is awake and your app is responding."
 *   • blue  — "Preview is in sleep mode." with a [Wake up] button
 *   • grey  — "Showing your finished app from its saved copy, so no server is left running for it."
 *
 * None of them was a lie when it was written; two were artefacts of an earlier moment still standing
 * for the present. Two separate defects, opposite directions, one class — a stale reading presented
 * as current truth:
 *
 *   1. A wake that SUCCEEDED left `health: 'sleeping'` and the snapshot note on screen (the health
 *      poll runs every 150s), and — the part that made it look like nothing happened at all — never
 *      reloaded the frame. The iframe's src is the DOOR url, which is byte-identical before and after
 *      the machine behind it changes, so React kept the snapshot it had already painted.
 *   2. A preview that went back to sleep left the earlier green SUCCESS line above the fresh blue
 *      "sleep mode" banner.
 *
 * These are source-level assertions on purpose: the state lives inside a 1300-line component, and the
 * failure produces no error and no failing type — only a screen that contradicts itself.
 */
const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');

/** The body of `runDiagnose`'s success branch — where a wake must publish what it just proved. */
function wakeSuccessBranch(): string {
  const at = surface.indexOf("if (data?.ok && typeof data?.previewUrl === 'string' && data.previewUrl) {");
  expect(at, 'the diagnose success branch must exist').toBeGreaterThan(-1);
  return surface.slice(at, at + 2600);
}

describe('a successful wake publishes what it just proved', () => {
  const branch = wakeSuccessBranch();

  it('clears the sleep state — the blue banner cannot outlive the wake that ended it', () => {
    expect(branch).toContain("setHealth('live')");
  });

  it('clears the saved-copy note — no server IS running now, so that line is false', () => {
    expect(branch).toContain("setSnapshotNote('')");
  });

  it('clears the port-down and unreachable flags the fresh boot disproved', () => {
    expect(branch).toContain('setPortDown(false)');
    expect(branch).toContain('setUnreachable(false)');
  });

  it('🔒 RELOADS THE FRAME — the half that made a working wake look like nothing at all', () => {
    // The iframe src is the door url; it does not change when the machine behind it does, so without
    // a key bump React re-renders the SAME element and the old snapshot stays painted.
    expect(branch).toContain('setLiveReloadKey((k) => k + 1)');
  });

  it('still does what it did before — adopts the url, switches to live, resets the streak', () => {
    expect(branch).toContain('setFoundUrl(data.previewUrl)');
    expect(branch).toContain("setMode('live')");
    expect(branch).toContain('healRef.current.streak = 0');
  });
});

describe('a success message does not outlive the state it described', () => {
  it('a probe that finds the preview asleep or stopped retires a stale SUCCESS note', () => {
    const at = surface.indexOf('setHealth(status);');
    expect(at).toBeGreaterThan(-1);
    const after = surface.slice(at, at + 1200);
    expect(after).toContain("status === 'sleeping' || status === 'crashed'");
    expect(after).toContain('setDiagResult((prev) => (prev && prev.ok ? null : prev))');
  });

  it('🔒 a FAILURE note is deliberately KEPT — why a wake did not work stays useful', () => {
    // The predicate retires only `prev.ok`; anything else is returned unchanged. If this ever becomes
    // an unconditional `setDiagResult(null)`, the user loses the only explanation they were given.
    const at = surface.indexOf('setHealth(status);');
    const after = surface.slice(at, at + 1200);
    expect(after).not.toMatch(/setDiagResult\(null\)/);
  });
});

describe('the Wake up button still does the one thing it claims', () => {
  it('marks the intent and runs the real diagnose, user-initiated', () => {
    expect(surface).toContain('onClick={() => { setWakeIntent(true); void runDiagnose(true); }}');
  });
});
