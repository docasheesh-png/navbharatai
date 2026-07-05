import { describe, it, expect } from 'vitest';
import { newReloadTracker, shouldReloadOnSignal } from './previewAutoReload';

describe('previewAutoReload — the Preview surface auto-refresh trigger (U1)', () => {
  it('never reloads when the caller passes no signal', () => {
    const t = newReloadTracker();
    expect(shouldReloadOnSignal(t, undefined)).toBe(false);
    expect(shouldReloadOnSignal(t, undefined)).toBe(false);
  });

  it('does NOT reload on the first observation (the mount load already covers the initial state)', () => {
    const t = newReloadTracker();
    expect(shouldReloadOnSignal(t, 5)).toBe(false); // first value seen → recorded, no reload
  });

  it('reloads on every genuinely-new value (each file write / diff bumps the signal)', () => {
    const t = newReloadTracker();
    expect(shouldReloadOnSignal(t, 1)).toBe(false); // first
    expect(shouldReloadOnSignal(t, 2)).toBe(true);  // file written
    expect(shouldReloadOnSignal(t, 3)).toBe(true);  // another write
    expect(shouldReloadOnSignal(t, 4)).toBe(true);
  });

  it('does NOT reload when the signal is unchanged (a re-render that did not touch files)', () => {
    const t = newReloadTracker();
    shouldReloadOnSignal(t, 7);                      // first observation
    expect(shouldReloadOnSignal(t, 7)).toBe(false);  // same value → no reload
    expect(shouldReloadOnSignal(t, 8)).toBe(true);   // changed → reload
    expect(shouldReloadOnSignal(t, 8)).toBe(false);  // stable again → no reload
  });

  it('each tracker is independent (a fresh mount starts clean)', () => {
    const a = newReloadTracker();
    const b = newReloadTracker();
    shouldReloadOnSignal(a, 3);
    expect(shouldReloadOnSignal(a, 4)).toBe(true);
    // b has never seen a value → its first observation still does not reload
    expect(shouldReloadOnSignal(b, 4)).toBe(false);
  });
});
