/**
 * A game opens on the cheap engine — where it can (admin 2026-09-27).
 *
 * The admin, asked whether games should join reminder and planner apps on the cheap opening rung:
 * *"han, agar saste module me ho sakte hai to, hona chahiye"* — yes, where the cheap engine can build it.
 *
 * Before this, every prompt the requirement analyser labelled `game` scored 58 / complex_app — the score
 * of a hospital ERP — because `namesBusinessDomain` promoted every labelled domain. "Build a car racing
 * game" opened on the always-reasoning rung and skipped the fast lane, while "snake game" scored 15 only
 * because it happened to be named in `SIMPLE_APP_SIGNAL`.
 *
 * The admin's condition is the second half of this file: a game that names real engineering — 3D,
 * multiplayer or online play, a physics engine, an open world — keeps the complex opening, and so does
 * one that asks for login or a database.
 */
import { describe, it, expect } from 'vitest';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { HEAVY_GAME_SIGNAL, namesBusinessDomain, namesPersonalTool } from '../src/server/lib/appComplexitySignals';

const size = (prompt: string) => analyzeRequest({ prompt, buildIntent: 'new_build' } as never);

describe('an ordinary game is the simple family', () => {
  for (const p of [
    'build a car racing game',
    'build a platformer game',
    'make a tower defense game',
    'build an endless runner game for kids',
    'a physics quiz game for class 10',
    'একটি খেলার অ্যাপ',
  ]) {
    it(`"${p}" opens on the cheap rung`, () => {
      expect(namesBusinessDomain(p)).toBe(false);
      expect(namesPersonalTool(p)).toBe(true);
      const r = size(p);
      expect(r.taskType).toBe('simple_app');
      expect(r.complexityScore).toBeLessThan(40);
    });
  }

  it('a game already named as simple stays exactly where it was', () => {
    expect(size('snake game').taskType).toBe('simple_app');
    expect(size('memory game').taskType).toBe('simple_app');
  });
});

describe('🔒 the admin\'s condition — a heavy game keeps the complex opening', () => {
  for (const p of [
    'build a 3d racing game with three.js',
    'build a multiplayer chess game',
    'online multiplayer battle game',
    'physics-based puzzle game',
    'an open world adventure game',
    'build a pvp arena game',
  ]) {
    it(`"${p}" is still complex`, () => {
      expect(namesPersonalTool(p)).toBe(false);
      expect(size(p).taskType).toBe('complex_app');
    });
  }

  it('scope words still win before any domain is asked', () => {
    expect(size('a game with login and a leaderboard database').taskType).toBe('complex_app');
  });

  it('"3d ball" is a named simple app, not a 3D game', () => {
    expect(HEAVY_GAME_SIGNAL.test('3d ball bouncing')).toBe(false);
    expect(HEAVY_GAME_SIGNAL.test('3d racing')).toBe(true);
  });

  it('"physics" alone is a school subject; "community" is not Unity', () => {
    expect(HEAVY_GAME_SIGNAL.test('a physics quiz')).toBe(false);
    expect(HEAVY_GAME_SIGNAL.test('a community quiz game')).toBe(false);
    expect(HEAVY_GAME_SIGNAL.test('made in unity')).toBe(true);
  });
});

describe('🔒 nothing that is not a game moved', () => {
  it('the business domains are untouched', () => {
    for (const p of ['hospital management system', 'restaurant billing app', 'a gym membership app', 'E commerce website']) {
      expect(namesBusinessDomain(p), p).toBe(true);
      expect(size(p).taskType, p).toBe('complex_app');
    }
  });

  it('"game plan" and "gamified" were never games, and still are not', () => {
    expect(size('build a CRM for our sales game plan').taskType).toBe('complex_app');
    expect(namesPersonalTool('build a CRM for our sales game plan')).toBe(false);
  });

  it('a heavy word outside a game changes nothing', () => {
    // HEAVY_GAME_SIGNAL is consulted only for the game domain — a reminder app that mentions "3d" icons
    // is still a personal tool.
    expect(namesPersonalTool('build a reminder app with 3d icons')).toBe(true);
  });
});
