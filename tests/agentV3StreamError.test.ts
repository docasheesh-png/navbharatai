import { describe, it, expect } from 'vitest';
import { shouldSurfaceStreamError, reconnectOutcome, isBuildBusyError, type StreamErrorContext } from '../src/hooks/agentV3StreamError';

function ctx(over: Partial<StreamErrorContext> = {}): StreamErrorContext {
  return { isAbort: false, isStale: false, sawResult: false, reconnected: false, ...over };
}

describe('shouldSurfaceStreamError', () => {
  // THE exact bug (admin, 2026-07-04): an imported GitHub app surveyed successfully ("✓ Done · 24
  // steps"), then a "network error" banner appeared. The build's terminal `result` had already
  // arrived; the drop happened during the up-to-~6-min post-result import-preview boot. A drop after
  // the result is NOT a build failure.
  it('does NOT surface an error once the terminal result has arrived (the reported bug)', () => {
    expect(shouldSurfaceStreamError(ctx({ sawResult: true }))).toBe(false);
  });

  it('surfaces a genuine mid-build failure (dropped BEFORE any result, no reconnect)', () => {
    expect(shouldSurfaceStreamError(ctx())).toBe(true);
  });

  it('does NOT surface an intentional abort (stop / navigate-away)', () => {
    expect(shouldSurfaceStreamError(ctx({ isAbort: true }))).toBe(false);
  });

  it('does NOT surface an error for a stale (abandoned) build the user left', () => {
    expect(shouldSurfaceStreamError(ctx({ isStale: true }))).toBe(false);
  });

  it('does NOT surface an error after a successful transparent reconnect', () => {
    expect(shouldSurfaceStreamError(ctx({ reconnected: true }))).toBe(false);
  });

  // Boundary: result seen AND we reconnected to catch the import-boot tail — still no error.
  it('stays silent when the result arrived and we reconnected', () => {
    expect(shouldSurfaceStreamError(ctx({ sawResult: true, reconnected: true }))).toBe(false);
  });

  // An abort must win even over a state that would otherwise surface (defensive ordering).
  it('abort suppresses even when nothing else would', () => {
    expect(shouldSurfaceStreamError(ctx({ isAbort: true, sawResult: false, reconnected: false }))).toBe(false);
  });

  // The ONLY combination that surfaces: a real drop, before the result, not aborted, not stale,
  // not reconnected. Every suppressing flag individually flips it to false.
  it('every suppressing condition independently prevents the error', () => {
    expect(shouldSurfaceStreamError(ctx())).toBe(true); // baseline: surfaces
    for (const key of ['isAbort', 'isStale', 'sawResult', 'reconnected'] as const) {
      expect(shouldSurfaceStreamError(ctx({ [key]: true }))).toBe(false);
    }
  });
});

describe('reconnectOutcome', () => {
  // THE exact bug (admin, 2026-07-05, IMG_5709 — "internet off 30s → load fail → retry"): on a drop
  // the client OPTIMISTICALLY printed "your build was still running — I re-attached to it live below",
  // then /attach 404'd ("No running build to resume.") because the build had already ended in the
  // window between /chat's 409 check and the separate /attach call. Two contradictory messages. The
  // fix: a 404 is 'gone', never 'live' and never an 'error' — so the caller shows ONE honest state and
  // the "re-attached live" notice is emitted ONLY for a confirmed-live attach.
  it("a live attach is 'live' (and only then is the re-attached notice shown)", () => {
    expect(reconnectOutcome({ ok: true, status: 200, resultAlreadySeen: false })).toBe('live');
  });

  it("a 404 mid-build is 'gone-notice' — the honest 'send again' path, NOT an error (the reported bug)", () => {
    expect(reconnectOutcome({ ok: false, status: 404, resultAlreadySeen: false })).toBe('gone-notice');
  });

  it("a 404 AFTER the result was seen is 'gone-silent' — benign tail close, no message", () => {
    expect(reconnectOutcome({ ok: false, status: 404, resultAlreadySeen: true })).toBe('gone-silent');
  });

  it("a non-404 failure (e.g. 500) is a genuine 'error'", () => {
    expect(reconnectOutcome({ ok: false, status: 500, resultAlreadySeen: false })).toBe('error');
    expect(reconnectOutcome({ ok: false, status: 503, resultAlreadySeen: true })).toBe('error');
  });

  // A 404 is NEVER classified as 'error' or 'live' — it is always one of the two honest "gone"
  // states, so the contradiction ("re-attached live" + "no running build") can never reappear.
  it('a 404 is never live and never a red error', () => {
    for (const resultAlreadySeen of [true, false]) {
      const out = reconnectOutcome({ ok: false, status: 404, resultAlreadySeen });
      expect(out === 'live' || out === 'error').toBe(false);
      expect(out.startsWith('gone')).toBe(true);
    }
  });
});

describe('isBuildBusyError', () => {
  // THE exact bug (admin, IMG_5718): the account lock error offered "Fix with AI", which re-sent and
  // re-hit the lock → the 100-retries loop. This detector routes such errors to Stop/Connect instead.
  it('detects the exact account-lock messages (client 409 + server 409)', () => {
    expect(isBuildBusyError('A build is still running on your account. Press ⏹ Stop to end it, then send your message again.')).toBe(true);
    expect(isBuildBusyError('A build is already running for this account. Stop it before starting another.')).toBe(true);
    expect(isBuildBusyError('a build is ALREADY running')).toBe(true); // case-insensitive
  });

  it('does NOT match ordinary build/code errors (they still get "Fix with AI")', () => {
    expect(isBuildBusyError('Build failed: TypeScript error in src/App.tsx')).toBe(false);
    expect(isBuildBusyError('npm install failed')).toBe(false);
    expect(isBuildBusyError('The build is running slowly')).toBe(false); // not the lock phrasing
  });

  it('is false for empty / null / undefined', () => {
    expect(isBuildBusyError('')).toBe(false);
    expect(isBuildBusyError(null)).toBe(false);
    expect(isBuildBusyError(undefined)).toBe(false);
  });
});
