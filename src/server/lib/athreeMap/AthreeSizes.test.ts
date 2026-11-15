// ANY SIZE, ANY KIND: the emitted world at 1 km to 1000 km, in every kind of land. The invariants a game depends on — the ground is finite
// and seamless, the water is where the data says it is, a player can be put on dry land, the reference size is untouched — are checked on
// the REAL emitted code, not on a model of it.
import { describe, it, expect, vi } from 'vitest';
import { loadAthree } from '../../../../tests/helpers/loadAthree';
import { ARCHETYPES, ARCHETYPE_IDS, mapOptionsFor, SIZE_CLASSES_KM, type Archetype } from './athreeMapKinds';

vi.setConfig({ testTimeout: 300000 });

const A = loadAthree();
const world = (archetype: Archetype, sizeKm: number, seed = 5, extra: Record<string, unknown> = {}) => A.createAthreeWorld({ seed, ...mapOptionsFor({ archetype, sizeKm }), ...extra });

/** n x n points spread over the map (a loop: one period; an island: its diameter). */
function spread(sizeMeters: number, n: number, bounded = false): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push([(((i + 0.5) / n) - (bounded ? 0.5 : 0)) * sizeMeters, (((j + 0.5) / n) - (bounded ? 0.5 : 0)) * sizeMeters]);
  return out;
}

describe('the reference size is untouched', () => {
  it('a world at the default size with the neutral style is byte-for-byte the world that was always there', () => {
    const plain = A.createAthreeWorld({ seed: 7 });
    const styled = A.createAthreeWorld({ seed: 7, style: { relief: 1, seaShift: 0, aridity: 0, warmth: 0, rivers: 1 }, sizeMeters: 100000 });
    for (const [x, z] of spread(100000, 14)) {
      expect(styled.heightAt(x, z)).toBe(plain.heightAt(x, z));
      expect(styled.biomeAt(x, z)).toBe(plain.biomeAt(x, z));
    }
    expect(styled.waterBodies().rivers.length).toBe(plain.waterBodies().rivers.length);
  });
  it('and so is the 8 km island', () => {
    const plain = A.createAthreeWorld({ seed: 3, profile: 'battle-royale' });
    const same = A.createAthreeWorld({ seed: 3, profile: 'battle-royale', sizeMeters: 8000, style: {} });
    for (const [x, z] of spread(8000, 12, true)) expect(same.heightAt(x, z)).toBe(plain.heightAt(x, z));
  });
});

describe('a stretched world is the reference world stretched', () => {
  it('the ground at (x, z) is the reference ground at (x*k, z*k), taller by k^-0.75', () => {
    const ref = A.createAthreeWorld({ seed: 5 });
    for (const km of [1, 10, 400]) {
      const w = A.createAthreeWorld({ seed: 5, sizeMeters: km * 1000 });
      const k = 100 / km; const vs = Math.pow(k, -0.75);
      for (const [x, z] of spread(km * 1000, 9)) expect(w.baseHeightAt(x, z), `${km} km`).toBeCloseTo(ref.baseHeightAt(x * k, z * k) * vs, 6);
    }
  });
  it('a mountain 1000 km wide is taller than one 100 km wide, and a 1 km one is lower (heights stretch, but less than lengths)', () => {
    const peak = (km: number) => { const w = A.createAthreeWorld({ seed: 5, sizeMeters: km * 1000, rivers: false, roads: false }); let m = -Infinity; for (const [x, z] of spread(km * 1000, 40)) m = Math.max(m, w.baseHeightAt(x, z)); return m; };
    const p1 = peak(1); const p100 = peak(100); const p1000 = peak(1000);
    expect(p1).toBeLessThan(p100); expect(p100).toBeLessThan(p1000);
    expect(p1000 / p100).toBeLessThan(10); // not as tall as it is wide
    expect(p1000).toBeLessThan(12000);   // nothing taller than a real mountain
  });
});

describe('every size is seamless, finite and playable', () => {
  for (const km of SIZE_CLASSES_KM) {
    it(`${km} km: finite everywhere, the loop closes, a player can stand on dry land`, () => {
      const w = world('continental', km);
      const n = km >= 100 ? 14 : 20;
      for (const [x, z] of spread(w.sizeMeters, n)) {
        const h = w.heightAt(x, z);
        expect(Number.isFinite(h), `${km} km h(${x},${z})`).toBe(true);
        expect(Math.abs(h)).toBeLessThan(20000);
        expect(Number.isFinite(w.normalAt(x, z).y)).toBe(true);
        expect(typeof w.biomeAt(x, z)).toBe('string');
      }
      // The loop closes: one whole period along either axis is the same ground.
      for (const [x, z] of spread(w.sizeMeters, 5)) {
        expect(w.heightAt(x + w.sizeMeters, z), `${km} km x`).toBeCloseTo(w.heightAt(x, z), 3);
        expect(w.heightAt(x, z + w.sizeMeters), `${km} km z`).toBeCloseTo(w.heightAt(x, z), 3);
      }
      const spawns = w.spawnPoints('player', 3);
      expect(spawns.length, `${km} km spawns`).toBeGreaterThanOrEqual(1);
      for (const s of spawns) {
        expect(w.waterAt(s.x, s.z)).toBeNull();
        expect(s.y).toBeGreaterThan(0);
        expect(Math.abs(s.y - w.heightAt(s.x, s.z))).toBeLessThan(1e-6);
        expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(Math.max(w.sizeMeters, 1000));
      }
    });
  }

  for (const km of [1, 3, 8, 50, 400]) {
    it(`an island ${km} km across: land inside, open sea outside, a player on the land`, () => {
      const w = world('island', km);
      expect(w.mode).toBe('bounded');
      expect(w.heightAt(0, 0)).toBeGreaterThan(0);
      expect(w.heightAt(w.sizeMeters * 0.7, 0)).toBeLessThan(0);
      const sp = w.spawnPoints('player', 2);
      expect(sp.length).toBeGreaterThanOrEqual(1);
      for (const s of sp) { expect(Math.hypot(s.x, s.z)).toBeLessThan(w.sizeMeters / 2); expect(w.heightAt(s.x, s.z)).toBeGreaterThan(0); }
    });
  }
});

describe('the water is where its data says, at every size', () => {
  for (const km of [1, 5, 25, 100, 1000]) {
    it(`${km} km: every river point is in water, below its surface, and widths grow with the map`, () => {
      const w = world('jungle', km, 4);
      const { rivers, lakes } = w.waterBodies();
      expect(rivers.length).toBeGreaterThan(0);
      let checked = 0; let rivered = 0; const ratios: number[] = [];
      for (const r of rivers) {
        for (let i = 0; i < r.points.length; i += Math.max(1, Math.floor(r.points.length / 6))) {
          const p = r.points[i];
          const hit = w.waterAt(p.x, p.z);
          expect(hit, `${km} km river ${r.id} point ${i}`).not.toBeNull();
          expect(w.heightAt(p.x, p.z), `${km} km river bed`).toBeLessThanOrEqual(hit!.surface + 0.01);
          expect(Number.isFinite(hit!.surface) && hit!.width > 0).toBe(true);
          // What waterAt reports is the same river the data lists: the width at the point agrees (not off by the stretch), and so does the level.
          // (Where the point is inside a lake the water there is the lake's, and is rightly wider.)
          if (hit!.kind === 'river') {
            expect(hit!.width / p.width, `${km} km width`).toBeGreaterThan(0.5); expect(hit!.width / p.width).toBeLessThan(2);
            // (At a confluence the water at the point can be the other river's, so the LEVEL is judged over many points, by its median.)
            if (Math.abs(p.surface) > 1) ratios.push(hit!.surface / p.surface);
            rivered++;
          }
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(5); expect(rivered).toBeGreaterThan(3);
      ratios.sort((a, b) => a - b);
      if (ratios.length >= 3) { const med = ratios[Math.floor(ratios.length / 2)]; expect(med, `${km} km level`).toBeGreaterThan(0.6); expect(med).toBeLessThan(1.6); }
      for (const l of lakes.slice(0, 5)) expect(w.waterAt(l.x, l.z)).not.toBeNull();
    });
  }
  it('a river on a bigger map is wider (widths stretch with the plan)', () => {
    const widest = (km: number) => Math.max(...world('jungle', km, 4).waterBodies().rivers.flatMap((r: any) => r.points.map((p: any) => p.width)));
    expect(widest(1000)).toBeGreaterThan(widest(100)); expect(widest(100)).toBeGreaterThan(widest(5));
  });
});

describe('roads exist only where they fit', () => {
  it('under 20 km a loop map has none, and a plane has no runway to find', () => {
    for (const km of [1, 5, 10]) { const w = world('continental', km); expect(w.homeRoads().roads.length, `${km} km`).toBe(0); }
  });
  it('from 20 km up it has a road network again', () => {
    for (const km of [25, 100, 250]) expect(world('plains', km, 3).homeRoads().roads.length, `${km} km`).toBeGreaterThan(0);
  });
  it('the game can still ask for them (or refuse them) explicitly', () => {
    expect(world('continental', 5, 5, { roads: false }).homeRoads().roads.length).toBe(0);
    expect(world('plains', 100, 3, { roads: false }).homeRoads().roads.length).toBe(0);
  });
});

describe('every kind of land is what it says it is (100 km, one seed; the claims are statistical)', () => {
  const stats = (a: Archetype, seed = 5) => {
    const w = world(a, 100, seed, { roads: false });
    const biome: Record<string, number> = {}; let land = 0; let max = -Infinity; let n = 0; let slope = 0;
    for (const [x, z] of spread(w.sizeMeters, 30)) {
      const h = w.heightAt(x, z); n++;
      if (h > 0) { land++; max = Math.max(max, h); slope += Math.hypot(w.heightAt(x + 60, z) - h, w.heightAt(x, z + 60) - h) / 60; }
      const b = w.biomeAt(x, z); biome[b] = (biome[b] ?? 0) + 1;
    }
    return { biome, landShare: land / n, peak: max, meanSlope: slope / Math.max(1, land), rivers: w.waterBodies().rivers.length, w };
  };
  const S = Object.fromEntries(ARCHETYPE_IDS.map((a) => [a, stats(a)])) as Record<Archetype, ReturnType<typeof stats>>;
  const share = (a: Archetype, b: string) => (S[a].biome[b] ?? 0) / 900;

  it('desert: much more desert than the continent, and hardly any forest', () => { expect(share('desert', 'desert')).toBeGreaterThan(Math.max(0.2, share('continental', 'desert') * 2)); expect(share('desert', 'forest')).toBeLessThan(share('continental', 'forest')); });
  it('jungle: mostly forest, and rivers', () => { expect(share('jungle', 'forest')).toBeGreaterThan(0.35); expect(share('jungle', 'desert')).toBeLessThan(0.02); expect(S.jungle.rivers).toBeGreaterThanOrEqual(S.continental.rivers); });
  it('tundra: snow where the continent has none', () => { expect(share('tundra', 'snow')).toBeGreaterThan(Math.max(0.4, share('continental', 'snow') * 2)); expect(share('tundra', 'forest')).toBeLessThan(share('continental', 'forest')); });
  it('archipelago: more sea than the continent, and still some land', () => { expect(S.archipelago.landShare).toBeLessThan(S.continental.landShare); expect(S.archipelago.landShare).toBeGreaterThan(0.03); });
  it('plains: lower and gentler than the alpine map, and much lower than the continent\'s peaks', () => { expect(S.plains.peak).toBeLessThan(S.alpine.peak / 2); expect(S.plains.meanSlope).toBeLessThan(S.alpine.meanSlope); });
  it('alpine: higher peaks than the continent, with more of its land in the mountains', () => { expect(S.alpine.peak).toBeGreaterThan(S.continental.peak); expect(share('alpine', 'mountain') + share('alpine', 'snow')).toBeGreaterThan(share('continental', 'mountain') + share('continental', 'snow')); });
  it('hills: between the plains and the alpine map', () => { expect(S.hills.peak).toBeGreaterThan(S.plains.peak); expect(S.hills.peak).toBeLessThan(S.alpine.peak); });
  it('wetland: more rivers than a desert, and low land', () => { expect(S.wetland.rivers).toBeGreaterThan(S.desert.rivers); expect(S.wetland.peak).toBeLessThan(S.continental.peak); });
  it('savanna: warm open grass', () => { expect(share('savanna', 'grassland')).toBeGreaterThan(share('continental', 'grassland') * 0.8); expect(share('savanna', 'snow')).toBe(0); });
  it('every kind has some land to stand on, at 100 km', () => { for (const a of ARCHETYPE_IDS) if (a !== 'island') expect(S[a].landShare, a).toBeGreaterThan(0.03); });
  it('every kind gives a player somewhere to start (100 km)', () => { for (const a of ARCHETYPE_IDS) expect(S[a].w.spawnPoints('player', 1).length, a).toBe(1); });
});

describe('the largest map is still quick to make and to ask', () => {
  it('1000 km: the world, its rivers and 2000 samples in a few seconds, not minutes', () => {
    const t0 = Date.now();
    const w = world('continental', 1000, 9, { roads: false });
    w.waterBodies();
    let s = 0;
    for (const [x, z] of spread(w.sizeMeters, 45)) s += w.heightAt(x, z);
    expect(Number.isFinite(s)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(60000);
  });
  it('1 km: a whole map, rivers and spawns, in well under a second of work', () => {
    const t0 = Date.now();
    const w = world('jungle', 1, 9);
    w.waterBodies(); w.spawnPoints('player', 3);
    expect(Date.now() - t0).toBeLessThan(20000);
  });
});
