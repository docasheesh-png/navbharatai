import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  playtestSkipReason, playtestNotRunVerdict, scorePlaytest, STILL_BELOW,
} from '../src/server/AgentV3/gamePlaytest';

/**
 * 🧬 A CANVAS GAME NOBODY PLAYED SAYS SO — Q-913, autopsy `50378049` (BlockWorld, a voxel game,
 * 2026-10-12).
 *
 * The report's dark screen was never resolved, and the only account of it left in the build was the
 * MODEL's own prose — *"normal for a sandbox game — players can move and dig to daylight"* — an
 * explanation standing where a measurement belonged.
 *
 * **The measurement existed the whole time.** `scorePlaytest`'s `runs` dimension is read from the
 * brightness SPREAD of a 48×27 sample (`compare`: the standard deviation of luminance, which is zero for
 * a flat colour) and scores **0** for *"The game screen is blank or a single colour — draw the world and
 * the player on it."* A uniformly dark canvas is exactly that.
 *
 * 🔑 IT NEVER RAN, AND NOTHING SAID SO. The route's playtest gate is one long `if (…)` with **no
 * `else`** — so when the preview address had been discarded (Q-900) the whole check was **silently
 * skipped**. `playtestNotRunVerdict` already promises *"one sentence for every way it is reached (the
 * runner's own answer, and the route's timeout or crash)"*; the THIRD way — the route never calling it —
 * had no sentence at all.
 *
 * 🔒 "Could not look" and "not applicable" are different facts, and conflating them would turn this into
 * a nag on every non-game build. Only a canvas game the route COULD NOT PLAY gets the warning.
 */

const ctx = (over: Partial<Parameters<typeof playtestSkipReason>[0]> = {}) => ({
  enabled: true,
  buildOk: true,
  isCanvasGame: true,
  isImportTurn: false,
  aborted: false,
  hasRunCommand: true,
  hasPreviewUrl: true,
  awaitsShell: false,
  timeLeft: true,
  ...over,
});

describe('a game nobody played says so (Q-913, autopsy 50378049)', () => {
  describe('the measurement that already existed, verified', () => {
    /** `run.spread` is the luminance standard deviation of the sample — 0 for any flat colour. */
    const run = (spread: number) => ({ ok: true, spread, idle: 0, moves: [] } as never);
    const noGameFacts = { driving: false } as never;

    it('🔴 a flat screen scores runs = 0 — a black canvas is "blank or a single colour"', () => {
      expect(scorePlaytest(run(0), noGameFacts).dimensions.runs).toBe(0);
      expect(scorePlaytest(run(0.4), noGameFacts).dimensions.runs).toBe(0);
    });

    it('…and a drawn world scores it full, so this is not a blunt instrument', () => {
      expect(scorePlaytest(run(1), noGameFacts).dimensions.runs).toBe(50);
      expect(scorePlaytest(run(12), noGameFacts).dimensions.runs).toBe(100);
    });

    it('the threshold is a brightness SPREAD, not a brightness — a dark but drawn scene still passes', () => {
      // This is why the fix is not "flag dark screens": a night scene has contrast, a dead canvas has none.
      expect(scorePlaytest(run(8), noGameFacts).dimensions.runs).toBe(100);
      expect(STILL_BELOW).toBeLessThan(1);
    });
  });

  describe('🔴 "could not look" now has a sentence', () => {
    it('THE REPORTED BUILD: a canvas game with no preview address', () => {
      expect(playtestSkipReason(ctx({ hasPreviewUrl: false })))
        .toBe('no live preview address was available to open the game at');
    });

    it('a module turn judged as awaiting its shell', () => {
      expect(playtestSkipReason(ctx({ awaitsShell: true })))
        .toContain('assembled by a later one');
    });

    it('no command channel, and no time left', () => {
      expect(playtestSkipReason(ctx({ hasRunCommand: false }))).toContain('no way to run a browser');
      expect(playtestSkipReason(ctx({ timeLeft: false }))).toContain('no time left');
    });

    it('the first missing thing is the one named, so the sentence is never vague', () => {
      // Several missing at once: the reader is told the one that mattered first, not a list.
      expect(playtestSkipReason(ctx({ hasPreviewUrl: false, timeLeft: false, hasRunCommand: false })))
        .toBe('no live preview address was available to open the game at');
    });

    it('the warning it produces is an OPEN warning that names what was not done', () => {
      const v = playtestNotRunVerdict(playtestSkipReason(ctx({ hasPreviewUrl: false }))!);
      expect(v.code).toBe('GAME_PLAYTEST_NOT_RUN');
      expect(v.severity).toBe('warning');
      expect(v.autoResolved).toBe(false);
      expect(v.score).toBeNull();
      expect(v.message).toContain('The game was never played');
      expect(v.message).toContain('its controls, its speed and its camera were not checked in a browser');
    });
  });

  describe('🔒 "not applicable" stays SILENT — otherwise this is a nag', () => {
    it('a project with no canvas game', () => {
      expect(playtestSkipReason(ctx({ isCanvasGame: false }))).toBeNull();
    });

    it('the kill switch, an import turn, a stopped build and a failed build', () => {
      expect(playtestSkipReason(ctx({ enabled: false }))).toBeNull();
      expect(playtestSkipReason(ctx({ isImportTurn: true }))).toBeNull();
      expect(playtestSkipReason(ctx({ aborted: true }))).toBeNull();
      expect(playtestSkipReason(ctx({ buildOk: false }))).toBeNull();
    });

    it('a build that COULD look says nothing — the playtest itself speaks', () => {
      expect(playtestSkipReason(ctx())).toBeNull();
    });

    it('not-applicable wins over could-not-look, so a non-game is never warned about', () => {
      expect(playtestSkipReason(ctx({ isCanvasGame: false, hasPreviewUrl: false }))).toBeNull();
      expect(playtestSkipReason(ctx({ buildOk: false, hasPreviewUrl: false }))).toBeNull();
    });
  });

  describe('🔒 the wiring — the gate finally has an else', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

    it('the skipped path records it instead of returning silently', () => {
      expect(route).toContain('const why = playtestSkipReason({');
      expect(route).toContain('const notRun = playtestNotRunVerdict(why);');
    });

    it('it reads the SAME conditions the gate reads, so the two cannot disagree', () => {
      const at = route.indexOf('const why = playtestSkipReason({');
      const block = route.slice(at, at + 900);
      for (const field of [
        'enabled: gamePlaytestEnabled()',
        'isCanvasGame: isCanvasGameProject(playtestFiles)',
        'hasPreviewUrl: !!lastPreviewUrl',
        'awaitsShell: !!awaitsShellNow()',
        'hasRunCommand: !!actuator.runCommand',
      ]) expect(block).toContain(field);
    });

    it('and it can never touch the build', () => {
      const at = route.indexOf('const why = playtestSkipReason({');
      expect(route.slice(at, at + 1400)).toContain('catch { /* an honest line is best-effort');
    });
  });
});
