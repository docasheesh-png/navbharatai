// A RACE THE USER DID NOT DESCRIBE NEVER ENDS (owner 2026-11-18: "racing game me road choti bati hai, aur race bas
// 10-12 second ke baad track khatam ho jata hai … 10-12 road track ko systemically add karo — 1-2-3-…→1-2-3 aise
// cycle me … user ko hamesa infinity ♾️ road dikhe"). See src/server/AgentV3/endlessRaceCourse.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  wantsEndlessRaceCourse, ENDLESS_RACE_COURSE_RULE, raceCourseHalves, raceCourseFinding, endlessRaceCourseNote,
  type RaceCourseHalves,
} from '../src/server/AgentV3/endlessRaceCourse';
import { gameKitHandoffBlock, type GameKitSeedResult } from '../src/server/AgentV3/gameKitSeed';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';

const ROOT = join(__dirname, '..');

describe('which race gets the endless course', () => {
  it.each([
    'Create an racing game',
    'car racing game banao',
    'make a 3D bike racing game',
    'Create an racing game for Nokia c 2-01',
    'a kart racing game on a road',
    'racing game with an endless road',
    'drift racing game with nitro and coins',
  ])('a race that says nothing about its course: %s', (prompt) => {
    expect(wantsEndlessRaceCourse(prompt)).toBe(true);
  });

  it.each([
    'racing game through a desert with a bridge',
    'car race in the city at night',
    'racing game on mountain roads with hairpin bends',
    'race 3 laps around an oval circuit',
    'racing game that ends at a finish line by the river',
    'pahad aur nadi wala racing game',
    'रेगिस्तान में कार रेसिंग गेम',
    'a 5 km drag race',
    'car racing game on a straight road',
    'seedha road racing game',
  ])('a race whose course the user described keeps the user\'s course: %s', (prompt) => {
    expect(wantsEndlessRaceCourse(prompt)).toBe(false);
  });

  it.each(['make a snake game', 'tic tac toe', 'a todo app', '', 'flappy bird'])('not a race: %s', (prompt) => {
    expect(wantsEndlessRaceCourse(prompt)).toBe(false);
  });
});

describe('the kit handoff makes the course mandatory', () => {
  const ok = (recipe: string, content = `Created src/game/${recipe}.ts`): GameKitSeedResult => ({ recipe, ok: true, content });
  const threeD = ['generate_game_runtime', 'generate_game_3d', 'generate_game_vfx', 'generate_melody', 'generate_game_shell'].map((r) => ok(r));

  it('a race with the 3D layer on disk carries the rule, with the exact calls', () => {
    const block = gameKitHandoffBlock(threeD, { endlessRaceCourse: true });
    expect(block).toContain(ENDLESS_RACE_COURSE_RULE);
    expect(block).toMatch(/createTrackStream\(TRACK_PLAN\)/);
    expect(block).toMatch(/src\/game\/<your-game>\/trackPlan\.ts/);
    expect(block).toMatch(/any number of pieces\s+in any order is valid/);
    expect(block).toMatch(/stream\.setPlan\(plan, \{ now: true \}\)/);
    expect(block).toMatch(/stream\.update\(car\)/);
    expect(block).toMatch(/NEVER build the race course with createRoad\(\)/);
  });

  it('never claims the track when the 3D layer is not on disk, and is silent for any other game', () => {
    const no3d = threeD.map((r) => (r.recipe === 'generate_game_3d' ? { ...r, ok: false } : r));
    expect(gameKitHandoffBlock(no3d, { endlessRaceCourse: true })).not.toContain(ENDLESS_RACE_COURSE_RULE);
    expect(gameKitHandoffBlock(threeD, {})).not.toContain(ENDLESS_RACE_COURSE_RULE);
  });

  it('the route decides it from the one reading and tells the dispatcher to check the code', () => {
    const route = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/const endlessRace = gameKitSeeded\.includes\('generate_game_3d'\) && wantsEndlessRaceCourse\(/);
    expect(route).toMatch(/dispatcher\.requireEndlessRaceCourse\(\)/);
    expect(route).toMatch(/gameKitHandoffBlock\(kitResults, \{[^}]*endlessRaceCourse: endlessRace \}\)/);
    expect(route).toMatch(/code: 'RACE_COURSE_ENDLESS'/);
  });
});

describe('the builder\'s code is checked for the endless course', () => {
  const index = (files: Record<string, string>) => {
    const m = new Map<string, RaceCourseHalves>();
    for (const [p, c] of Object.entries(files)) m.set(p, raceCourseHalves(p, c));
    return m;
  };

  it('the real failure: a race on one createRoad() is found, naming the file', () => {
    const f = raceCourseFinding(index({
      'src/game/race/RaceGame.ts': "const road = createRoad({ width: 10 });\nscene.add(road);\nconst car = createCar();\nconst st = createVehicleState();\ndriveVehicle(car, st, input.axis(), dt);",
    }));
    expect(f).toEqual({ finiteRoadFiles: ['src/game/race/RaceGame.ts'] });
    const note = endlessRaceCourseNote(f!);
    expect(note).toMatch(/no file calls createTrackStream\(\)/);
    expect(note).toMatch(/src\/game\/race\/RaceGame\.ts builds the course with createRoad\(\)/);
  });

  it('a race that streams the track, in any file, is fine', () => {
    expect(raceCourseFinding(index({
      'src/game/race/car.ts': 'export const car = createCar(); driveVehicle(car, st, axis, dt);',
      'src/game/race/track.ts': 'export const stream = createTrackStream(DEFAULT_TRACK_PLAN);',
    }))).toBeNull();
  });

  it('kit files, tests and comments never count', () => {
    expect(raceCourseHalves('src/game/RacingRoadGame.tsx', 'createCar(); createTrackStream();').streams).toBe(false);
    expect(raceCourseHalves('src/App.tsx', 'return <RacingRoadGame />').streams).toBe(true);
    expect(raceCourseHalves('src/game/three/objects.ts', 'export function createCar() {} createRoad();').drives).toBe(false);
    expect(raceCourseHalves('src/game/race/race.test.ts', 'createCar(); createRoad();').drives).toBe(false);
    expect(raceCourseHalves('src/game/race/a.ts', '// createTrackStream(DEFAULT_TRACK_PLAN)\ncreateCar();')).toEqual({ drives: true, streams: false, finiteRoad: false });
    expect(raceCourseFinding(index({ 'src/App.tsx': 'export default function App() { return null; }' }))).toBeNull();
  });

  it('the dispatcher runs the check only for that build, once', () => {
    const d = readFileSync(join(ROOT, 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(d).toMatch(/requireEndlessRaceCourse\(\): void \{ this\._endlessRaceCourse = true; \}/);
    expect(d).toMatch(/if \(this\._endlessRaceCourse && !this\._raceCourseNoted\)/);
    expect(d).toMatch(/vehicle \+= endlessRaceCourseNote\(finding\); this\._raceCourseNoted = true;/);
  });
});

describe('the library starts with twelve long maps, while custom plans stay editable', () => {
  const objects = generateGame3D().files['src/game/three/objects.ts'];
  const catalog = objects.slice(objects.indexOf('export const RACING_ROAD_MAPS'), objects.indexOf('export const RACING_ROAD_CHUNK_METRES'));
  it('twelve default map identities with road lengths10–100km, streamed as bounded chunks', () => {
    const entries = [...catalog.matchAll(/id: (\d+), name: '([^']+)', lengthKm: (\d+)/g)];
    expect(entries.map(m => Number(m[1]))).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(new Set(entries.map(m => m[2])).size).toBe(12);
    expect(entries.every(m => Number(m[3]) >= 10 && Number(m[3]) <= 100)).toBe(true);
    expect(objects).toContain('export const DEFAULT_TRACK_PLAN: TrackPlan = createRacingRoadPlan()');
    expect(objects).toContain('RACING_ROAD_CHUNK_METRES = 200');
  });
  it('handoff and generator preserve arbitrary course counts, live edits and user plans', () => {
    const g = generateGame3D();
    expect(ENDLESS_RACE_COURSE_RULE).toContain('createRacingRoadPlan()');
    expect(ENDLESS_RACE_COURSE_RULE).toContain('10–100 km maps');
    expect(g.instructions).toMatch(/Nothing is fixed: any number of pieces, any order/);
    expect(g.instructions).toMatch(/stream\.setPlan\(plan, \{ now: true \}\)/);
    expect(g.instructions).toMatch(/A RACE is never one createRoad\(\)/);
  });
});
