// THE ROBOT CHECKS (admin 2026-11-27, wave 1 part 1). These tests RUN the emitted src/game/athree/mapChecks.ts — on real emitted worlds
// (each check must pass on the maps the planner chooses) and on worlds that are broken on purpose (each check must FAIL and name the
// place: a spawn in a lake, a house on a road, a road graph in two pieces, a prop under the ground, a gap in the boundary). A check
// that cannot fail proves nothing, so every one has its broken world here.
import { describe, it, expect, vi } from 'vitest';
import ts from 'typescript';
import { join } from 'node:path';
import { generateAthreeMap } from './AthreeMapGenerator';
import { MAP_CHECKS } from './athreeMapCheckSource';
import { loadEmittedAthree, runRobotChecksOnFiles, runRobotChecksInWorker, describeRobotRun } from './mapRobotRun';
import { applyMapPlanToFiles, planAthreeMap, MAP_CHECKS_PATH } from './mapPlanWiring';

vi.setConfig({ testTimeout: 120000 });

const filesFor = (prompt: string) => {
  const plan = planAthreeMap(prompt);
  return { plan, files: applyMapPlanToFiles(generateAthreeMap(undefined, plan.choice).files, plan, plan.choice).files };
};
const C = loadEmittedAthree({ [MAP_CHECKS_PATH]: MAP_CHECKS }, 'mapChecks') as any;

/** A world that is fine everywhere unless a test breaks one thing. */
function fakeWorld(over: Record<string, unknown> = {}): any {
  return {
    mode: 'bounded', sizeMeters: 4000, seaLevel: 0,
    heightAt: (x: number, z: number) => (Math.hypot(x, z) > 1900 ? -5 : 10),
    drivableHeightAt: (x: number, z: number) => (Math.hypot(x, z) > 1900 ? -5 : 10),
    waterAt: () => null, roadAt: () => null, gameRoadAt: () => false,
    spawnPoints: (_k: string, n = 1) => Array.from({ length: n }, (_, i) => ({ x: i * 10, y: 10, z: 0, heading: 0 })),
    homeRoads: () => ({ roads: [{ kind: 'highway', from: 0, to: 1 }, { kind: 'highway', from: 1, to: 2 }], sites: [], circuit: null }),
    ...over,
  };
}

describe('the emitted checks compile as a game compiles them', () => {
  it('strict + noUnusedLocals, next to the world they import from', () => {
    const files = filesFor('5 km ka registan shooter').files;
    const virtualRoot = join(process.cwd(), 'tests', '__athree_checks_virtual__');
    const memory = new Map(Object.entries(files).map(([p, c]) => [join(virtualRoot, p), c]));
    const host = ts.createCompilerHost({});
    const realRead = host.readFile.bind(host);
    const realExists = host.fileExists.bind(host);
    host.readFile = (p) => memory.get(p) ?? realRead(p);
    host.fileExists = (p) => memory.has(p) || realExists(p);
    const realDir = host.directoryExists?.bind(host);
    host.directoryExists = (d) => [...memory.keys()].some((k) => k.startsWith(d)) || (realDir ? realDir(d) : false);
    const program = ts.createProgram([...memory.keys()], {
      strict: true, noUnusedLocals: true, noUnusedParameters: true, target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, lib: ['lib.es2020.d.ts'],
    }, host);
    const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file && memory.has(d.file.fileName));
    expect(diags.map((d) => `${d.file!.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)).toEqual([]);
  });
});

describe('every check passes on the real maps the planner chooses', () => {
  for (const [prompt, profile] of [
    ['battle royale game banao', 'battle-royale'], ['athree map par 3D racing game banao', 'racing'], ['5 km ka registan shooter', 'open-world'],
    ['ek chhota island explore game', 'explore'], ['open world game jisme paidal ghoom sakun', 'open-world'],
  ] as const) {
    it(`"${prompt}"`, () => {
      const run = runRobotChecksOnFiles(filesFor(prompt).files, profile);
      expect(run.ran, run.error).toBe(true);
      expect(run.results.filter((r) => !r.ok)).toEqual([]);
      expect(describeRobotRun(run)).toMatch(/every check passed/);
    });
  }
  it('the bounded island\'s boundary really is measured (and closed); a loop world says it has no edge', () => {
    const island = runRobotChecksOnFiles(filesFor('battle royale game banao').files, 'battle-royale');
    expect(island.results.find((r) => r.id === 'boundary-closed')).toMatchObject({ applicable: true, ok: true });
    const loop = runRobotChecksOnFiles(filesFor('5 km ka registan shooter').files, 'open-world');
    expect(loop.results.find((r) => r.id === 'boundary-closed')).toMatchObject({ applicable: false, ok: true });
  });
  it('the default 100 km world\'s highways really are measured and joined', () => {
    const files = applyMapPlanToFiles(generateAthreeMap().files, planAthreeMap('a game'), null).files;
    const run = runRobotChecksOnFiles(files, 'open-world', [1]);
    expect(run.results.find((r) => r.id === 'roads-connected')).toMatchObject({ applicable: true, ok: true });
  });
});

describe('every check FAILS on a world broken on purpose, and names the place', () => {
  it('a spawn in a lake', () => {
    const r = C.checkSpawnDry(fakeWorld({ waterAt: (x: number) => (x === 0 ? { surface: 1 } : null) }), 4);
    expect(r).toMatchObject({ ok: false, applicable: true }); expect(r.detail).toMatch(/in water: player at \(0, 0\)/);
    expect(C.checkSpawnDry(fakeWorld(), 4).ok).toBe(true);
    expect(C.checkSpawnDry(fakeWorld({ spawnPoints: () => [] })).ok).toBe(false); // no spawn at all is a failure, not a pass
  });
  it('a house lot on a road, and one in water', () => {
    const w = fakeWorld({ roadAt: (x: number) => (x > 99 && x < 101 ? { road: 1 } : null), waterAt: (x: number) => (x < -99 ? { surface: 1 } : null) });
    const r = C.checkLotsClear(w, [{ x: 100, z: 0, name: 'house 1' }, { x: -100, z: 0, name: 'house 2' }, { x: 0, z: 0 }]);
    expect(r.ok).toBe(false); expect(r.detail).toMatch(/house 1 at \(100, 0\) is on a road/); expect(r.detail).toMatch(/house 2 at \(-100, 0\) is in water/);
    expect(C.checkLotsClear(w, [{ x: 0, z: 0 }]).ok).toBe(true);
    expect(C.checkLotsClear(w, [])).toMatchObject({ applicable: false, ok: true });
  });
  it('a road graph in two pieces', () => {
    const r = C.checkRoadsConnected(fakeWorld({ homeRoads: () => ({ roads: [{ kind: 'highway', from: 0, to: 1 }, { kind: 'highway', from: 2, to: 3 }], sites: [], circuit: null }) }));
    expect(r).toMatchObject({ ok: false, applicable: true }); expect(r.detail).toMatch(/2 separate pieces/);
    expect(C.checkRoadsConnected(fakeWorld()).ok).toBe(true);
    expect(C.checkRoadsConnected(fakeWorld({ homeRoads: () => ({ roads: [], sites: [], circuit: null }) }))).toMatchObject({ applicable: false });
  });
  it('a prop under the ground, and a height that is not a number', () => {
    const r = C.checkAboveGround(fakeWorld(), [{ x: 5, y: 7, z: 5, name: 'tree' }, { x: 6, y: Number.NaN, z: 6, name: 'rock' }], 2);
    expect(r.ok).toBe(false); expect(r.detail).toMatch(/tree at \(5, 5\) is 3 m under the ground/); expect(r.detail).toMatch(/rock .* has no real height/);
    expect(C.checkAboveGround(fakeWorld(), [{ x: 5, y: 10, z: 5 }], 2).ok).toBe(true);
  });
  it('a gap in the boundary ring', () => {
    const w = fakeWorld({ heightAt: (x: number, z: number) => (Math.hypot(x, z) > 1900 && x < 0 ? -5 : 10) }); // only the west half is sea
    const r = C.checkBoundaryClosed(w, 16);
    expect(r).toMatchObject({ ok: false, applicable: true }); expect(r.detail).toMatch(/open land a player could cross/);
    expect(C.checkBoundaryClosed(w, 16, (x: number) => x >= 0).ok).toBe(true); // the boundary layer's own wall closes it
    expect(C.checkBoundaryClosed(fakeWorld(), 16).ok).toBe(true);
  });
  it('a check that crashes is a failure with its error, never a pass', () => {
    const report = C.runMapChecks(fakeWorld({ homeRoads: () => { throw new Error('region broke'); } }));
    expect(report.ok).toBe(false); expect(report.failed).toEqual(['roads-connected']);
    expect(report.results.find((r: any) => r.id === 'roads-connected').detail).toMatch(/could not run: region broke/);
  });
  it('publishMapChecks leaves the report for the playtest and warns about each failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const report = C.publishMapChecks(fakeWorld({ spawnPoints: () => [] }));
    expect((globalThis as any).__nbMapChecks()).toBe(report);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/\[map check\] spawn-dry/));
    warn.mockRestore(); delete (globalThis as any).__nbMapChecks;
  });
  it('a build-time run that cannot load the map says it could not run, never passed', () => {
    const run = runRobotChecksOnFiles({ 'src/game/athree/index.ts': 'export {};' }, 'open-world');
    expect(run.ran).toBe(false);
    expect(describeRobotRun(run)).toMatch(/could not run .* do not claim the map passed/);
  });
});

describe('the build-time run happens in a worker thread, within a budget', () => {
  it('gives the same verdict as the in-thread run', async () => {
    const files = filesFor('battle royale game banao').files;
    const inWorker = await runRobotChecksInWorker(files, 'battle-royale');
    expect(inWorker.ran, inWorker.error).toBe(true);
    expect(inWorker).toEqual(runRobotChecksOnFiles(files, 'battle-royale'));
  });
  it('a run past its budget is stopped and said as not run, never as passed', async () => {
    const files = filesFor('athree map par 1000 km ka open world').files;
    const run = await runRobotChecksInWorker(files, 'open-world', { budgetMs: 100 });
    expect(run.ran).toBe(false); expect(run.error).toMatch(/did not finish within 0.1 s/);
    expect(describeRobotRun(run)).toMatch(/could not run/);
  });
  it('a broken file set in the worker is reported, not thrown', async () => {
    const run = await runRobotChecksInWorker({ 'src/game/athree/index.ts': 'export {};' }, 'open-world');
    expect(run.ran).toBe(false); expect(run.error).toMatch(/mapChecks|entry point/);
  });
});
