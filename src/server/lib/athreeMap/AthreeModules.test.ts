// ATHREE MAP — MODULES CHOSEN AT RUN TIME (admin 2026-11-15). The map is made of modules that need nothing from each other, so a game takes
// only what its user asked for. These tests prove: the words a user types pick the right modules; every subset of modules writes only its own
// files, compiles under strict + noUnusedLocals, and RUNS (a world, a map with real three.js, an update, a dispose); the index has members only
// for what was chosen; the instructions describe exactly the build that was made, and their example compiles; and the whole build is still the
// whole build when nothing is chosen.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import ts from 'typescript';
import { join } from 'node:path';
import { loadAthree } from '../../../../tests/helpers/loadAthree';
import { generateAthreeMap, ATHREE_OPTIONAL_MODULES, ATHREE_MAP_MODULES, ATHREE_CORE_MODULES, chooseAthreeModules } from './AthreeMapGenerator';
import { athreeModulesFor } from './athreeMapIntent';

// Each subset is compiled with the real TypeScript compiler, which takes a couple of seconds a time: two minutes for the whole file.
vi.setConfig({ testTimeout: 120000 });

const OPTIONAL = Object.keys(ATHREE_OPTIONAL_MODULES);
const SUBSETS: string[][] = [[], ...OPTIONAL.map((m) => [m]), ['rivers', 'plants'], ['roads', 'vehicles'], ['sea', 'sky'], ...OPTIONAL.map((m) => OPTIONAL.filter((x) => x !== m))];

function typecheck(files: Record<string, string>, extra?: Record<string, string>): string[] {
  const virtualRoot = join(process.cwd(), 'tests', '__athree_virtual_modules__');
  const memory = new Map(Object.entries({ ...files, ...(extra ?? {}) }).map(([p, c]) => [join(virtualRoot, p), c]));
  const host = ts.createCompilerHost({});
  const realRead = host.readFile.bind(host); const realExists = host.fileExists.bind(host); const realDir = host.directoryExists?.bind(host);
  host.readFile = (p) => memory.get(p) ?? realRead(p);
  host.fileExists = (p) => memory.has(p) || realExists(p);
  host.directoryExists = (d) => [...memory.keys()].some((k) => k.startsWith(d)) || (realDir ? realDir(d) : false);
  const program = ts.createProgram([...memory.keys()], {
    strict: true, noUnusedLocals: true, noUnusedParameters: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
  }, host);
  return ts.getPreEmitDiagnostics(program).filter((d) => d.file && memory.has(d.file.fileName)).map((d) => `${d.file!.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

describe('the words a user types choose the modules', () => {
  const pick = (p: string): string[] => athreeModulesFor(p).modules;
  it('a river and some trees is a river and trees, in the build order, nothing else', () => {
    expect(pick('sirf nadi aur ped wala map')).toEqual(['plants', 'rivers']);
    expect(pick('a map with a river, a lake and a forest')).toEqual(['plants', 'rivers']);
    expect(pick('samudra ke kinare jungle')).toEqual(['sea', 'plants']);
  });
  it('racing and cars is roads and vehicles; rain and night is the sky; an island is the sea', () => {
    expect(pick('3D racing game with cars on a big map')).toEqual(['roads', 'vehicles']);
    expect(pick('gaadi aur sadak')).toEqual(['roads', 'vehicles']);
    expect(pick('kohra aur raat ka mausam')).toEqual(['sky']);
    expect(pick('battle royale on an island with rain')).toEqual(['sea', 'sky']);
  });
  it('everything is everything, and so is a request that names no feature, an empty one, and a word that only contains a feature word', () => {
    expect(pick('poora map chahiye')).toEqual(OPTIONAL);
    expect(pick('everything please')).toEqual(OPTIONAL);
    expect(pick('a big open world')).toEqual(OPTIONAL);
    expect(pick('')).toEqual(OPTIONAL);
    expect(pick(undefined as unknown as string)).toEqual(OPTIONAL);
    expect(pick('a carpet shop by the river')).toEqual(['rivers']); // carpet is not car, and a tracker is not a track
    expect(pick('a tracker')).toEqual(OPTIONAL);
  });
  it('gives the reason in words, and never a module that does not exist', () => {
    expect(athreeModulesFor('sirf nadi').reason).toMatch(/rivers \(nadi\)/);
    for (const p of ['car river sky', 'ped', 'sea trees roads vehicles sky rivers']) for (const m of pick(p)) expect(OPTIONAL).toContain(m);
  });
});

describe('choosing modules', () => {
  it('no list means all, an empty list means only the core, unknown names are reported, case and spaces do not matter', () => {
    expect(chooseAthreeModules(undefined)).toEqual({ chosen: OPTIONAL, unknown: [] });
    expect(chooseAthreeModules([])).toEqual({ chosen: [], unknown: [] });
    expect(chooseAthreeModules([' Sea ', 'PLANTS', 'volcano'])).toEqual({ chosen: ['sea', 'plants'], unknown: ['volcano'] });
    expect(chooseAthreeModules(['all'])).toEqual({ chosen: [], unknown: [] });
  });
  it('the whole build is the whole build: every file, with the budget, exactly as before', () => {
    const all = generateAthreeMap();
    expect(Object.keys(all.files).sort()).toEqual(ATHREE_MAP_MODULES.map((m) => `src/game/athree/${m}.ts`).sort());
    expect(Object.keys(generateAthreeMap(OPTIONAL).files).sort()).toEqual(Object.keys(all.files).sort());
    expect(all.instructions).not.toMatch(/Modules NOT in this build/);
  });
});

describe('every subset writes only its own files', () => {
  for (const subset of SUBSETS) {
    it(`[${subset.join(', ') || 'nothing'}]: the core, the files of what was chosen, and no others`, () => {
      const r = generateAthreeMap(subset);
      const names = Object.keys(r.files).map((p) => p.replace('src/game/athree/', '').replace('.ts', ''));
      const expected = new Set<string>(ATHREE_CORE_MODULES);
      for (const m of subset) for (const f of ATHREE_OPTIONAL_MODULES[m].files) expected.add(f);
      if (subset.length === OPTIONAL.length) expected.add('budget');
      expect(names.sort()).toEqual([...expected].sort());
      const index = r.files['src/game/athree/index.ts'];
      for (const m of OPTIONAL) for (const f of ATHREE_OPTIONAL_MODULES[m].files) {
        if (subset.includes(m)) expect(index, `${m}`).toContain(`./${f}'`);
        else expect(index, `${m} must not be imported`).not.toContain(`./${f}'`);
      }
      for (const src of Object.values(r.files)) for (const i of [...src.matchAll(/^(?:import|export)\b[^;\n]*?\bfrom\s+'([^']+)'/gm)].map((x) => x[1])) {
        expect(names, `${i} must be a file of this build`).toContain(i.replace('./', ''));
      }
    });
  }
});

describe('every subset compiles strictly, with the example that comes with it', () => {
  for (const subset of SUBSETS) {
    it(`[${subset.join(', ') || 'nothing'}]`, () => {
      const r = generateAthreeMap(subset);
      const block = /```ts\n([\s\S]*?)```/.exec(r.instructions)![1];
      // three.js ships no types in this repo: the example is checked against a stub that says it is some module.
      expect(typecheck(r.files, { 'src/example.ts': block, 'src/three-stub.d.ts': "declare module 'three';" })).toEqual([]);
    });
  }
});

describe('every subset runs', () => {
  for (const subset of SUBSETS) {
    it(`[${subset.join(', ') || 'nothing'}]: a world, a map with real three.js, ten frames, and dispose`, () => {
      const A = loadAthree(subset);
      const w = A.createAthreeWorld({ seed: 5, profile: 'racing' });
      expect(Number.isFinite(w.heightAt(100, 100))).toBe(true);
      expect(w.spawnPoints('vehicle', 1)).toHaveLength(1);
      expect(typeof w.surfaceAt(100, 100)).toBe('string');
      expect(w.homeRoads().circuit).not.toBeNull();
      const map = A.createAthreeMap({ seed: 5, profile: 'racing', quality: 'phone', three: THREE });
      for (const m of OPTIONAL) {
        const member = ({ sea: 'ocean', plants: 'vegetation', rivers: 'riverWater', sky: 'sky', roads: 'roadMesh' } as Record<string, string>)[m];
        if (!member) continue;
        if (subset.includes(m)) expect(map[member], `${m} present`).not.toBeNull();
        else expect(member in map, `${m} absent`).toBe(false);
      }
      for (let i = 0; i < 10; i++) map.update(100, 100, i * 0.1, 5);
      expect(map.chunks.loadedCount()).toBeGreaterThan(0);
      if (subset.includes('vehicles')) {
        const car = A.createVehicle(THREE, map.world, { kind: 'car', quality: 'phone' });
        car.update(0.1, { throttle: 1, steer: 0, brake: 0, handbrake: false }, map.chunks.origin);
        expect(car.state.speed).toBeGreaterThan(0);
        car.dispose();
      } else expect(A.createVehicle).toBeUndefined();
      map.dispose();
      // Without the sea module the terrain draws its own flat sea, so a map is never seen without water.
      if (!subset.includes('sea')) {
        let flat = false; const m2 = A.createAthreeMap({ seed: 5, quality: 'phone', three: THREE });
        m2.chunks.group.traverse((o: any) => { if (o.isMesh && o.material && o.material.transparent && !o.material.isShaderMaterial) flat = true; });
        expect(flat).toBe(true); m2.dispose();
      }
    });
  }
});

describe('the instructions describe the build that was made', () => {
  it('list what is in and what is not, name the unknown, and tell a game without a sky to bring its own lights', () => {
    const none = generateAthreeMap([]).instructions;
    for (const m of OPTIONAL) expect(none).toContain(`${m} (${ATHREE_OPTIONAL_MODULES[m].what})`);
    expect(none).toMatch(/Modules NOT in this build/);
    expect(none).toMatch(/bring your own lights|add your own lights/);
    const some = generateAthreeMap(['rivers', 'volcano']).instructions;
    expect(some).toMatch(/Unknown module names ignored: volcano/);
    expect(some).toContain('RIVERS:'); expect(some).not.toContain('VEHICLES:'); expect(some).not.toContain('SKY:');
    expect(some).not.toMatch(/map\.vegetation!/); expect(some).not.toMatch(/createVehicle\(THREE/);
    const all = generateAthreeMap().instructions;
    for (const tag of ['SEA:', 'PLANTS:', 'RIVERS:', 'SKY:', 'ROADS DRAWN:', 'VEHICLES:']) expect(all).toContain(tag);
    expect(all).not.toMatch(/add your own lights/);
  });
});
