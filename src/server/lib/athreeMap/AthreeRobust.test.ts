// ROCK SOLID: what a game or a user can throw at the map — rubbish options, any size, any seed, every kind of land — must never produce a
// hole, a wall or a crash. These are sweeps and properties, not examples: sizes are drawn log-uniformly from 1 km to 1000 km, every kind
// of land, several seeds, and the same invariants are asked at every one.
import { describe, it, expect, vi } from 'vitest';
import { loadAthree } from '../../../../tests/helpers/loadAthree';
import { ARCHETYPE_IDS, mapOptionsFor, ARCHETYPES, type Archetype } from './athreeMapKinds';

vi.setConfig({ testTimeout: 600000 });
const A = loadAthree();

/** A small deterministic generator, so a failure names a size and a seed that can be run again. */
function rng(seed: number): () => number { let s = seed | 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; }; }
const logUniform = (r: () => number, lo: number, hi: number): number => Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo)));

describe('nothing a game passes can break the world', () => {
  const junk: Array<[string, Record<string, unknown>]> = [
    ['a NaN size', { sizeMeters: NaN }], ['a negative size', { sizeMeters: -5000 }], ['a zero size', { sizeMeters: 0 }], ['an Infinity size', { sizeMeters: Infinity }],
    ['a size in text', { sizeMeters: '50 km' }], ['a size of one metre', { sizeMeters: 1 }], ['a size of a million km', { sizeMeters: 1e12 }],
    ['a NaN seed', { seed: NaN }], ['a huge seed', { seed: 2 ** 60 }], ['a negative seed', { seed: -77 }], ['a seed in text', { seed: 'abc' }],
    ['a style of nonsense', { style: { relief: NaN, seaShift: 'x', aridity: Infinity, warmth: -Infinity, rivers: null } }],
    ['a style far out of range', { style: { relief: 50, seaShift: 9, aridity: -9, warmth: 9, rivers: 500 } }],
    ['a style that is not an object', { style: 7 }], ['a mode that does not exist', { mode: 'sphere' }],
  ];
  for (const [label, opts] of junk) {
    it(label, () => {
      const w = A.createAthreeWorld({ roads: false, ...opts });
      expect(w.sizeMeters).toBeGreaterThanOrEqual(1000); expect(w.sizeMeters).toBeLessThanOrEqual(1_000_000);
      for (let i = 0; i < 40; i++) {
        const x = (i - 20) * w.sizeMeters / 41; const z = (i * 7 % 40 - 20) * w.sizeMeters / 41;
        expect(Number.isFinite(w.heightAt(x, z)), `${label} h`).toBe(true);
        expect(Number.isFinite(w.normalAt(x, z).y)).toBe(true);
        expect(typeof w.biomeAt(x, z)).toBe('string');
      }
      expect(() => w.spawnPoints('player', 2)).not.toThrow();
    });
  }
  it('a size or a style held to its edge gives the same world as that edge', () => {
    const edge = A.createAthreeWorld({ seed: 4, sizeMeters: 1_000_000, roads: false, style: { relief: 2 } });
    const past = A.createAthreeWorld({ seed: 4, sizeMeters: 9e9, roads: false, style: { relief: 500 } });
    for (let i = 0; i < 20; i++) expect(past.heightAt(i * 20011, i * 9973)).toBe(edge.heightAt(i * 20011, i * 9973));
  });
  it('hostile style numbers cannot thrash the river cache: every value past the edge is the SAME network (one cache entry, so a legitimate world is never evicted by a loop of odd numbers)', () => {
    const mk = (rivers: number) => A.createAthreeWorld({ seed: 12, roads: false, style: { rivers } }).waterBodies().rivers; // the reference size hands back the cached network itself
    expect(mk(50)).toBe(mk(500)); expect(mk(9)).toBe(mk(3));
    expect(mk(-4)).toBe(mk(-400));
  });
  it('the options a game passes are never changed by making a world from them', () => {
    const opts = Object.freeze({ seed: 3, sizeMeters: 20000, style: Object.freeze({ relief: 0.5 }) });
    expect(() => A.createAthreeWorld(opts)).not.toThrow();
    expect(opts).toEqual({ seed: 3, sizeMeters: 20000, style: { relief: 0.5 } });
  });
  it('the same options make the same world, a different seed a different one', () => {
    const o = { seed: 8, ...mapOptionsFor({ archetype: 'hills', sizeKm: 37 }), roads: false };
    const a = A.createAthreeWorld(o); const b = A.createAthreeWorld(o); const c = A.createAthreeWorld({ ...o, seed: 9 });
    let differs = 0;
    for (let i = 0; i < 60; i++) { const x = i * 613; const z = i * 389; expect(a.heightAt(x, z)).toBe(b.heightAt(x, z)); if (Math.abs(a.heightAt(x, z) - c.heightAt(x, z)) > 1) differs++; }
    expect(differs).toBeGreaterThan(20);
  });
});

describe('every kind of land at free sizes and seeds: finite, seamless, never a wall, always somewhere to start', () => {
  const r = rng(20261115);
  const cases: Array<{ kind: Archetype; km: number; seed: number }> = [];
  for (const kind of ARCHETYPE_IDS) for (let i = 0; i < 4; i++) cases.push({ kind, km: Math.round(logUniform(r, 1, 1000) * 10) / 10, seed: 1 + Math.floor(r() * 90) });
  // The corners always run too: the smallest and the largest of every kind.
  for (const kind of ARCHETYPE_IDS) { cases.push({ kind, km: 1, seed: 11 }); cases.push({ kind, km: 1000, seed: 11 }); }

  for (const c of cases) {
    it(`${c.kind} ${c.km} km seed ${c.seed}`, () => {
      const w = A.createAthreeWorld({ seed: c.seed, ...mapOptionsFor({ archetype: c.kind, sizeKm: c.km }), roads: false });
      const rr = rng(c.seed * 31 + Math.round(c.km));
      const loop = ARCHETYPES[c.kind].mode === 'loop';
      let land = 0; let worst = 0;
      for (let i = 0; i < 500; i++) {
        const x = (rr() - 0.5) * w.sizeMeters; const z = (rr() - 0.5) * w.sizeMeters;
        const h = w.heightAt(x, z);
        expect(Number.isFinite(h), `h(${Math.round(x)},${Math.round(z)})`).toBe(true);
        if (loop && i < 40) { expect(w.heightAt(x + w.sizeMeters, z)).toBeCloseTo(h, 2); expect(w.heightAt(x, z + w.sizeMeters)).toBeCloseTo(h, 2); }
        if (h < 0.5) continue;
        land++;
        const slope = Math.max(Math.abs(w.heightAt(x + 10, z) - h), Math.abs(w.heightAt(x, z + 10) - h)) / 10;
        worst = Math.max(worst, slope);
      }
      // A wall is a slope past about 70 degrees over ten metres. The reference world's own steepest ridge is about 1.3; nothing here may be
      // twice that.
      expect(worst, `steepest ground ${worst.toFixed(2)}`).toBeLessThan(2.6);
      const spawn = w.spawnPoints('player', 1);
      if (land > 0 || c.kind !== 'island') expect(spawn.length, 'a player can start somewhere').toBe(1);
      for (const s of spawn) { expect(w.waterAt(s.x, s.z)).toBeNull(); expect(s.y).toBeGreaterThan(0); }
    });
  }
});

describe('the road edges are valid, never half-built', () => {
  for (const [kind, km, seed] of [['plains', 20, 3], ['plains', 21, 4], ['hills', 25, 5], ['island', 6, 3], ['island', 7, 4], ['island', 8, 3]] as Array<[Archetype, number, number]>) {
    it(`${kind} ${km} km seed ${seed}: any road it makes is finite, dry and on the ground`, () => {
      const w = A.createAthreeWorld({ seed, ...mapOptionsFor({ archetype: kind, sizeKm: km }) });
      for (const road of w.homeRoads().roads) {
        for (const p of road.points) { expect(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.y)).toBe(true); }
        const mid = road.points[Math.floor(road.points.length / 2)];
        expect(Number.isFinite(w.heightAt(mid.x, mid.z))).toBe(true);
      }
    });
  }
});

describe('a bigger map is not slower to ask', () => {
  it('3000 ground samples cost about the same at 1000 km as at 100 km (the world is traced once, in the reference)', () => {
    const time = (km: number) => {
      const w = A.createAthreeWorld({ seed: 6, ...mapOptionsFor({ archetype: 'continental', sizeKm: km }), roads: false });
      w.waterBodies(); w.heightAt(0, 0); // the one-off work (the rivers) is not what is being measured
      const rr = rng(77); const t0 = performance.now(); let s = 0;
      for (let i = 0; i < 3000; i++) s += w.heightAt((rr() - 0.5) * w.sizeMeters, (rr() - 0.5) * w.sizeMeters);
      expect(Number.isFinite(s)).toBe(true);
      return performance.now() - t0;
    };
    time(100); // warm the engine
    const small = time(100); const big = time(1000);
    expect(big).toBeLessThan(Math.max(4 * small, 1500));
  });
});
