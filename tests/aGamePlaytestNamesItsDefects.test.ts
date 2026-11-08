/**
 * Game Engine Ultra Phase 2 (2026-10-30): the playtest is repeatable (seeded), says when a quiz/card/board game
 * was not played, and names its defects with structured codes Phase 3 can consume. Evidence only, never a gate.
 */
import { describe, it, expect } from 'vitest';
import {
  playtestSeed, PLAYTEST_SEED, gamePlaytestConfig, gamePlaytestModule, domGameKind, domGameNotPlayedVerdict,
  playtestDefects, gameDefectsMessage, missingKitLayerPaths, playtestOutcome, type PlaytestScore,
} from '../src/server/AgentV3/gamePlaytest';
import { buildGameContract } from '../src/server/AgentV3/gameIntent';

const score = (d: Partial<PlaytestScore['dimensions']>, extra: Partial<PlaytestScore> = {}): PlaytestScore => ({
  overall: 0, weakest: 'runs', respondedTo: [],
  dimensions: { runs: 100, responds: 100, mobile: 100, stable: 100, smooth: 100, alive: 100, replay: 100, ...d },
  ...extra,
});

describe('seeded randomness', () => {
  it('is on by default and off by kill switch', () => {
    expect(playtestSeed({} as NodeJS.ProcessEnv)).toBe(PLAYTEST_SEED);
    expect(playtestSeed({ AGENTV3_GAME_PLAYTEST_SEED: 'off' } as NodeJS.ProcessEnv)).toBeNull();
  });
  it('reaches the browser module and seeds before the page loads', () => {
    const mod = gamePlaytestModule(gamePlaytestConfig('http://x', null, [], {} as NodeJS.ProcessEnv), '');
    expect(mod).toContain(`"seed":${PLAYTEST_SEED}`);
    expect(mod).toContain('addInitScript(seedRandom, cfg.seed)');
  });
  it('the seeded generator in the module is deterministic', () => {
    const mod = gamePlaytestModule(gamePlaytestConfig('http://x'), '');
    const src = mod.slice(mod.indexOf('const seedRandom'), mod.indexOf('// Frames are counted'));
    const run = (): number[] => {
      const orig = Math.random;
      try { new Function(`${src}; seedRandom(${PLAYTEST_SEED});`)(); return [Math.random(), Math.random(), Math.random()]; } finally { Math.random = orig; }
    };
    const a = run();
    expect(run()).toEqual(a);
    for (const v of a) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe('a game drawn in the page is said, not silent and not scored', () => {
  it('quiz from the contract', () => {
    expect(domGameKind({ 'src/App.tsx': '<div/>' }, buildGameContract('GK quiz game for kids'))).toBe('quiz');
  });
  it('board from the code', () => {
    expect(domGameKind({ 'src/Board.tsx': 'const board = [null,null]; function checkWinner(){}' })).toBe('board');
  });
  it('a canvas game is not a DOM game', () => {
    expect(domGameKind({ 'src/game/three/renderer.ts': 'x' }, buildGameContract('quiz'))).toBeNull();
  });
  it('a plain app is not a game', () => {
    expect(domGameKind({ 'src/App.tsx': 'export const Todo = () => null' })).toBeNull();
  });
  it('verdict is not-run with no score', () => {
    const v = domGameNotPlayedVerdict('card');
    expect(v.score).toBeNull();
    expect(playtestOutcome(v.code)).toBe('not-run');
  });
});

describe('structured defect codes', () => {
  it('input ignored, no touch, camera wrong, stalled, runtime error', () => {
    const codes = playtestDefects(
      { ok: true, errorCount: 1, errors: ['TypeError: x is undefined'] },
      score({ responds: 0, mobile: 0 }, { cameraFacesVehicle: true, stalledVehicle: true }),
    ).map((d) => d.code);
    expect(codes).toEqual(['GAME_DEFECT_INPUT_IGNORED', 'GAME_DEFECT_NO_TOUCH', 'GAME_DEFECT_CAMERA_WRONG', 'GAME_DEFECT_VEHICLE_STALLED', 'GAME_DEFECT_RUNTIME_ERROR']);
  });
  it('blank screen wins over input-ignored', () => {
    expect(playtestDefects(null, score({ runs: 0, responds: 0 })).map((d) => d.code)).toEqual(['GAME_DEFECT_BLANK']);
  });
  it('start stuck (46e2d74b "Start Race")', () => {
    expect(playtestDefects({ ok: false, started: 'Start Race', error: 'no game surface (canvas) appeared after pressing "Start Race"' }, null)[0].code).toBe('GAME_DEFECT_START_STUCK');
  });
  it('missing kit layer (6a55d939)', () => {
    const files = { 'src/game/Game.ts': "import { makeRenderer } from './three/renderer';\n" };
    const paths = missingKitLayerPaths(files);
    expect(paths).toContain('src/game/three/renderer.ts');
    expect(playtestDefects(null, null, paths)[0].code).toBe('GAME_DEFECT_MISSING_LAYER');
  });
  it('a healthy game has no defects and no message', () => {
    expect(gameDefectsMessage(playtestDefects({ ok: true }, score({})))).toBe('');
  });
});
