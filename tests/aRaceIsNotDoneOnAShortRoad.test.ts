// A RACE IS NOT "DONE" ON A SHORT ROAD (admin 2026-11-19: "navbharatai par jab koi user game banwata hai, to road/map
// bahut chota sa banta hai"). The write-time note (endlessRaceCourseNote) is said once and could be ignored; the
// end-of-build readiness gate now reads the whole workspace and blocks "done" until the race streams a course.
import { describe, it, expect } from 'vitest';
import { endlessRaceCourseBlocker } from '../src/server/AgentV3/endlessRaceCourse';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import type { ReadinessReport } from '../src/server/AgentV3/Readiness';

const SHORT_ROAD_GAME = `import { createRoad, createCar, driveVehicle } from '../three/objects';
export function setup(scene) { const road = createRoad(); const car = createCar(); scene.add(road, car); }
export function update(car, input, dt) { driveVehicle(car, input, dt); }`;
const STREAMED_GAME = `import { createTrackStream, createCar, driveVehicle } from '../three/objects';
import { TRACK_PLAN } from './trackPlan';
const stream = createTrackStream(TRACK_PLAN);
export function update(car, input, dt) { driveVehicle(car, input, dt); stream.update(car); }`;
const STARTER_GAME = `import RacingRoadGame from '../RacingRoadGame';
export default function App() { return <RacingRoadGame />; }`;
const KIT_FILE = 'export function createRoad() {} export function createTrackStream() {} export function driveVehicle() {}';

describe('the end-of-build blocker', () => {
  it('blocks a race that drives a car on a finite createRoad() course, naming the file and the fix', () => {
    const b = endlessRaceCourseBlocker({ 'src/game/race/scene.ts': SHORT_ROAD_GAME, 'src/game/three/objects.ts': KIT_FILE });
    expect(b).toMatch(/RACE COURSE IS NOT ENDLESS/);
    expect(b).toContain('src/game/race/scene.ts');
    expect(b).toMatch(/RacingRoadGame/);
    expect(b).toMatch(/createTrackStream\(TRACK_PLAN\)/);
  });
  it('passes once any file streams the course: createTrackStream, or the mounted starter', () => {
    expect(endlessRaceCourseBlocker({ 'src/game/race/scene.ts': SHORT_ROAD_GAME, 'src/game/race/stream.ts': STREAMED_GAME })).toBeNull();
    expect(endlessRaceCourseBlocker({ 'src/game/race/scene.ts': SHORT_ROAD_GAME, 'src/App.tsx': STARTER_GAME })).toBeNull();
  });
  it('says nothing about a game that drives nothing, and never reads the kit files as the game', () => {
    expect(endlessRaceCourseBlocker({ 'src/App.tsx': 'export default () => <div>quiz</div>' })).toBeNull();
    expect(endlessRaceCourseBlocker({ 'src/game/three/objects.ts': KIT_FILE + ' createCar(); driveVehicle();' })).toBeNull();
  });
  it('a closed createRoad circuit is not called finite, but a race still needs a streamed course', () => {
    const closed = SHORT_ROAD_GAME.replace('createRoad()', 'createRoad({ closed: true })');
    expect(endlessRaceCourseBlocker({ 'src/game/race/scene.ts': closed })).not.toContain('src/game/race/scene.ts build');
  });
});

class Fake implements ActuatorPort {
  files = new Map<string, string>();
  failRead = false;
  async readFile(_w: string, p: string): Promise<string> { if (this.failRead) throw new Error('EIO'); const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT: ' + p); return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

const READY: ReadinessReport = { score: 100, ready: true, blockers: [], warnings: [], tier: 'production' } as ReadinessReport;
const gate = (d: ToolDispatcher, r: ReadinessReport = READY): Promise<ReadinessReport> =>
  (d as unknown as { _blockIfRaceHasNoEndlessCourse(x: ReadinessReport): Promise<ReadinessReport> })._blockIfRaceHasNoEndlessCourse(r);

function dispatcher(act: Fake): ToolDispatcher {
  const stream = new AgentEventStream();
  return new ToolDispatcher(act, 'ws-race-gate', new WorkspaceState(stream), stream);
}

describe('the readiness gate wiring', () => {
  it('a race the user did not describe, built on a short road, is NOT ready', async () => {
    const act = new Fake(); act.files.set('src/game/race/scene.ts', SHORT_ROAD_GAME);
    const d = dispatcher(act); d.requireEndlessRaceCourse();
    const r = await gate(d);
    expect(r.ready).toBe(false);
    expect(r.blockers.join('\n')).toMatch(/RACE COURSE IS NOT ENDLESS/);
  });
  it('the same game streaming the course is ready, and existing blockers are kept', async () => {
    const act = new Fake(); act.files.set('src/game/race/scene.ts', STREAMED_GAME);
    const d = dispatcher(act); d.requireEndlessRaceCourse();
    expect(await gate(d)).toEqual(READY);
    const prior = { ...READY, ready: false, blockers: ['other'] };
    expect(await gate(d, prior)).toEqual(prior);
  });
  it('only a race that was asked to be endless is checked (a described course, or no race, is never blocked)', async () => {
    const act = new Fake(); act.files.set('src/game/race/scene.ts', SHORT_ROAD_GAME);
    expect(await gate(dispatcher(act))).toEqual(READY);
  });
  it('fails OPEN on its own trouble: an unreadable file is not evidence of a short road', async () => {
    const act = new Fake(); act.files.set('src/game/race/scene.ts', SHORT_ROAD_GAME); act.failRead = true;
    const d = dispatcher(act); d.requireEndlessRaceCourse();
    expect(await gate(d)).toEqual(READY);
  });
  it('the gate is called from assessBuildReadiness (source guard)', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(src).toMatch(/return await this\._blockIfRaceHasNoEndlessCourse\(await this\._blockIfStillTheStarterApp\(report\)\);/);
  });
});
