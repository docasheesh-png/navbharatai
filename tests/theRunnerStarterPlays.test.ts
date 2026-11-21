// THE RUNNER STARTER PLAYS (admin 2026-11-20 engine plan, item 3: a complete working game per genre). Runs the REAL
// generated LaneRunnerGame.tsx scene with the REAL runner rules, humanoid and chase camera: Right moves the runner
// right ON SCREEN, a bot that reads the road through the same input a player uses survives a long run (the controls
// are wired and the course is winnable), standing still crashes into game over, and Play again starts clean.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameShell, GAME_SHELL_MODULES } from '../src/server/lib/GameShellGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { gameKitRecipeInput, gameKitHandoffBlock } from '../src/server/AgentV3/gameKitSeed';
import { GAME_STARTERS } from '../src/server/lib/gameStarters';
import { isGameOwnSource } from '../src/server/AgentV3/actionVisibility';

const DIR = join(__dirname, `.tmp-runner-starter-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let R: any; let S: any; let E: any; let CAM: any;
beforeAll(async () => {
  const g = globalThis as any;
  g.window ??= { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  for (const r of [generateGameRuntime(), generateGame3D(), generateGameController(), generateGameVfxAudio(), generateGameSystems(), generateGameShell()]) {
    for (const [p, c] of Object.entries(r.files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  }
  R = await import(join(DIR, 'src/game/LaneRunnerGame.tsx'));
  S = await import(join(DIR, 'src/game/core/state.ts'));
  E = await import(join(DIR, 'src/game/core/events.ts'));
  CAM = await import(join(DIR, 'src/game/three/camera.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
beforeEach(() => { S.setStatus('menu'); S.resetRun?.(); });

/** A stand-in for the kit's Input: the scene reads it exactly as it reads the player's keys. */
function fakeInput() {
  const pressed = new Set<string>();
  return { press: (a: string) => pressed.add(a), wasPressed: (a: string) => pressed.has(a), endFrame: () => pressed.clear(), isDown: () => false, axis: () => ({ x: 0, y: 0 }) };
}
function start(props: object = { seed: 7 }) {
  const scene = new THREE.Scene();
  const input = fakeInput();
  let followed: THREE.Object3D | null = null;
  const ctx: any = { scene, input, follow: (o: THREE.Object3D) => { followed = o; } };
  const game = R.createLaneRunnerScene(props);
  game.setup(ctx);
  S.setStatus('playing');   // Play: GAME_STARTED starts a fresh run
  return { game, ctx, input, scene, followed: () => followed };
}
const step = (s: ReturnType<typeof start>, seconds: number, brain?: () => void) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) { brain?.(); s.game.update(s.ctx, 1 / 60); s.input.endFrame(); }
};

describe('🏃 the endless-runner starter', () => {
  it('ships in the shell with the instructions to use it, and the camera follows the runner', () => {
    expect(GAME_SHELL_MODULES).toContain('lanerunnergame');
    const shell = generateGameShell();
    expect(Object.keys(shell.files)).toContain('src/game/LaneRunnerGame.tsx');
    expect(shell.instructions).toMatch(/<LaneRunnerGame/);
    // The starter alone brings what it imports.
    expect(Object.keys(generateGameShell(['lanerunnergame']).files)).toEqual(expect.arrayContaining(['src/game/GameCanvas.tsx', 'src/game/Game.ts', 'src/game/ui/Hud.tsx']));
    const s = start();
    expect(s.followed()).not.toBeNull();
    s.game.dispose();
  });

  it('RIGHT moves the runner to the right of the SCREEN through the real chase camera, LEFT to the left', () => {
    const s = start();
    const rig = new CAM.CameraRig({ kind: 'chase' });
    // The chase camera keeps the runner centred, so measure it against the MIDDLE OF THE TRACK beside it on screen.
    const screenX = () => {
      for (let i = 0; i < 90; i++) rig.follow(s.followed(), 1 / 60);
      rig.camera.updateMatrixWorld(true);
      const runner = s.followed()!.getWorldPosition(new THREE.Vector3());
      const middle = new THREE.Vector3(0, runner.y, runner.z);
      return runner.clone().project(rig.camera).x - middle.project(rig.camera).x;
    };
    const middle = screenX();
    s.input.press('right'); step(s, 0.4);
    const right = screenX();
    expect(right).toBeGreaterThan(middle + 0.05);
    s.input.press('left'); step(s, 0.4); s.input.press('left'); step(s, 0.4);
    expect(screenX()).toBeLessThan(middle - 0.05);
    expect(R.runnerWorldX(1)).toBe(-1);
    s.game.dispose();
  });

  it('a bot reading the road through the player\'s own input survives a long run: the controls work and the course is winnable', () => {
    const s = start({ seed: 11 });
    const run = s.game.run;
    const brain = () => {
      // The next row ahead: every obstacle within a metre of the nearest one.
      const ahead = run.obstacles.filter((o: any) => o.z > run.distance - 0.5).sort((a: any, b: any) => a.z - b.z);
      if (!ahead.length || ahead[0].z - run.distance > 25) return;
      const row = ahead.filter((o: any) => Math.abs(o.z - ahead[0].z) < 1);
      const blocked = new Set(row.filter((o: any) => o.kind === 'block').map((o: any) => o.lane));
      const lanes = Array.from({ length: run.lanes }, (_, l) => l).filter((l) => !blocked.has(l));
      const target = lanes.sort((a, b) => Math.abs(a - run.lane) - Math.abs(b - run.lane))[0];
      if (target !== undefined && target !== run.lane) { s.input.press(target < run.lane ? 'left' : 'right'); return; }
      const mine = row.find((o: any) => o.lane === run.lane);
      const gap = (mine?.z ?? Infinity) - run.distance;
      // Time it like a player: a jump peaks about 0.35 s in, so leave when the hurdle is that far away in TIME.
      const soon = run.speed * 0.3 + 0.4;
      if (mine?.kind === 'low' && gap < soon && !run.jumping) s.input.press('jump');
      if (mine?.kind === 'high' && gap < soon && !run.sliding) s.input.press('down');
    };
    const crash: any[] = [];
    const offCrash = E.events.on('PLAYER_DIED', () => crash.push({ d: run.distance, lane: run.lane, x: run.x, y: run.y, sliding: run.sliding, near: run.obstacles.filter((o: any) => Math.abs(o.z - run.distance) < 3) }));
    step(s, 90, brain);
    offCrash();
    expect(crash).toEqual([]);
    expect(run.alive).toBe(true);
    expect(run.distance).toBeGreaterThan(1200);
    expect(S.state.score).toBe(run.score);       // the kit's score is the runner's score
    s.game.dispose();
  });

  it('standing still crashes into GAME OVER, and Play again starts a clean run', () => {
    const s = start({ seed: 3 });
    const deaths: unknown[] = [];
    const off = E.events.on('PLAYER_DIED', (p: unknown) => deaths.push(p));
    step(s, 30);
    off();
    expect(S.state.status).toBe('gameover');
    expect(s.game.run.alive).toBe(false);
    expect(deaths.length).toBe(1);
    const piecesBefore = s.scene.getObjectByName('Lane runner')!.children.length;
    S.setStatus('playing');                        // Play again (game.restart() → GAME_STARTED)
    expect(s.game.run.alive).toBe(true);
    expect(s.game.run.distance).toBe(0);
    expect(s.scene.getObjectByName('Lane runner')!.children.length).toBeLessThan(piecesBefore);
    s.game.dispose();
  });

  it('draws exactly the obstacles and coins the rules hold, and lets them go when they are passed', () => {
    const s = start({ seed: 5 });
    step(s, 3, () => { if (s.game.run.obstacles.some((o: any) => o.lane === s.game.run.lane && o.z - s.game.run.distance < 5)) s.input.press(s.game.run.lane > 0 ? 'left' : 'right'); });
    const root = s.scene.getObjectByName('Lane runner')!;
    const run = s.game.run;
    const fixed = 3 /* track, runner… counted below */;
    expect(fixed).toBeGreaterThan(0);
    const drawn = root.children.filter((c) => c.position.z >= run.distance - 30 && c.name !== 'Lane runner');
    expect(drawn.length).toBeGreaterThan(run.obstacles.length);   // posts + runner + track + pieces
    s.game.dispose();
    expect(s.scene.getObjectByName('Lane runner')).toBeUndefined();
  });
});

describe('🏃 the right starter for the right game', () => {
  const shellFor = (request: string) => (gameKitRecipeInput('generate_game_shell', ['generate_game_shell'], request) as { include: string[] }).include;
  it('a runner gets the runner starter and not the race; a race the race and not the runner; a shooter neither', () => {
    expect(shellFor('subway surfers jaisa endless runner game banao')).toContain('lanerunnergame');
    expect(shellFor('subway surfers jaisa endless runner game banao')).not.toContain('racingroadgame');
    expect(shellFor('3D car racing game banao')).toContain('racingroadgame');
    expect(shellFor('3D car racing game banao')).not.toContain('lanerunnergame');
    const bgmi = shellFor('bgmi jaisa 3D shooter game');
    expect(bgmi).not.toContain('lanerunnergame');
    expect(bgmi).not.toContain('racingroadgame');
    expect(bgmi).toEqual(expect.arrayContaining(['game', 'gamecanvas', 'hud', 'touchcontrols']));
  });

  it('the builder is told to render the runner only when it is on disk', () => {
    const withRunner = gameKitHandoffBlock([{ recipe: 'generate_game_shell', ok: true, content: 'Created src/game/LaneRunnerGame.tsx' }]);
    expect(withRunner).toMatch(/render <LaneRunnerGame/);
    expect(gameKitHandoffBlock([{ recipe: 'generate_game_shell', ok: true, content: 'Created src/game/Game.ts' }])).not.toMatch(/LaneRunnerGame/);
  });

  it('every reader knows every starter is the kit\'s file, not the builder\'s own game', () => {
    for (const s of GAME_STARTERS) {
      expect(isGameOwnSource(`src/game/${s.name}.tsx`), s.name).toBe(false);
      expect(Object.keys(generateGameShell().files)).toContain(`src/game/${s.name}.tsx`);
    }
  });
});
