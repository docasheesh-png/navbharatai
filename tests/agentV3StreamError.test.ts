import { describe, it, expect } from 'vitest';
import { shouldSurfaceStreamError, type StreamErrorContext } from '../src/hooks/agentV3StreamError';

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
