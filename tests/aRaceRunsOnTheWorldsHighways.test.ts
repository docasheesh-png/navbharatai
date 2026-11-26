// A RACE RUNS ON THE WORLD'S HIGHWAYS (map expansion plan, item 8, part 2 of 3). With TRACK.world = true (and only then —
// the owner's ask-once rule; part 3 sets it after the user's yes) <RacingRoadGame> races on the open world: the car starts
// on the highway out of the first place, the kit's rivals drive the same route, the world streams round the car, and the
// finish is finishKm along the route (or the route's end). Without it the race is the road library, exactly as before.
// Runs the REAL generated kit headless.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { WORLD_COURSE, WORLD_COURSE_PATH, WORLD_RACE, WORLD_RACE_PATH } from '../src/server/lib/GameWorldCourseGenerator';

const DIR = join(__dirname, `.tmp-worldrace-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let WR: any; let CH: any; let OBJ: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  writeFileSync(join(DIR, WORLD_COURSE_PATH), WORLD_COURSE); writeFileSync(join(DIR, WORLD_RACE_PATH), WORLD_RACE);
  WR = await import(join(DIR, WORLD_RACE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  OBJ = await import(join(DIR, 'src/game/three/objects.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const tiny = { blocksX: 2, blocksZ: 2, traffic: { count: 0 }, people: { count: 0 }, parkedCars: 0 };
const make = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500); scene.add(camera);
  const ctx: any = { scene, player, camera, vehicles: { add: () => {}, seated: null } };
  const car = OBJ.createCar({ detail: 'lite' }); scene.add(car);
  return { ctx, car };
};
// Since failedbr #2499 places stand close together unless a distance is named (PLACE_GAP); a race lays its towns a drive apart,
// as the race's own default towns do, so the distances are named here (the ones the old spiral gave these towns).
const regions = [{ id: 'home', kind: 'town', city: tiny }, { id: 'east', kind: 'town', toward: 'east', distance: 600, city: tiny }, { id: 'north', kind: 'town', toward: 'north', distance: 850, city: tiny }];

describe('🏁 a race on the world\'s highways', () => {
  it('the car starts on the route, on the ground; the rivals are on the same route; the finish is finishKm along it', () => {
    const { ctx, car } = make();
    const r = WR.startWorldRace(ctx, { car, regions, opponents: 3, finishKm: 1.2, seed: 7 });
    expect(r.course.length).toBeGreaterThan(1200);
    expect(r.course.finish).toBe(1200);
    const o = r.world.map.chunks.origin;
    expect(Math.abs(car.position.y - r.world.heightAt(car.position.x + o.x, car.position.z + o.z))).toBeLessThan(0.5);
    expect(r.race.rivals.length).toBe(3);
    const st = r.update(ctx, 1 / 60);
    expect(st.totalKm).toBe(1.2);
    r.dispose();
  }, 180_000);

  it('driving along the route: the distance grows with it and the race finishes at the line', () => {
    const { ctx, car } = make();
    const r = WR.startWorldRace(ctx, { car, regions, opponents: 0, finishKm: 1, seed: 7 });
    for (let i = 0; i < 4 * 60; i++) r.update(ctx, 1 / 60);                         // past the countdown
    let last = 0, standing: any = null;
    for (let d = 0; d <= 1010; d += 10) {
      const p = r.course.poseAt(Math.min(d, r.course.length));
      car.position.set(p.x, p.y, p.z); car.rotation.y = p.heading;                    // a car on the road faces along it
      const s = r.update(ctx, 1 / 60); standing = s.standing;
      expect(s.distance).toBeGreaterThanOrEqual(last - 0.5); last = s.distance;
    }
    expect(last).toBeGreaterThan(990);
    expect(standing.phase).toBe('finished');
    r.dispose();
  }, 180_000);

  it('a world with one place has no highway: it says so (the game falls back to the road library)', () => {
    const { ctx, car } = make();
    expect(() => WR.startWorldRace(ctx, { car, regions: [{ id: 'only', kind: 'town', city: tiny }], seed: 7 })).toThrow(/no highway/);
  }, 180_000);

  it('no finishKm (or more than the route): the finish is the route\'s end', () => {
    const { ctx, car } = make();
    const r = WR.startWorldRace(ctx, { car, regions, seed: 7, finishKm: 500 });
    expect(r.course.finish).toBeCloseTo(r.course.length, 3);
    r.dispose();
  }, 180_000);
});

import ts from 'typescript';
import { GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';

describe('🏁 <RacingRoadGame> takes the world race only with TRACK.world, and only when the game has it', () => {
  const shell = GAME_RECIPES.generate_game_shell().files as Record<string, string>;
  const src = shell['src/game/RacingRoadGame.tsx'];
  const custom = shell['src/game/play/raceCustom.ts'];

  it('the world branch is behind trackChoice.world === true and a loaded module; nothing else reaches it', () => {
    expect(src).toMatch(/if \(trackChoice && !trackName && trackChoice\.world === true\) \{/);
    expect(src).toMatch(/begin\(null, mod\)/);
    expect((src.match(/startWorldRace\(/g) ?? []).length).toBe(1);
    expect(src).toMatch(/if \(worldMod && !custom\) \{/);
    // the road library and the user's own track keep their own lines, exactly
    expect(src).toMatch(/race = createRace\(ctx\.scene, \{ stream: stream!, opponents, finishDistance: finishKm != null && finishKm > 0 \? finishKm \* 1000 : null \}\)/);
    expect(src).toMatch(/\} else begin\(null\);/);
  });

  it('a game without play/worldRace.ts never imports it: it is found through import.meta.glob, and a missing one says so and races on the library', () => {
    expect(src).not.toMatch(/from '\.\/play\/worldRace'/);
    expect(custom).toMatch(/import\.meta\.glob\('\.\/worldRace\.ts'\)/);
    expect(src).toMatch(/does not have the world race yet, so it runs on the road library/);
    expect(src).toMatch(/cannot run on the world \(/);
    for (const [, c] of Object.entries(shell)) expect(c).not.toMatch(/from '\.\/worldCourse'|from '\.\/worldLayer'/);
  });

  it('typechecks under strict with and without the world race files (the starter, the course and the world race)', () => {
    const DIR2 = join(__dirname, `.tmp-worldrace-tsc-${process.pid}`);
    const kit: Record<string, string> = Object.assign({}, ...Object.values(GAME_RECIPES).map((g) => g().files));
    const names = new Set<string>();
    const run = (files: Record<string, string>, report: string[]) => {
      rmSync(DIR2, { recursive: true, force: true });
      for (const s of Object.values(files)) for (const m of s.matchAll(/THREE\.([A-Za-z_]\w*)/g)) names.add(m[1]);
      files['vite-glob-shim.d.ts'] = 'interface ImportMeta { glob(pattern: string, options?: unknown): Record<string, any> }\n';
      files['three-shim.d.ts'] = `declare module 'three' {\n${[...names].sort().map((n) => `  export const ${n}: any;\n  export type ${n}<A = any, B = any, C = any, D = any> = any;`).join('\n')}\n}\n`;
      for (const [p, c] of Object.entries(files)) { const f = join(DIR2, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
      const program = ts.createProgram(Object.keys(files).map((p) => join(DIR2, p)), { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], jsx: ts.JsxEmit.ReactJSX, strict: true, isolatedModules: true, allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true, types: [] });
      const wanted = new Set(report.map((p) => join(DIR2, p)));
      return ts.getPreEmitDiagnostics(program).filter((d) => d.file && wanted.has(d.file.fileName)).map((d) => `${d.file!.fileName.replace(DIR2 + '/', '')} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    };
    try {
      expect(run({ ...kit }, ['src/game/RacingRoadGame.tsx'])).toEqual([]);
      expect(run({ ...kit, [WORLD_COURSE_PATH]: WORLD_COURSE, [WORLD_RACE_PATH]: WORLD_RACE }, ['src/game/RacingRoadGame.tsx', WORLD_COURSE_PATH, WORLD_RACE_PATH])).toEqual([]);
    } finally { rmSync(DIR2, { recursive: true, force: true }); }
  }, 120_000);
});
