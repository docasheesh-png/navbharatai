import { describe, it, expect } from 'vitest';
import { healFingerprint, recordHeal, repeatedHeals } from './healRepeat';

// Build 6414138d (login page, 2026-08-09) printed these three lines, verbatim and identical, at t=126s,
// t=216s and t=313s of a single 5m45s build:
//
//     🔧 Added 2 missing import(s) …
//     🔧 Removed a duplicate import in `src/App.tsx` …
//     🔧 Removed a duplicate import in `src/main.tsx` …
//
// A repair that genuinely repaired something cannot find the identical defect again minutes later. The
// second firing is evidence that the write did not hold — and printing another green "🔧 fixed it" is
// exactly how that stayed invisible. These tests pin the rule: heal once, then say it is a bug.

describe('recognising the same repair again', () => {
  it('treats the first repair as an ordinary fix', () => {
    const seen = new Map<string, number>();
    const v = recordHeal(seen, { kind: 'duplicate-import', file: 'src/App.tsx' });
    expect(v.repeat).toBe(false);
    expect(v.occurrence).toBe(1);
  });

  it('calls the second one what it is — and says so in words an admin can act on', () => {
    const seen = new Map<string, number>();
    recordHeal(seen, { kind: 'duplicate-import', file: 'src/App.tsx' });
    const v = recordHeal(seen, { kind: 'duplicate-import', file: 'src/App.tsx' });
    expect(v.repeat).toBe(true);
    if (!v.repeat) throw new Error('unreachable');
    expect(v.occurrence).toBe(2);
    expect(v.message).toContain('src/App.tsx');       // WHICH file
    expect(v.message).toContain('2 times');            // HOW many
    expect(v.message.toLowerCase()).toContain('bug');  // and what it means
  });

  it('replays the reported build: three firings, and only the first reads as a fix', () => {
    const seen = new Map<string, number>();
    const verdicts = [1, 2, 3].map(() => recordHeal(seen, { kind: 'duplicate-import', file: 'src/App.tsx' }));
    expect(verdicts.map((v) => v.repeat)).toEqual([false, true, true]);
    expect(verdicts[2].occurrence).toBe(3);
  });
});

describe('what counts as "the same repair"', () => {
  it('keeps different files apart — App.tsx and main.tsx are two real repairs, not a repeat', () => {
    // The report shows both in the same pass. Collapsing them would hide a genuine second fix.
    const seen = new Map<string, number>();
    expect(recordHeal(seen, { kind: 'duplicate-import', file: 'src/App.tsx' }).repeat).toBe(false);
    expect(recordHeal(seen, { kind: 'duplicate-import', file: 'src/main.tsx' }).repeat).toBe(false);
  });

  it('keeps different repair kinds on one file apart', () => {
    const seen = new Map<string, number>();
    expect(recordHeal(seen, { kind: 'missing-import', file: 'src/App.tsx' }).repeat).toBe(false);
    expect(recordHeal(seen, { kind: 'duplicate-import', file: 'src/App.tsx' }).repeat).toBe(false);
  });

  it('uses detail to separate two repairs of the same kind on one file', () => {
    const seen = new Map<string, number>();
    expect(recordHeal(seen, { kind: 'missing-import', file: 'src/App.tsx', detail: 'CANVAS_HEIGHT' }).repeat).toBe(false);
    expect(recordHeal(seen, { kind: 'missing-import', file: 'src/App.tsx', detail: 'CANVAS_WIDTH' }).repeat).toBe(false);
  });

  it('is not fooled by casing or stray whitespace in a path', () => {
    const seen = new Map<string, number>();
    recordHeal(seen, { kind: 'duplicate-import', file: 'src/App.tsx' });
    expect(recordHeal(seen, { kind: 'Duplicate-Import', file: ' src/App.tsx ' }).repeat).toBe(true);
  });

  it('fingerprints are stable and distinct', () => {
    const a = healFingerprint({ kind: 'missing-import', file: 'src/App.tsx' });
    expect(healFingerprint({ kind: 'missing-import', file: 'src/App.tsx' })).toBe(a);
    expect(healFingerprint({ kind: 'missing-import', file: 'src/main.tsx' })).not.toBe(a);
  });
});

describe('the build report summary', () => {
  it('lists only what repeated, worst first', () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < 3; i++) recordHeal(seen, { kind: 'duplicate-import', file: 'src/App.tsx' });
    recordHeal(seen, { kind: 'duplicate-import', file: 'src/main.tsx' });
    recordHeal(seen, { kind: 'duplicate-import', file: 'src/main.tsx' });
    recordHeal(seen, { kind: 'missing-import', file: 'src/theme.tsx' }); // healed once — not a problem
    const worst = repeatedHeals(seen);
    expect(worst.map((r) => r.count)).toEqual([3, 2]);
    expect(worst[0].fingerprint).toContain('src/app.tsx');
  });

  it('is empty when every repair held — the goal state', () => {
    const seen = new Map<string, number>();
    recordHeal(seen, { kind: 'missing-import', file: 'src/App.tsx' });
    expect(repeatedHeals(seen)).toEqual([]);
    expect(repeatedHeals(new Map())).toEqual([]);
  });
});
