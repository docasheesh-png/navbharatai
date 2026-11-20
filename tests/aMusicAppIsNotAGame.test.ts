// 🔴 ONLY A GAME'S MILESTONE BELONGS TO A GAME (failedbr #2271, 2026-11-20 — "INDIAN MUSIC").
//
// A music-streaming app's roadmap step 1 was "a single mobile-first Player screen with a real HTML5 <audio>
// element…". `gameTurnRequest` appended "This milestone belongs to a game." to every milestone, so the kit planner
// read the turn as a game and laid down the game runtime, game sounds and a game scope contract for an app with no
// game in it. The fixtures are the report's own prompt and step-1 build text.
// Reversion: delete the `requestIsGame(original)` guard in gameTurnRequest and the first test fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { gameKitPlan, gameTurnRequest, gameKitOwnsTheBuild } from '../src/server/AgentV3/gameKitSeed';

const MUSIC = readFileSync(`${__dirname}/fixtures/failedbr2271.music.prompt.txt`, 'utf8');
const STEP1 = readFileSync(`${__dirname}/fixtures/failedbr2271.step1.txt`, 'utf8');

describe('failedbr #2271: a music app\'s first milestone is not a game', () => {
  it('no game kit for the music player step', () => {
    expect(gameKitPlan(gameTurnRequest(MUSIC, STEP1), 'vite-react')).toEqual([]);
    expect(gameTurnRequest(MUSIC, STEP1)).not.toMatch(/belongs to a game/);
  });
  it('the whole request is not a game either (so Project Mode is not stood down for it)', () => {
    expect(gameKitOwnsTheBuild(MUSIC, 'vite-react', {})).toBe(false);
  });
});

describe('the boundaries: a game\'s milestone still belongs to a game', () => {
  it('a game original keeps the game line and the kit', () => {
    const t = gameTurnRequest('Mujhe racing game banana hai', 'Build the first playable track with one car');
    expect(t).toMatch(/belongs to a game/);
    expect(gameKitPlan(t, 'vite-react').length).toBeGreaterThan(0);
  });
  it('a milestone that is a game in its own words still reads as one', () => {
    expect(gameKitPlan(gameTurnRequest('Build a kids learning app with lessons and quizzes', 'Create a 2D platformer game level with a jumping player and coins'), 'vite-react').length).toBeGreaterThan(0);
  });
  it('no milestone is byte-identical', () => {
    expect(gameTurnRequest(MUSIC)).toBe(MUSIC);
  });
});
