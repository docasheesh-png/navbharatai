/**
 * The ten representative games, played against the REAL generated engines.
 * A pass here is a rules pass. Visual, audio, animation, mobile and performance
 * stay not-verified until a browser playtest measures them, so the release
 * report stays incomplete. That is the point.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateBoardGames } from '../src/server/lib/BoardGamesGenerator';
import { generateGame2D } from '../src/server/lib/Game2DGenerator';
import { generateGameRoyaleFoundation } from '../src/server/lib/GameRoyaleFoundationGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';
import { gameQualityReport } from '../src/server/AgentV3/gameQualityReport';
import { physicsProfileSpec, physicsRuntimeFor } from '../src/server/AgentV3/physicsProfiles';
import { judgeRepresentative, type RepresentativeId, type RuleResult } from '../src/server/AgentV3/representativeRules';

const DIR = join(__dirname, `.tmp-ten-${process.pid}`);
const RACE = join(DIR, 'race');
const WORLD = join(DIR, 'world');
/* eslint-disable @typescript-eslint/no-explicit-any */
const M: Record<string, any> = {};

beforeAll(async () => {
  const files: Record<string, string> = {
    ...generateBoardGames().files,
    ...generateGame2D().files,
    ...generateGameRoyaleFoundation().files,
    ...generateGameSystems(['weapon', 'nav']).files,
    ...generateGameRuntime(['events']).files,
  };
  for (const [p, c] of Object.entries(files)) {
    const f = join(DIR, p);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, c);
  }
  M.chess = await import(join(DIR, 'src/game/board/chess.ts'));
  M.ludo = await import(join(DIR, 'src/game/board/ludo.ts'));
  M.match3 = await import(join(DIR, 'src/game/board/match3.ts'));
  M.football = await import(join(DIR, 'src/game/board/football.ts'));
  M.carrom = await import(join(DIR, 'src/game/board/carrom.ts'));
  M.physics2d = await import(join(DIR, 'src/game/2d/physics.ts'));
  M.tiles = await import(join(DIR, 'src/game/2d/tilemap.ts'));
  M.royale = await import(join(DIR, 'src/game/royale/rules.ts'));
  M.weapon = await import(join(DIR, 'src/game/systems/weapon.ts'));
  M.nav = await import(join(DIR, 'src/game/systems/nav.ts'));
  mkdirSync(RACE, { recursive: true });
  const race = GAME_LIBRARY.find((g) => g.id === 'ring-rally');
  if (!race) throw new Error('ring-rally template missing');
  writeFileSync(join(RACE, 'App.tsx'), materializeGame(race));
  writeFileSync(join(RACE, 'theme.tsx'), 'export default function ThemeToggle() { return null; }\n');
  M.race = await import(join(RACE, 'App.tsx'));
  for (const [p, f] of recipeFilePool()) {
    if (!/^src\/game\//.test(p) || /\.test\.tsx?$/.test(p)) continue;
    mkdirSync(dirname(join(WORLD, p)), { recursive: true });
    writeFileSync(join(WORLD, p), f.content);
  }
  M.world = await import(join(WORLD, 'src/game/athree/world.ts'));
  M.bridge = await import(join(WORLD, OPEN_WORLD_BRIDGE_PATH));
}, 120_000);

afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function playAll(): RuleResult[] {
  const out: RuleResult[] = [];
  const push = (id: RepresentativeId, ok: boolean, evidence: string) => out.push({ id, status: ok ? 'passed' : 'failed', evidence });

  const T = 32;
  const level = ['...........', '...........', 'P..........', '###########'];
  const map = M.tiles.Tilemap.fromRows(level, T);
  const body = M.physics2d.createBody(1.5 * T, 1 * T, 20, 28);
  const player = new M.physics2d.PlatformerController(body);
  for (let i = 0; i < 90; i++) player.step({ x: 0, jumpPressed: false, jumpHeld: false }, map, 1 / 60);
  const landed = player.body.onGround === true;
  const y = player.body.y;
  player.step({ x: 0, jumpPressed: true, jumpHeld: true }, map, 1 / 60);
  push('2d-platformer', landed && player.body.y < y, `landed=${landed} jumpDy=${(y - player.body.y).toFixed(2)}`);

  const gun = new M.weapon.Weapon('pistol');
  const shots: unknown[] = [];
  const barrel = { fire(o: unknown) { shots.push(o); } };
  const muzzle = { x: 0, y: 1, z: 0 };
  const aim = { x: 0, y: 0, z: 1 };
  const fired = gun.update(1, true, muzzle, aim, barrel);
  const during = gun.update(0.01, true, muzzle, aim, barrel);
  push('2d-shooter', fired === 1 && during === 0 && gun.ammo === 11 && shots.length === 1, `fired=${fired} ammo=${gun.ammo} pellets=${shots.length}`);

  const track = M.race.buildTrack();
  let car = { z: 0, x: 0, speed: 0, distance: 0 };
  const still = { left: false, right: false, gas: false, brake: false, tilt: 0 };
  for (let i = 0; i < 40; i++) car = M.race.stepCar(car, { ...still, gas: true }, track, 1 / 30);
  const sped = car.speed;
  let stopped = car;
  for (let i = 0; i < 90; i++) stopped = M.race.stepCar(stopped, { ...still, brake: true }, track, 1 / 30);
  const steered = M.race.stepCar({ z: 0, x: 0, speed: M.race.OPTIONS.maxSpeed / 2, distance: 0 }, { ...still, tilt: 0.8 }, track, 1 / 30);
  push('3d-racing', sped > 0 && stopped.speed === 0 && steered.x > 0, `speed=${sped.toFixed(1)} brake=${stopped.speed} steerX=${steered.x.toFixed(3)}`);

  const match = M.royale.initialMatch();
  const shot = M.royale.fire(match, 0);
  const jammed = M.royale.fire(match, 0);
  const before = match.health;
  M.royale.stepMatch(match, 0.5, 100);
  push('3d-shooter', shot === true && jammed === false && match.bots[0] < 100 && match.health < before, `bot=${match.bots[0]} health=${match.health}`);

  const world = M.world.createAthreeWorld({ seed: 3, profile: 'open-world' });
  const h = world.heightAt(10, -20);
  push('open-world', Number.isFinite(h) && M.bridge != null, `heightAt(10,-20)=${h}`);

  const chess = M.chess;
  let board = chess.createChess();
  let illegal = false;
  try { chess.play(board, 'e5'); } catch { illegal = true; }
  for (const move of ['f3', 'e5', 'g4', 'Qh4']) board = chess.play(board, move);
  push('chess', illegal && chess.status(board) === 'checkmate', `illegalRejected=${illegal} status=${chess.status(board)}`);

  const ludo = M.ludo.createLudo({ players: ['red', 'yellow'] });
  const onOne = M.ludo.legalMoves(ludo, 1);
  const onSix = M.ludo.legalMoves(ludo, 6);
  const stepped = M.ludo.move(ludo, onSix[0], 6);
  push('ludo', onOne.length === 0 && onSix.length === 4 && stepped.state.players[0].tokens[onSix[0]] === 0, `roll1=${onOne.length} roll6=${onSix.length}`);

  let puzzle: any = null;
  let hint: any = null;
  for (let seed = 1; seed <= 30 && !hint; seed++) {
    puzzle = M.match3.createMatch3({ seed, moves: 20, target: 100 });
    hint = M.match3.hint(puzzle);
  }
  const swapped = hint ? M.match3.swapTiles(puzzle, hint[0], hint[1]) : { ok: false };
  const rejected = M.match3.swapTiles(puzzle, { c: 0, r: 0 }, { c: 2, r: 2 });
  push('puzzle', Boolean(hint) && swapped.ok === true && rejected.ok === false, `hint=${Boolean(hint)} swap=${swapped.ok} far=${rejected.ok}`);

  const front = M.weapon.meleeHits({ x: 0, y: 0, z: 0 }, 0, [{ id: 'a', position: { x: 0, y: 0, z: 1 }, radius: 0.4, health: 100 }], 1.8);
  const back = M.weapon.meleeHits({ x: 0, y: 0, z: 0 }, 0, [{ id: 'b', position: { x: 0, y: 0, z: -1 }, radius: 0.4, health: 100 }], 1.8);
  push('fighting', front.length === 1 && back.length === 0, `front=${front.length} back=${back.length}`);

  const discs = [
    { id: 's', kind: 'striker', x: 0, y: 0, vx: 1000, vy: 0, r: M.carrom.STRIKER_RADIUS, pocketed: false },
    { id: 'c', kind: 'white', x: M.carrom.STRIKER_RADIUS + M.carrom.COIN_RADIUS + 1, y: 0, vx: 0, vy: 0, r: M.carrom.COIN_RADIUS, pocketed: false },
  ];
  for (let i = 0; i < 4; i++) M.carrom.stepPhysics(discs, 1 / 240);
  const pitch = M.football.footballLayout({ length: 60, width: 40 });
  const spot = pitch.penaltySpots.away;
  let ball = M.football.kickBall({ x: spot.x, y: M.football.BALL_RADIUS, z: spot.z, vx: 0, vy: 0, vz: 0 }, pitch.goals.away.centre, { power: 0.7 });
  let goal: string | null = null;
  for (let i = 0; i < 360 && !goal; i++) { const stepped = M.football.stepBall(ball, 1 / 60, pitch, 'home'); ball = stepped.ball; goal = stepped.goal; }
  push('physics-sim', discs[1].vx > discs[0].vx && discs[1].vx > 0 && goal === 'home', `striker=${discs[0].vx.toFixed(1)} coin=${discs[1].vx.toFixed(1)} goal=${goal}`);
  return out;
}

describe('physics profiles do not put cannon-es on a 2D game', () => {
  it('racing and platformer are different worlds', () => {
    expect(physicsProfileSpec('racing').friction).toBeGreaterThan(physicsProfileSpec('platformer').friction);
    expect(physicsProfileSpec('none').fixedDt).toBe(0);
    expect(physicsRuntimeFor('platformer', 'canvas-2d')).toBe('2d-kit');
    expect(physicsRuntimeFor('racing', 'three-3d')).toBe('cannon-es');
    expect(physicsRuntimeFor('sports', 'board')).toBe('rules');
  });
});

describe('the ten representative games', () => {
  it('each rules engine was executed, and a missing browser measurement still blocks release', () => {
    const results = playAll();
    const verdict = judgeRepresentative(results);
    expect(verdict.failed, JSON.stringify(results)).toEqual([]);
    expect(verdict.rulesCertified).toBe(true);
    const report = gameQualityReport({
      'functional-gameplay': { status: 'measured', score: 100 },
      controls: { status: 'measured', score: 100 },
      physics: { status: 'measured', score: 100 },
    });
    expect(report.unverified).toEqual(expect.arrayContaining(['visual', 'performance', 'animation', 'audio', 'mobile']));
    expect(report.canRelease).toBe(false);
    expect(report.band).toBe('incomplete');
  });

  it('a critical defect overrides a perfect score, and an unmeasured dimension is not a pass', () => {
    const full = Object.fromEntries(['functional-gameplay', 'controls', 'visual', 'performance', 'physics', 'animation', 'audio', 'mobile', 'progression', 'requirement-coverage'].map((id) => [id, { status: 'measured', score: 96 }]));
    expect(gameQualityReport(full).band).toBe('excellent');
    expect(gameQualityReport(full).canRelease).toBe(true);
    expect(gameQualityReport(full, ['the car never moved']).canRelease).toBe(false);
    expect(gameQualityReport({ ...full, mobile: { status: 'not-verified' } }).band).toBe('incomplete');
    expect(judgeRepresentative([{ id: 'chess', status: 'passed', evidence: '' }]).rulesCertified).toBe(false);
  });
});
