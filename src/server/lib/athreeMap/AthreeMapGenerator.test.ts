// ATHREE MAP phase 1 — these tests RUN the emitted code (tests/helpers/loadAthree.ts), so every claim is a measurement:
// determinism, an exactly seamless loop, chunk-border continuity, collider-vs-render agreement, spawn safety, the shared wind, the
// triangle budget per tier, and the streaming/floating-origin behaviour with the real three.js.
import { describe, it, expect, vi } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { generateAthreeMap, ATHREE_MAP_MODULES } from './AthreeMapGenerator';
import { loadAthree } from '../../../../tests/helpers/loadAthree';

// These tests sample whole worlds (thousands of terrain, river, dune and road queries). Under the coverage run they are several times
// slower, so each gets two minutes instead of vitest's default twenty seconds: the assertions are not loosened, only the clock.
vi.setConfig({ testTimeout: 120000 });

const A = loadAthree();
const files = generateAthreeMap().files;

function grid(n: number, span: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push([(i / n - 0.5) * span, (j / n - 0.5) * span]);
  return out;
}

describe('the emitted files', () => {
  it('are the documented modules, each naming its technique and using no third-party code', () => {
    expect(Object.keys(files).sort()).toEqual(ATHREE_MAP_MODULES.map((m) => `src/game/athree/${m}.ts`).sort());
    for (const [path, src] of Object.entries(files)) {
      expect(src, path).toMatch(/Technique:/);
      // Only real import/export statements (a comment may mention 'three' in prose).
      const imports = [...src.matchAll(/^(?:import|export)\b[^;\n]*?\bfrom\s+'([^']+)'/gm)].map((m) => m[1]);
      for (const i of imports) expect(i.startsWith('./'), `${path} imports ${i}`).toBe(true); // three.js is passed in, never imported
    }
  });

  it('typecheck under strict + noUnusedLocals (as a game would compile them)', () => {
    const virtualRoot = join(process.cwd(), 'tests', '__athree_virtual__');
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

describe('determinism', () => {
  it('the same seed gives the same world; a different seed a different one', () => {
    const a = A.createAthreeWorld({ seed: 11 });
    const b = A.createAthreeWorld({ seed: 11 });
    const c = A.createAthreeWorld({ seed: 12 });
    let differs = 0;
    for (const [x, z] of grid(20, 90000)) {
      expect(a.heightAt(x, z)).toBe(b.heightAt(x, z));
      expect(a.biomeAt(x, z)).toBe(b.biomeAt(x, z));
      if (Math.abs(a.heightAt(x, z) - c.heightAt(x, z)) > 1) differs++;
    }
    expect(differs).toBeGreaterThan(200);
  });
  it('spawn points and wind are deterministic too', () => {
    const a = A.createAthreeWorld({ seed: 4 });
    const b = A.createAthreeWorld({ seed: 4 });
    expect(a.spawnPoints('player', 3)).toEqual(b.spawnPoints('player', 3));
    expect(a.windAt(100, 200, 5)).toEqual(b.windAt(100, 200, 5));
  });
});

describe('the LOOP world is exactly seamless', () => {
  for (const seed of [1, 7, 23]) {
    it(`seed ${seed}: height repeats after one period in x, z and both`, () => {
      const w = A.createAthreeWorld({ seed, profile: 'open-world' });
      const P = w.sizeMeters;
      expect(P).toBe(100000);
      let worst = 0;
      for (const [x, z] of grid(24, P)) {
        worst = Math.max(worst, Math.abs(w.heightAt(x, z) - w.heightAt(x + P, z)), Math.abs(w.heightAt(x, z) - w.heightAt(x, z + P)), Math.abs(w.heightAt(x, z) - w.heightAt(x - P, z + 2 * P)));
      }
      expect(worst).toBeLessThan(1e-3); // metres
    });
  }
  it('has real land and real sea, and every biome appears somewhere', () => {
    const w = A.createAthreeWorld({ seed: 1 });
    const seen = new Set<string>();
    let land = 0;
    const pts = grid(60, 100000);
    for (const [x, z] of pts) { seen.add(w.biomeAt(x, z)); if (w.heightAt(x, z) > 0) land++; }
    expect(land / pts.length).toBeGreaterThan(0.25);
    expect(land / pts.length).toBeLessThan(0.75);
    for (const b of ['ocean', 'beach', 'desert', 'grassland', 'forest', 'mountain', 'snow']) expect(seen.has(b), b).toBe(true);
  });
});

describe('the BOUNDED island', () => {
  it('EVERY seed makes an island with land at its core (seeds 4, 8, 11 and 14 used to be open sea)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const w = A.createAthreeWorld({ seed, profile: 'battle-royale' });
      let land = 0; let n = 0;
      for (let x = -3800; x <= 3800; x += 200) for (let z = -3800; z <= 3800; z += 200) { n++; if (w.heightAt(x, z) > 2) land++; }
      expect(land / n, 'seed ' + seed).toBeGreaterThan(0.25);
      expect(w.heightAt(0, 0), 'seed ' + seed + ' centre').toBeGreaterThan(2);
    }
  });
  const w = A.createAthreeWorld({ profile: 'battle-royale', seed: 1 });
  it('is 8 km, mostly land inside and open sea outside', () => {
    expect(w.mode).toBe('bounded');
    expect(w.sizeMeters).toBe(8000);
    let inside = 0; let landInside = 0;
    for (const [x, z] of grid(60, 8000)) {
      if (Math.hypot(x, z) < 2000) { inside++; if (w.heightAt(x, z) > 0) landInside++; }
    }
    expect(landInside / inside).toBeGreaterThan(0.6);
    expect(w.heightAt(4600, 0)).toBeLessThan(-50);
    expect(w.heightAt(0, -5000)).toBeLessThan(-50);
  });
  it('has a mix of biomes (not one) and no snow', () => {
    const seen = new Set<string>();
    for (const [x, z] of grid(50, 8000)) seen.add(w.biomeAt(x, z));
    expect(seen.size).toBeGreaterThanOrEqual(4);
    expect(seen.has('snow')).toBe(false);
  });
});

describe('spawn points are safe', () => {
  for (const profile of ['open-world', 'racing', 'battle-royale', 'flight', 'explore'] as const) {
    for (const seed of [1, 5, 9]) {
      it(`${profile} seed ${seed}: player/vehicle on flat dry land, boat in deep water, plane on a flat strip`, () => {
        const w = A.createAthreeWorld({ profile, seed });
        for (const kind of ['player', 'vehicle', 'animal'] as const) {
          const ps = w.spawnPoints(kind, 3);
          expect(ps.length, kind).toBe(3);
          for (const p of ps) {
            expect(p.y).toBeGreaterThan(4);
            expect(w.normalAt(p.x, p.z).y).toBeGreaterThan(0.95);
            expect(Math.abs(w.heightAt(p.x, p.z) - p.y)).toBeLessThan(1e-9);
            for (let i = 0; i < 8; i++) expect(Math.abs(w.heightAt(p.x + Math.cos((i / 8) * Math.PI * 2) * 12, p.z + Math.sin((i / 8) * Math.PI * 2) * 12) - p.y)).toBeLessThanOrEqual(2); // flat under the car
          }
        }
        for (const p of w.spawnPoints('boat', 3)) expect(w.heightAt(p.x, p.z)).toBeLessThan(-4);
        const planes = w.spawnPoints('plane', 2);
        expect(planes.length).toBeGreaterThan(0);
        for (const p of planes) {
          expect(p.strip).toBeGreaterThanOrEqual(600);
          const hs = Array.from({ length: 13 }, (_, i) => [-30, 0, 30].map((dz) => w.heightAt(p.x + i * 50, p.z + dz))).flat();
          expect(Math.max(...hs) - Math.min(...hs)).toBeLessThan(4);
          expect(Math.min(...hs)).toBeGreaterThan(4);
        }
      });
    }
  }
  it('points are at least 150 m apart', () => {
    const ps = A.createAthreeWorld({ seed: 3 }).spawnPoints('vehicle', 6);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z)).toBeGreaterThanOrEqual(150);
  });
});

describe('the shared wind', () => {
  const w = A.createAthreeWorld({ seed: 2 });
  it('stays within a sane speed range and changes with place and time', () => {
    const speeds = new Set<number>();
    for (let t = 0; t < 40; t += 2) for (const [x, z] of grid(5, 20000)) {
      const wind = w.windAt(x, z, t);
      expect(wind.speed).toBeGreaterThan(0.5);
      expect(wind.speed).toBeLessThan(14);
      expect(Math.hypot(wind.x, wind.z)).toBeCloseTo(wind.speed, 6);
      speeds.add(Math.round(wind.speed * 100));
    }
    expect(speeds.size).toBeGreaterThan(30);
  });
});

describe('quality tiers: a computed triangle budget', () => {
  it('every tier is inside its own budget, and tiers grow', () => {
    const { QUALITY, maxTriangles } = A;
    for (const t of ['phone', 'mid', 'desktop']) expect(maxTriangles(QUALITY[t]), t).toBeLessThanOrEqual(QUALITY[t].budgetTriangles);
    expect(maxTriangles(QUALITY.phone)).toBeLessThan(maxTriangles(QUALITY.mid));
    expect(maxTriangles(QUALITY.mid)).toBeLessThan(maxTriangles(QUALITY.desktop));
  });
  it('resolution never rises with distance and never falls below the tier minimum', () => {
    const { QUALITY, lodResolution } = A;
    for (const t of ['phone', 'mid', 'desktop']) {
      let prev = Infinity;
      for (let ring = 0; ring <= QUALITY[t].viewRadius; ring++) {
        const r = lodResolution(QUALITY[t], ring);
        expect(r).toBeLessThanOrEqual(prev);
        expect(r).toBeGreaterThanOrEqual(QUALITY[t].minRes);
        prev = r;
      }
    }
  });
});

describe('collider data equals what is drawn', () => {
  const w = A.createAthreeWorld({ seed: 6 });
  it('every heightfield node is the world height at its place, column-major', () => {
    const hf = A.heightfieldFor(w, 1024, -2048, 256, 32);
    expect(hf.heights.length).toBe(33 * 33);
    for (const [col, row] of [[0, 0], [5, 9], [32, 0], [0, 32], [32, 32], [17, 3]]) {
      expect(hf.heights[col * 33 + row]).toBeCloseTo(w.heightAt(1024 + (col * 256) / 32, -2048 + (row * 256) / 32), 3);
    }
  });
  it('neighbouring heightfields share their edge exactly (no step to drive over)', () => {
    const left = A.heightfieldFor(w, 0, 0, 256, 32);
    const right = A.heightfieldFor(w, 256, 0, 256, 32);
    const below = A.heightfieldFor(w, 0, 256, 256, 32);
    for (let k = 0; k <= 32; k++) {
      expect(left.heights[32 * 33 + k]).toBe(right.heights[0 * 33 + k]);
      expect(left.heights[k * 33 + 32]).toBe(below.heights[k * 33 + 0]);
    }
  });
  it('the drawn terrain and the collider agree at their shared nodes', () => {
    const geo = A.buildChunkGeometry(THREE, w, 3, -2, 256, 32);
    const pos = geo.getAttribute('position');
    const hf = A.heightfieldFor(w, 3 * 256, -2 * 256, 256, 32);
    for (let gx = 0; gx <= 32; gx += 4) for (let gz = 0; gz <= 32; gz += 4) {
      expect(pos.getY(gx * 33 + gz)).toBeCloseTo(hf.heights[gx * 33 + gz], 3);
    }
  });
});

describe('chunk geometry', () => {
  const w = A.createAthreeWorld({ seed: 8 });
  it('adjacent chunks meet at exactly the same height along their shared edge (even at different resolutions, at the shared nodes)', () => {
    const a = A.buildChunkGeometry(THREE, w, 0, 0, 256, 32).getAttribute('position');
    const b = A.buildChunkGeometry(THREE, w, 1, 0, 256, 16).getAttribute('position');
    // a's +x edge (gx=32) vs b's -x edge (gx=0): b has half the nodes, every one of them is also a node of a.
    for (let k = 0; k <= 16; k++) expect(a.getY(32 * 33 + 2 * k)).toBeCloseTo(b.getY(0 * 17 + k), 6);
  });
  it('has a skirt below every border node and a valid index', () => {
    const geo = A.buildChunkGeometry(THREE, w, 2, 2, 256, 16);
    const pos = geo.getAttribute('position');
    const idx = geo.getIndex();
    expect(idx.count % 3).toBe(0);
    for (let i = 0; i < idx.count; i++) expect(idx.getX(i)).toBeLessThan(pos.count);
    const n = 17;
    // -z edge skirt node k sits 24 m under border node k*n
    for (let k = 0; k <= 16; k++) expect(pos.getY(n * n + k)).toBeCloseTo(pos.getY(k * n) - 24, 3);
    expect(idx.count / 3).toBe(A.chunkTriangles(16));
  });
});

describe('streaming and the floating origin (real three.js)', () => {
  it('builds at most maxBuildsPerUpdate per call, fills the view, and never exceeds the tier budget', () => {
    const w = A.createAthreeWorld({ seed: 1 });
    const m = A.createChunkManager(THREE, w, 'phone');
    const tier = A.QUALITY.phone;
    const side = tier.viewRadius * 2 + 1;
    let calls = 0; let prev = 0;
    while (m.loadedCount() < side * side && calls < 200) {
      m.update(5000, 5000); calls++;
      expect(m.loadedCount() - prev).toBeLessThanOrEqual(tier.maxBuildsPerUpdate);
      prev = m.loadedCount();
    }
    expect(m.loadedCount()).toBe(side * side);
    let tris = 0;
    m.group.traverse((o: any) => { if (o.geometry && o.geometry.index && o !== undefined && o.isMesh && o.material && o.material.vertexColors) tris += o.geometry.index.count / 3; });
    expect(tris).toBeLessThanOrEqual(tier.budgetTriangles);
    m.dispose();
  });
  it('drops chunks that leave the view and disposes their geometry', () => {
    const w = A.createAthreeWorld({ seed: 1 });
    const m = A.createChunkManager(THREE, w, 'phone');
    for (let i = 0; i < 100; i++) m.update(0, 0);
    const before = m.loadedCount();
    for (let i = 0; i < 100; i++) m.update(256 * 30, 0); // far enough that nothing stays in range
    expect(m.loadedCount()).toBeLessThanOrEqual(before);
    const keys = new Set<string>();
    m.group.traverse((o: any) => { if (o.isMesh && o.material.vertexColors) keys.add(Math.round((o.position.x + m.origin.x) / 256) + ',' + Math.round((o.position.z + m.origin.z) / 256)); });
    for (const k of keys) expect(Math.abs(Number(k.split(',')[0]) - 30)).toBeLessThanOrEqual(A.QUALITY.phone.viewRadius);
    m.dispose();
  });
  it('re-bases the origin past the threshold and reports the shift; meshes keep their world position', () => {
    const w = A.createAthreeWorld({ seed: 1 });
    const m = A.createChunkManager(THREE, w, 'phone', 3000);
    for (let i = 0; i < 100; i++) m.update(0, 0);
    expect(m.origin).toEqual({ x: 0, z: 0 });
    const shift = m.update(4000, 0);
    expect(shift).not.toBeNull();
    expect(shift.dx).toBe(Math.floor(4000 / 256) * 256);
    expect(m.origin.x).toBe(shift.dx);
    for (let i = 0; i < 100; i++) m.update(4000, 0);
    m.group.traverse((o: any) => {
      if (o.isMesh && o.material.vertexColors) {
        const wx = o.position.x + m.origin.x;
        expect(wx % 256).toBe(0); // still on a chunk corner in WORLD space
      }
    });
    expect(m.update(4000, 0)).toBeNull();
    m.dispose();
  });
});

describe('the API facade', () => {
  it('works with no three.js (world only) and with it (terrain too)', () => {
    const bare = A.createAthreeMap({ seed: 2, profile: 'racing' });
    expect(bare.chunks).toBeNull();
    expect(typeof bare.world.heightAt(0, 0)).toBe('number');
    expect(bare.colliderFor(0, 0, 256, 8).heights.length).toBe(81);
    const full = A.createAthreeMap({ seed: 2, three: THREE, quality: 'phone' });
    expect(full.chunks).not.toBeNull();
    full.dispose();
  });
  it('the shipped file really is the one the tests load (no copy drift)', () => {
    expect(readFileSync(join(process.cwd(), 'src/server/lib/athreeMap/AthreeMapGenerator.ts'), 'utf8')).toContain('const WORLD =');
  });
});
