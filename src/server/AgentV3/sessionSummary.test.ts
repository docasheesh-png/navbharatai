import { describe, it, expect } from 'vitest';
import { summarizeSession, sessionSummaryLine, formatElapsed } from './sessionSummary';

/**
 * TWO COMPLAINTS, ONE ROOT CAUSE (admin, 2026-08-06).
 *
 *   • "the build ran 58 minutes, not 18" — startedAt/endedAt are PER TURN, so a session of several
 *     `continue` turns reports only its last slice. The number that decides whether this product feels
 *     fast is the one the user waited, and it appeared nowhere.
 *   • "the files were wiped three times and nothing said so" — the File Guardian DOES record every wipe
 *     it repairs, but those events belonged to earlier TURNS, so all three reports were silent, each
 *     being a different turn. The data existed; only its scope was wrong.
 */
describe('summarizeSession — what the user lived through', () => {
  const t0 = 1786030000000;
  const min = 60_000;

  it('measures from the FIRST turn, not this one', () => {
    // The exact shape of the complaint: three turns, ~58 minutes lived, ~19 reported by the last turn.
    const history = [
      { startedAt: t0, endedAt: t0 + 20 * min, ok: true },
      { startedAt: t0 + 20 * min, endedAt: t0 + 39 * min, ok: true },
    ];
    const s = summarizeSession(history, t0 + 39 * min, t0 + 58 * min);
    expect(s.turns).toBe(3);
    expect(Math.round(s.elapsedMs / min)).toBe(58);
    expect(formatElapsed(s.elapsedMs)).toBe('58m 0s');
  });

  it('totals the workspace wipes across the whole session', () => {
    const history = [
      { startedAt: t0, ok: true, dataLossCount: 1 },
      { startedAt: t0 + min, ok: true, dataLossCount: 2 },
    ];
    expect(summarizeSession(history, t0 + 2 * min, t0 + 3 * min).dataLossTotal).toBe(3);
  });

  it('counts earlier turns that ended without success', () => {
    const history = [{ startedAt: t0, ok: false }, { startedAt: t0 + min, ok: true }, { startedAt: t0 + 2 * min, ok: false }];
    expect(summarizeSession(history, t0 + 3 * min, t0 + 4 * min).failedTurns).toBe(2);
  });

  it('a FIRST turn has no session to summarise, and says nothing', () => {
    const s = summarizeSession([], t0, t0 + min);
    expect(s.turns).toBe(1);
    expect(sessionSummaryLine(s)).toBe('');
  });

  it('a capped history is a FLOOR, and is reported as one', () => {
    // A floor presented as a total is the same understatement this whole thing exists to fix.
    const history = Array.from({ length: 50 }, (_, i) => ({ startedAt: t0 + i * min, ok: true }));
    const s = summarizeSession(history, t0 + 50 * min, t0 + 51 * min, 50);
    expect(s.truncated).toBe(true);
    expect(sessionSummaryLine(s)).toContain('at least');
  });

  it('never throws on junk, and never invents a negative duration', () => {
    expect(summarizeSession(null, t0, t0).elapsedMs).toBe(0);
    expect(summarizeSession(undefined, t0 + min, t0).elapsedMs).toBe(0); // a clock going backwards
    expect(summarizeSession([{ startedAt: NaN } as never], t0, t0 + min).turns).toBe(1);
  });
});

describe('sessionSummaryLine — the sentence the admin reads', () => {
  const t0 = 1786030000000;
  const min = 60_000;

  it('answers BOTH complaints in one line', () => {
    const s = summarizeSession(
      [{ startedAt: t0, ok: false, dataLossCount: 2 }, { startedAt: t0 + 20 * min, ok: true, dataLossCount: 1 }],
      t0 + 39 * min,
      t0 + 58 * min,
    );
    const line = sessionSummaryLine(s);
    expect(line).toContain('turn 3 of this session');
    expect(line).toContain('58m 0s in total');          // the wait the user actually lived
    expect(line).toContain('1 earlier turn ended without success');
    expect(line).toContain('empty or missing files 3 times');  // the wipes no single report showed
  });

  it('stays quiet about things that did not happen', () => {
    const s = summarizeSession([{ startedAt: t0, ok: true }], t0 + min, t0 + 2 * min);
    const line = sessionSummaryLine(s);
    expect(line).toContain('turn 2 of this session');
    expect(line).not.toContain('without success');
    expect(line).not.toContain('empty or missing');
  });
});

describe('formatElapsed', () => {
  it('reads naturally either side of a minute', () => {
    expect(formatElapsed(45_000)).toBe('45s');
    expect(formatElapsed(3_483_000)).toBe('58m 3s');
    expect(formatElapsed(-5)).toBe('0s');
  });
});
