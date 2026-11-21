// A PLAYTEST THAT RAN OUT OF TIME KEEPS WHAT IT MEASURED (failedbr #2485, Q-3230).
//
// The report: «GAME_PLAYTEST_NOT_RUN — the game was never played — the playtest ran out of time while checking the score, the
// sound and play again (the page drew 20 frames per second). Nothing here shows that it is playable: its controls, its speed
// and its camera were not checked in a browser.» That last sentence was FALSE: the game had been started and played with the
// keyboard, and its speed and camera read, before the clock ran out in a LATER stage. 🧬 THE CLASS: a check that discards
// its own evidence when a later step fails, and then says there is none.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { playtestVerdict, playtestDefects, scorePlaytest, phoneUnmeasured, type PlaytestRun } from '../src/server/AgentV3/gamePlaytest';

const src = readFileSync(join(__dirname, '../src/server/AgentV3/gamePlaytest.ts'), 'utf8');
const replay = { progress: true, restart: true, driving: false } as never;
/** A run as the script reports it: played with the keyboard, drawing 20 fps, then the clock ran out. */
const played = (extra: Partial<PlaytestRun> = {}): PlaytestRun => ({
  ok: true, webgl: true, started: 'Play', fps: 20, spread: 30, brightness: 120, idle: 1.2, keys: 6, space: 4, drag: 3, errorCount: 0,
  ...extra,
} as PlaytestRun);

describe('⏱️ the script keeps its evidence', () => {
  it('after the keyboard stage, a timeout sends everything measured and names what did not finish', () => {
    expect(src).toMatch(/if \(out\.playedKeyboard\) \{\s*say\(\{ \.\.\.out, ok: true, partial: true, unfinished: out\.stage, phoneChecked: out\.phoneChecked === true \}\);/);
    // The flag is set exactly when the keyboard stage is over, and the phone flag when the phone stage is.
    expect(src).toMatch(/out\.playedKeyboard = true;[^\n]*\n\s*out\.stage = 'checking the score, the sound and play again';/);
    expect(src).toMatch(/await m\.close\(\);\n\s*out\.phoneChecked = true;/);
    // A run that never got that far is still "not run".
    expect(src).toMatch(/say\(\{ ok: false, partial: true, webgl: out\.webgl, stage: out\.stage, fps,/);
  });
});

describe('⏱️ the verdict tells the truth about a partial run', () => {
  const timedOut = played({ partial: true, unfinished: 'checking the score, the sound and play again', phoneChecked: false });

  it('the exact #2485 shape: PLAYED, scored on what was measured, and the phone is "not checked" — not zero', () => {
    const v = playtestVerdict(timedOut, replay);
    expect(v.code).not.toBe('GAME_PLAYTEST_NOT_RUN');
    expect(v.message).toMatch(/played in a real browser/);
    expect(v.message).toMatch(/Phone not checked/);
    expect(v.message).toMatch(/The check ran out of time while checking the score, the sound and play again, so play on a phone \(touch\) was not checked — that is NavBharatAI's check, not the game\./);
    expect(v.message).not.toMatch(/never played/);
    expect(phoneUnmeasured(timedOut)).toBe(true);
  });

  it('an unmeasured phone costs no points and names no defect', () => {
    const s = scorePlaytest(timedOut, replay);
    expect(s.unmeasured).toEqual(['mobile']);
    // The same measures with the phone counted as a zero (what the old code would have scored) are LOWER: the
    // unmeasured dimension is left out of the average, never averaged in as a failure.
    const asZero = scorePlaytest(played(), replay);
    expect(asZero.unmeasured).toBeUndefined();
    expect(asZero.dimensions.mobile).toBe(0);
    expect(s.overall).toBeGreaterThan(asZero.overall);
    expect(playtestDefects(timedOut, s).map((d) => d.code)).not.toContain('GAME_DEFECT_NO_TOUCH');
    expect(s.weakest).not.toBe('mobile');
  });

  it('🔒 a phone that WAS checked and found dead is still a defect; a run that never played is still not run', () => {
    const dead = played({ touch: 0, touchIdle: 0, touchControls: 0, touchSurface: true });
    expect(playtestDefects(dead, scorePlaytest(dead, replay)).map((d) => d.code)).toContain('GAME_DEFECT_NO_TOUCH');
    expect(scorePlaytest(dead, replay).unmeasured).toBeUndefined();
    const never = { ok: false, partial: true, stage: 'starting the game', fps: 3, error: 'the playtest ran out of time while starting the game (the page drew 3 frames per second)' } as PlaytestRun;
    expect(playtestVerdict(never, replay).code).toBe('GAME_PLAYTEST_NOT_RUN');
    // The phone stage finished but a later tail did not: nothing is unmeasured.
    expect(phoneUnmeasured(played({ partial: true, unfinished: 'x', phoneChecked: true }))).toBe(false);
  });
});
