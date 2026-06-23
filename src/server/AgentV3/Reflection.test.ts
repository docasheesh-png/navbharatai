import { describe, it, expect } from 'vitest';
import {
  reflectOnBuild,
  reflectionNote,
  errorSignature,
  detectRecurringErrors,
} from './Reflection';
import type { Episode } from './WorkspaceMemory';

/** Build an episode with an explicit ts so ordering is deterministic. */
const ep = (ts: number, kind: Episode['kind'], text: string): Episode => ({ ts, kind, text });

describe('reflectOnBuild', () => {
  it('pairs an error with a later fix into a lesson and counts correctly', () => {
    const episodes: Episode[] = [
      ep(1, 'request', 'build a todo app'),
      ep(2, 'error', 'Module not found: react-router-dom'),
      ep(3, 'fix', 'installed react-router-dom and re-ran the build'),
    ];
    const r = reflectOnBuild({ ok: true, summary: 'done', steps: 5, episodes });

    expect(r.outcome).toBe('success');
    expect(r.errorsEncountered).toBe(1);
    expect(r.fixesApplied).toBe(1);
    expect(r.unresolvedErrors).toBe(0);
    expect(r.lessons).toHaveLength(1);
    expect(r.lessons[0]).toContain('Module not found: react-router-dom');
    expect(r.lessons[0]).toContain('installed react-router-dom');
    expect(r.summary).toBe('Build succeeded in 5 steps; 1 error(s), 1 fix(es), 0 unresolved.');
  });

  it('counts an error with no later fix as unresolved and reports failure', () => {
    const episodes: Episode[] = [
      ep(1, 'fix', 'an earlier fix that does not belong to the later error'),
      ep(2, 'error', 'TypeScript compile failed: cannot find name Foo'),
    ];
    const r = reflectOnBuild({ ok: false, summary: 'failed', steps: 3, episodes });

    expect(r.outcome).toBe('failure');
    expect(r.errorsEncountered).toBe(1);
    expect(r.fixesApplied).toBe(1);
    expect(r.unresolvedErrors).toBe(1);
    // The only fix is BEFORE the error, so it must not be paired into a lesson.
    expect(r.lessons).toHaveLength(0);
    expect(r.summary).toBe('Build failed in 3 steps; 1 error(s), 1 fix(es), 1 unresolved.');
  });

  it('does not reuse the same fix for two errors (nearest later fix)', () => {
    const episodes: Episode[] = [
      ep(1, 'error', 'error one'),
      ep(2, 'error', 'error two'),
      ep(3, 'fix', 'the single fix'),
    ];
    const r = reflectOnBuild({ ok: true, summary: 'done', steps: 4, episodes });

    expect(r.errorsEncountered).toBe(2);
    expect(r.fixesApplied).toBe(1);
    // The fix pairs with error one (nearest earlier error); error two is unresolved.
    expect(r.unresolvedErrors).toBe(1);
    expect(r.lessons).toHaveLength(1);
    expect(r.lessons[0]).toContain('error one');
  });

  it('caps lessons at 8 even with many paired error→fix episodes', () => {
    const episodes: Episode[] = [];
    let ts = 0;
    for (let i = 0; i < 12; i++) {
      episodes.push(ep(++ts, 'error', `error ${i}`));
      episodes.push(ep(++ts, 'fix', `fix ${i}`));
    }
    const r = reflectOnBuild({ ok: true, summary: 'done', steps: 20, episodes });
    expect(r.errorsEncountered).toBe(12);
    expect(r.fixesApplied).toBe(12);
    expect(r.unresolvedErrors).toBe(0);
    expect(r.lessons).toHaveLength(8);
  });

  it('a clean run with no errors yields zero counts and empty lessons', () => {
    const episodes: Episode[] = [
      ep(1, 'request', 'build a landing page'),
      ep(2, 'note', 'scaffolded the project'),
    ];
    const r = reflectOnBuild({ ok: true, summary: 'done', steps: 2, episodes });

    expect(r.errorsEncountered).toBe(0);
    expect(r.fixesApplied).toBe(0);
    expect(r.unresolvedErrors).toBe(0);
    expect(r.lessons).toEqual([]);
    expect(r.summary).toBe('Build succeeded in 2 steps; 0 error(s), 0 fix(es), 0 unresolved.');
  });
});

describe('errorSignature', () => {
  it('collapses paths and line:col numbers so the same error matches', () => {
    const a = errorSignature("TypeError: cannot read x of undefined at /app/src/A.tsx:12:5");
    const b = errorSignature("TypeError: cannot read x of undefined at /app/src/B.tsx:34:9");
    expect(a).toBe(b);
  });

  it('keeps genuinely different errors distinct', () => {
    expect(errorSignature('Module not found: react')).not.toBe(
      errorSignature('TypeScript error: cannot find name Foo'),
    );
  });
});

describe('detectRecurringErrors', () => {
  const ep2 = (ts: number, text: string): Episode => ({ ts, kind: 'error', text });

  it('flags a signature that recurs at least the threshold number of times', () => {
    const eps: Episode[] = [
      ep2(1, 'TypeError: cannot read x of undefined at /app/src/A.tsx:1:1'),
      ep2(2, 'TypeError: cannot read x of undefined at /app/src/B.tsx:2:2'),
      ep2(3, 'TypeError: cannot read x of undefined at /app/src/C.tsx:3:3'),
    ];
    const r = detectRecurringErrors(eps, 3);
    expect(r).toHaveLength(1);
    expect(r[0].count).toBe(3);
  });

  it('does not flag an error that occurs fewer than the threshold times', () => {
    const eps: Episode[] = [
      ep2(1, 'Module not found: react-router-dom at /app/src/A.tsx:1:1'),
      ep2(2, 'Module not found: react-router-dom at /app/src/B.tsx:2:2'),
    ];
    expect(detectRecurringErrors(eps, 3)).toHaveLength(0);
  });
});

describe('reflectOnBuild — recurring errors', () => {
  const ep = (ts: number, kind: Episode['kind'], text: string): Episode => ({ ts, kind, text });

  it('surfaces a recurring-error lesson first and records it', () => {
    const episodes: Episode[] = [
      ep(1, 'error', 'TypeError: cannot read foo of undefined at /app/src/A.tsx:1:1'),
      ep(2, 'fix', 'guarded foo'),
      ep(3, 'error', 'TypeError: cannot read foo of undefined at /app/src/A.tsx:2:2'),
      ep(4, 'fix', 'guarded foo again'),
      ep(5, 'error', 'TypeError: cannot read foo of undefined at /app/src/A.tsx:3:3'),
    ];
    const r = reflectOnBuild({ ok: false, summary: 'failed', steps: 9, episodes });
    expect(r.recurringErrors).toHaveLength(1);
    expect(r.recurringErrors[0].count).toBe(3);
    expect(r.lessons[0]).toContain('recurred 3×');
  });
});

describe('reflectionNote', () => {
  it('includes the [reflection] tag, the summary and the lessons', () => {
    const episodes: Episode[] = [
      ep(1, 'error', 'Module not found: react-router-dom'),
      ep(2, 'fix', 'installed react-router-dom'),
    ];
    const r = reflectOnBuild({ ok: true, summary: 'done', steps: 5, episodes });
    const note = reflectionNote(r);

    expect(note).toContain('[reflection]');
    expect(note).toContain(r.summary);
    expect(note).toContain('- lesson:');
    expect(note).toContain('react-router-dom');
  });

  it('stays within the ~1500 char cap even with long lessons', () => {
    const long = 'x'.repeat(500);
    const episodes: Episode[] = [];
    let ts = 0;
    for (let i = 0; i < 8; i++) {
      episodes.push(ep(++ts, 'error', `${long} error ${i}`));
      episodes.push(ep(++ts, 'fix', `${long} fix ${i}`));
    }
    const r = reflectOnBuild({ ok: false, summary: 'failed', steps: 9, episodes });
    const note = reflectionNote(r);

    expect(note.length).toBeLessThanOrEqual(1500);
    expect(note).toContain('[reflection]');
  });
});
