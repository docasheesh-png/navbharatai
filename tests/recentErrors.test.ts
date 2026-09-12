import { describe, it, expect, beforeEach } from 'vitest';
import { noteError, recentErrors, clearRecentErrors, installErrorCapture } from '../src/lib/recentErrors';

/** A stand-in for `window` that records its listeners, so no DOM is needed. */
function fakeWindow() {
  const handlers = new Map<string, (e: unknown) => void>();
  return {
    handlers,
    addEventListener(type: string, h: (e: unknown) => void) { handlers.set(type, h); },
    removeEventListener(type: string) { handlers.delete(type); },
    fire(type: string, e: unknown) { handlers.get(type)?.(e); },
  };
}

describe('recentErrors — the note the user could not have written', () => {
  beforeEach(() => clearRecentErrors());

  it('keeps them oldest first, so it reads as a timeline', () => {
    noteError('first'); noteError('second');
    expect(recentErrors()).toEqual(['first', 'second']);
  });

  it('🔴 a render loop throwing the same error cannot evict everything before it', () => {
    // Without the de-duplication, one repeating error flushes the buffer and the error that STARTED
    // the failure — the only one worth having — is the first thing lost.
    noteError('the real cause');
    for (let i = 0; i < 50; i += 1) noteError('Cannot read properties of null');
    expect(recentErrors()[0]).toBe('the real cause');
    expect(recentErrors()).toHaveLength(2);
  });

  it('is capped, so it can never grow without bound in a long session', () => {
    for (let i = 0; i < 40; i += 1) noteError(`error ${i}`);
    expect(recentErrors().length).toBeLessThanOrEqual(8);
    expect(recentErrors()[recentErrors().length - 1]).toBe('error 39');
  });

  it('truncates a long message rather than carrying a payload into a report', () => {
    noteError('x'.repeat(1000));
    expect(recentErrors()[0].length).toBeLessThanOrEqual(200);
  });

  it('accepts an Error, a string, or something that is neither', () => {
    noteError(new TypeError('boom'));
    noteError({ weird: true });
    expect(recentErrors()[0]).toBe('TypeError: boom');
    expect(recentErrors()[1]).toBeTruthy();
  });

  it('empty input records nothing — a blank line in a report is worse than no line', () => {
    noteError('   ');
    noteError('');
    expect(recentErrors()).toEqual([]);
  });

  it('the caller cannot mutate the buffer through the copy it is handed', () => {
    noteError('one');
    recentErrors().push('injected');
    expect(recentErrors()).toEqual(['one']);
  });
});

describe('installErrorCapture', () => {
  beforeEach(() => clearRecentErrors());

  it('records a thrown error with the file and line, not the stack', () => {
    const w = fakeWindow();
    const stop = installErrorCapture(w);
    w.fire('error', { message: 'x is not a function', filename: 'https://site/assets/index-a1b2.js', lineno: 42 });
    expect(recentErrors()).toEqual(['x is not a function @ index-a1b2.js:42']);
    stop();
  });

  it('records an unhandled promise rejection', () => {
    const w = fakeWindow();
    const stop = installErrorCapture(w);
    w.fire('unhandledrejection', { reason: new Error('network down') });
    expect(recentErrors()[0]).toContain('network down');
    stop();
  });

  it('a second install does not double-record — that would halve the real depth of the buffer', () => {
    const a = fakeWindow();
    const stopA = installErrorCapture(a);
    const b = fakeWindow();
    installErrorCapture(b);
    expect(b.handlers.size).toBe(0);
    a.fire('error', { message: 'once' });
    expect(recentErrors()).toEqual(['once']);
    stopA();
  });

  it('stopping removes the listeners', () => {
    const w = fakeWindow();
    installErrorCapture(w)();
    expect(w.handlers.size).toBe(0);
  });

  it('a target that cannot listen is not a crash', () => {
    expect(() => installErrorCapture(null)()).not.toThrow();
  });
});
