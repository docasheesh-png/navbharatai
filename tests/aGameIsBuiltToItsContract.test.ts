/**
 * A game is built to its contract (Game Engine Ultra Phase 1, 2026-10-30).
 * Prompts are the real ones from the game autopsies (racing 46e2d74b, god of war 6a55d939, candy, snake).
 */
import { describe, it, expect } from 'vitest';
import { buildGameContract, gameContractBlock, gameScopeContractEnabled, scopeMatch } from '../src/server/AgentV3/gameIntent';
import { gameScopeVerdict } from '../src/server/AgentV3/gamePlaytest';
import { gameKitHandoffBlock } from '../src/server/AgentV3/gameKitSeed';

describe('the contract is read from the request', () => {
  it('racing game for a phone (build 46e2d74b)', () => {
    const c = buildGameContract('Create an racing game for Nokia c 2-01');
    expect(c.genre).toBe('racing');
    expect(c.requiredFeatures).toEqual([]);
  });
  it('god of war (autopsy 6a55d939) is a fighting game', () => {
    expect(buildGameContract('Build a app like god of war').genre).toBe('fighting');
  });
  it('names features, controls, 3D and win/lose only when the user said them', () => {
    const c = buildGameContract('Make a 3D snake game with score, 3 levels, a timer, arrow keys and swipe on mobile, game over screen');
    expect(c.genre).toBe('snake');
    expect(c.dimension).toBe('3d');
    expect(c.requiredFeatures).toEqual(['score', 'levels', 'timer']);
    expect(c.controls).toEqual(['keyboard', 'touch']);
    expect(c.winLoseNamed).toBe(true);
  });
  it('a candy match-3 is a puzzle', () => {
    expect(buildGameContract('candy crush jaisa match-3 game banao with lives').requiredFeatures).toContain('lives');
  });
  it('Hindi "khel" is a game (Phase 4 finding, admin report prompt)', () => {
    expect(buildGameContract('ek car wala khel banao').genre).toBe('racing');
  });
  it('never throws on empty input', () => {
    expect(buildGameContract(undefined).genre).toBe('unknown');
    expect(gameContractBlock(buildGameContract(''))).toBe('');
  });
});

describe('the contract reaches the builder', () => {
  it('is inside the kit handoff when supplied, absent otherwise', () => {
    const res = [{ recipe: 'generate_game_runtime', ok: true, content: 'Created src/game/core/loop.ts' }];
    const block = gameContractBlock(buildGameContract('car racing game with score and levels'));
    expect(gameKitHandoffBlock(res, { contract: block })).toContain('GAME SCOPE CONTRACT');
    expect(gameKitHandoffBlock(res)).not.toContain('GAME SCOPE CONTRACT');
  });
});

describe('scope match is evidence only', () => {
  const c = buildGameContract('shooter game with score, enemies and a leaderboard');
  it('finds what the game code has and what it lacks, ignoring kit engine files', () => {
    const files = {
      'src/game/core/meta.ts': 'leaderboard ranking',
      'src/game/shooter/Game.tsx': 'let score = 0; const enemies = [];',
    };
    expect(scopeMatch(c, files)).toEqual({ present: ['score', 'enemies'], missing: ['leaderboard'] });
    const v = gameScopeVerdict(c, files)!;
    expect(v.code).toBe('GAME_SCOPE_GAP');
    expect(v.severity).toBe('info');
    expect(v.autoResolved).toBe(true);
  });
  it('OK when all named features are present; null when none were named', () => {
    expect(gameScopeVerdict(c, { 'src/App.tsx': 'score enemy leaderboard' })!.code).toBe('GAME_SCOPE_OK');
    expect(gameScopeVerdict(buildGameContract('racing game'), {})).toBeNull();
  });
  it('kill switch', () => {
    expect(gameScopeContractEnabled({ AGENTV3_GAME_SCOPE_CONTRACT: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(gameScopeContractEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });
});
