/**
 * Locked plan item 3 (admin 2026-11-24; weakness audit P0-1, safe form): a tapped game fix is measured, not claimed.
 *
 * Automatic game repair stays OFF (docs/security/game-auto-repair-suspension.md). The user's own tap on "Make the
 * game playable" runs a normal turn; before this, only a turn that made the game WORSE was compared and said. A
 * better or unchanged game ended with no verdict. Now the two measures are put side by side and said in numbers.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gameFixOutcome, GAME_FIX_UNVERIFIED_MESSAGE, type GameMeasure } from '../src/server/AgentV3/gameRegression';
import { reportGameFixOutcome, reportGameFixUnverified } from '../src/server/AgentV3/buildPhases/gameFixVerdict';
import { FINDING_SUGGESTIONS, isGameFixTurn } from '../src/server/AgentV3/buildFindingSuggestions';

const ROUTE = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
const m = (score: number | null, defects: string[] = []): GameMeasure => ({ score, defects: defects as GameMeasure['defects'] });
const ports = (fixTurn: boolean) => ({ fixTurn, record: vi.fn(), say: vi.fn() });

describe('gameFixOutcome', () => {
  it('🔴 41 → 78 with the controls fixed: verified, both numbers, playable now', () => {
    const o = gameFixOutcome(m(41, ['GAME_DEFECT_INPUT_IGNORED']), m(78));
    expect(o?.code).toBe('GAME_FIX_VERIFIED');
    expect(o?.message).toMatch(/Played before: 41\/100\. Played after: 78\/100 — playable now\./);
    expect(o?.message).toMatch(/Fixed: the controls no longer do anything/);
  });
  it('better but still below the playable line is said as such', () => {
    expect(gameFixOutcome(m(41), m(60))?.message).toMatch(/better, but not fully playable yet/);
  });
  it('41 → 41: no change, never reported as fixed', () => {
    const o = gameFixOutcome(m(41), m(41));
    expect(o?.code).toBe('GAME_FIX_NO_CHANGE');
    expect(o?.message).toMatch(/not reported as fixed/);
  });
  it('worse is left to GAME_GOT_WORSE (it carries the way back)', () => {
    expect(gameFixOutcome(m(78), m(40))).toBeNull();
  });
  it('nothing measured on either side: no verdict invented', () => {
    expect(gameFixOutcome(null, m(80))).toBeNull();
    expect(gameFixOutcome(m(40), null)).toBeNull();
  });
});

describe('what the user hears', () => {
  it('a better game is said on any turn', () => {
    const p = ports(false);
    expect(reportGameFixOutcome(m(41), m(78), p)).toBe('GAME_FIX_VERIFIED');
    expect(p.say).toHaveBeenCalledWith(expect.stringMatching(/Played before: 41\/100/));
  });
  it('an unchanged game is said only on the user\'s tapped fix turn', () => {
    const ordinary = ports(false);
    expect(reportGameFixOutcome(m(80), m(80), ordinary)).toBeNull();
    expect(ordinary.say).not.toHaveBeenCalled();
    const tapped = ports(true);
    expect(reportGameFixOutcome(m(41), m(41), tapped)).toBe('GAME_FIX_NO_CHANGE');
    expect(tapped.record.mock.calls[0][0].severity).toBe('warning');
  });
  it('a tapped fix that could not be played again is said as not known; an ordinary turn stays silent', () => {
    const tapped = ports(true);
    expect(reportGameFixUnverified(tapped)).toBe('GAME_FIX_UNVERIFIED');
    expect(tapped.say).toHaveBeenCalledWith(`🎮 ${GAME_FIX_UNVERIFIED_MESSAGE}`);
    expect(reportGameFixUnverified(ports(false))).toBeNull();
  });
  it('a port that throws never breaks the build', () => {
    expect(reportGameFixOutcome(m(41), m(78), { fixTurn: true, record: () => { throw new Error('x'); }, say: vi.fn() })).toBeNull();
  });
});

describe('the fix turn is recognised from the offer\'s own prompt', () => {
  const offer = FINDING_SUGGESTIONS.find((s) => s.code === 'GAME_PLAYTEST_ISSUES')!.prompt;
  it('the offer plus its evidence is a fix turn; another edit is not', () => {
    expect(isGameFixTurn(`${offer}\n\nWeakest: Controls — the arrows do nothing.`)).toBe(true);
    expect(isGameFixTurn('add enemies that give score when killed')).toBe(false);
    expect(isGameFixTurn('')).toBe(false);
  });
});

describe('🔒 wiring', () => {
  it('the route says the outcome after the playtest and the not-known case when it could not play', () => {
    expect(ROUTE).toMatch(/reportGameFixOutcome\(before, \{ score: verdict\.score\?\.overall \?\? null, defects: measured\.map\(\(d\) => d\.code\) \}, gameFixPorts\)/);
    expect(ROUTE).toMatch(/gateEvidence\.game = 'not-run';[^\n]*\n\s+reportGameFixUnverified\(gameFixPorts\);/);
    expect(ROUTE).toMatch(/fixTurn: isGameFixTurn\(prompt\)/);
  });
  it('an edit of an existing canvas game holds the playtest\'s time too', () => {
    expect(ROUTE).toMatch(/wasGameAtStart \?\?= projectFilesAtTurnStart \? isCanvasGameProject\(projectFilesAtTurnStart\) : undefined;/);
  });
});
