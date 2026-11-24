/**
 * Phase 1 of the Game Maker plan: a design document on top of the existing scope contract.
 * It must not invent a second genre, must not put 3D physics on a 2D game, and must not
 * call a game complete without a playtest.
 */
import { describe, it, expect } from 'vitest';
import { gameTurnHandoff } from '../src/server/AgentV3/gameKitSeed';
import { analyzeGameRequirements, designCoverage, gameDesignBlock } from '../src/server/AgentV3/gameDesignDocument';
import { declinedGameFeatures } from '../src/server/AgentV3/gameIntent';

const run = { writingRun: true, moduleTurn: false, importTurn: false, stopped: false };

describe('the design document reads the request and refuses what was declined', () => {
  it('a 3D race gets the racing profile on cannon-es, and a refused multiplayer stays refused', () => {
    const doc = analyzeGameRequirements('Make a 3D racing game with score and laps, no multiplayer', { drawnIn3D: true });
    expect(doc.scope.genre).toBe('racing');
    expect(doc.scope.requiredFeatures).toContain('score');
    expect(doc.engine).toBe('three-3d');
    expect(doc.physicsProfile).toBe('racing');
    expect(doc.physicsRuntime).toBe('cannon-es');
    expect(doc.playtestAdapter).toBe('racing');
    expect(doc.genreSystems.filter((s) => s.state === 'required').map((s) => s.id)).toEqual(
      expect.arrayContaining(['steering', 'acceleration', 'braking', 'track', 'lap-or-finish']),
    );
    expect(doc.requirements.find((r) => r.id === 'multiplayer')?.state).toBe('declined');
    expect(doc.multiplayerRequested).toBe(false);
    expect(declinedGameFeatures('Make a 3D racing game with score and laps, no multiplayer')).toContain('multiplayer');
    const block = gameDesignBlock(doc);
    expect(block).toContain('cannon-es');
    expect(block).toContain('Do not add a second physics engine');
    expect(block).toContain('multiplayer');
  });

  it('a refused brake is not a required racing system', () => {
    const doc = analyzeGameRequirements('3D racing game, no braking', { drawnIn3D: true });
    expect(doc.genreSystems.find((s) => s.id === 'braking')?.state).toBe('declined');
    expect(doc.requirements.find((r) => r.id === 'braking')?.state).toBe('declined');
    expect(gameDesignBlock(doc)).toContain('do not build: braking');
  });

  it('a 2D platformer stays on the 2D kit', () => {
    const doc = analyzeGameRequirements('2d platformer with jump and enemies', { drawnIn3D: false });
    expect(doc.engine).toBe('canvas-2d');
    expect(doc.physicsProfile).toBe('platformer');
    expect(doc.physicsRuntime).toBe('2d-kit');
    expect(gameDesignBlock(doc)).toContain('Do not put cannon-es');
    expect(doc.requirements.find((r) => r.id === 'enemies')?.state).toBe('required');
    expect(doc.requirements.find((r) => r.id === 'leaderboard')?.state).toBe('not-requested');
  });

  it('chess and ludo use the existing rules modules, not a new physics world', () => {
    const chess = analyzeGameRequirements('chess game with checkmate');
    expect(chess.engine).toBe('board');
    expect(chess.physicsRuntime).toBe('rules');
    expect(chess.rulesModule).toBe('src/game/board/chess.ts');
    expect(chess.playtestAdapter).toBe('board');
    expect(chess.genreSystems.map((s) => s.id)).toEqual(['legal-moves', 'illegal-move-rejection', 'check', 'checkmate', 'draw']);
    const ludo = analyzeGameRequirements('ludo with dice for 4 players');
    expect(ludo.rulesModule).toBe('src/game/board/ludo.ts');
    expect(ludo.genreSystems.map((s) => s.id)).toContain('safe-cells');
    expect(ludo.multiplayerRequested).toBe(false);
  });

  it('a royale reference keeps shooter systems and adds the royale ones', () => {
    const doc = analyzeGameRequirements('mujhe pubg jaisa game chahiye', { drawnIn3D: true });
    expect(doc.scope.genre).toBe('shooter');
    expect(doc.engine).toBe('three-3d');
    expect(doc.physicsRuntime).toBe('cannon-es');
    expect(doc.genreSystems.map((s) => s.id)).toEqual(expect.arrayContaining(['fire', 'loot', 'shrinking-zone']));
    expect(doc.playtestAdapter).toBe('shooter');
  });

  it('football points at the existing football rules', () => {
    const doc = analyzeGameRequirements('football game with goals');
    expect(doc.rulesModule).toBe('src/game/board/football.ts');
    expect(doc.physicsRuntime).toBe('rules');
    expect(doc.genreSystems.map((s) => s.id)).toEqual(expect.arrayContaining(['ball-physics', 'goals']));
  });

  it('never throws on empty input and adds nothing when no game was named', () => {
    const doc = analyzeGameRequirements(undefined);
    expect(doc.scope.genre).toBe('unknown');
    expect(gameDesignBlock(doc)).toBe('');
  });
});

describe('a game is not complete until it is played', () => {
  const doc = analyzeGameRequirements('3D racing game with score', { drawnIn3D: true });

  it('code that mentions the words is still not a pass without a playtest', () => {
    const files = { 'src/game/race/Game.tsx': 'score steer throttle brake track lap' };
    const gap = designCoverage(doc, files, {});
    expect(gap.canDeclareComplete).toBe(false);
    expect(gap.reason).toContain('playtest not verified');
    expect(gap.namedMissing).not.toContain('score');
  });

  it('a passed playtest still fails when a named feature or a genre system is absent', () => {
    const thin = designCoverage(doc, { 'src/game/race/Game.tsx': 'steer' }, { playtestPassed: true });
    expect(thin.canDeclareComplete).toBe(false);
    expect(thin.namedMissing).toContain('score');
    expect(thin.systems.find((s) => s.id === 'braking')?.status).toBe('missing');
  });

  it('passes only when the playtest passed and the asked systems are present', () => {
    const files = { 'src/game/race/Game.tsx': 'let score = 0; steer throttle brake track lap' };
    expect(designCoverage(doc, files, { playtestPassed: true }).canDeclareComplete).toBe(true);
  });

  it('a declined feature that was built anyway blocks completion', () => {
    const refused = analyzeGameRequirements('3D racing game with score, no multiplayer', { drawnIn3D: true });
    const files = { 'src/game/race/Game.tsx': 'score steer throttle brake track lap multiplayer socket' };
    const report = designCoverage(refused, files, { playtestPassed: true });
    expect(report.forbiddenPresent).toContain('multiplayer');
    expect(report.canDeclareComplete).toBe(false);
  });
});

describe('the builder hears the recipe, and only on a game turn', () => {
  it('a racing turn carries the design block after the scope contract', () => {
    const h = gameTurnHandoff('3D racing game with score', {}, run, {});
    expect(h.block).toContain('GAME SCOPE CONTRACT');
    expect(h.block.indexOf('GAME DESIGN')).toBeGreaterThan(h.block.indexOf('GAME SCOPE CONTRACT'));
    expect(h.block).toContain('Physics profile: racing via cannon-es');
  });

  it('a notes app and a switched-off contract do not grow a design block', () => {
    expect(gameTurnHandoff('build a notes app', {}, run, {}).block).not.toContain('GAME DESIGN');
    const off = gameTurnHandoff('3D racing game with score', {}, run, { AGENTV3_GAME_SCOPE_CONTRACT: 'off' });
    expect(off.contract).toBeNull();
    expect(off.block).not.toContain('GAME DESIGN');
  });
});
