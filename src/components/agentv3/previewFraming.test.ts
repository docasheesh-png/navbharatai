import { describe, it, expect } from 'vitest';
import { shouldShowNotServingSurface, type FramingState } from './previewFraming';

const base: FramingState = {
  unreachable: false, portDown: false, diagnosing: false,
  hasDoorUrl: false, hasSnapshotUrl: false, framingUnchecked: false,
};

describe('a vendor error page can never be framed while we are fixing the app (admin report 2026-09-03)', () => {
  it('THE REPORTED CASE: port down + a wake in flight + no door ⇒ our surface, not the machine', () => {
    // The screenshot exactly: sandbox resumed, "Waking your preview" counting 25s at the top, and
    // E2B's "Closed Port Error" — sandbox id and refused port — framed underneath it.
    expect(shouldShowNotServingSurface({ ...base, portDown: true, diagnosing: true })).toBe(true);
  });

  it('the OLD expression is what put it there — pinned so the escape cannot come back', () => {
    // `portDown && !diagnosing` evaluated FALSE in the reported state, which fell through to the frame.
    const s = { ...base, portDown: true, diagnosing: true };
    const oldCondition = s.unreachable || (s.portDown && !s.diagnosing) || s.framingUnchecked;
    expect(oldCondition).toBe(false);            // what shipped
    expect(shouldShowNotServingSurface(s)).toBe(true); // what it does now
  });

  it('a wake in flight never frames a raw machine, even before any probe has answered', () => {
    // The window before the health probe replies: nothing is known, but a wake only runs because
    // something is wrong, so the address behind it is not serving by definition.
    expect(shouldShowNotServingSurface({ ...base, diagnosing: true })).toBe(true);
  });

  it('but the DOOR keeps framing through a wake — it resolves the machine and shows our own page', () => {
    // The fix must not downgrade the door path to a static panel; watching the app walk back up by
    // itself is the better experience the door was built for.
    expect(shouldShowNotServingSurface({ ...base, diagnosing: true, hasDoorUrl: true })).toBe(false);
    expect(shouldShowNotServingSurface({ ...base, portDown: true, diagnosing: true, hasDoorUrl: true })).toBe(false);
  });

  it('a successful wake shows the app immediately — the panel must not outlive the problem', () => {
    // runDiagnose clears portDown/unreachable and remounts the frame on success; this asserts the
    // decision agrees, so a working app is never hidden behind "hasn't started yet".
    expect(shouldShowNotServingSurface({ ...base, diagnosing: false, portDown: false })).toBe(false);
  });

  it('a saved snapshot is our own content and is always safe to frame', () => {
    expect(shouldShowNotServingSurface({ ...base, portDown: true, hasSnapshotUrl: true })).toBe(false);
    expect(shouldShowNotServingSurface({ ...base, unreachable: true, hasSnapshotUrl: true })).toBe(false);
  });

  it('keeps the two guarantees it inherited: unreachable and unchecked still refuse the frame', () => {
    expect(shouldShowNotServingSurface({ ...base, unreachable: true })).toBe(true);
    expect(shouldShowNotServingSurface({ ...base, framingUnchecked: true })).toBe(true);
  });

  it('a healthy, checked, idle preview frames normally — the default path is unchanged', () => {
    expect(shouldShowNotServingSurface(base)).toBe(false);
  });
});
