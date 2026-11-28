// 🗺️ THE MAP FROM ABOVE IS THE GAME'S OWN MAP (admin 2026-11-27, wave 2 part 2). These tests run the preview on real emitted worlds and
// check every claim against the SAME world's own functions: each land and water cell is what heightAt / waterAt / biomeAt / the edge say
// at its centre, each road cell has a point of the network's own centre line inside it where roadAt answers a road, each pond cell is
// water, and the spawn is the world's first player spawn. A preview that cannot be computed says so and is never a picture.
import { describe, it, expect, vi } from 'vitest';
import { generateAthreeMap } from './AthreeMapGenerator';
import { applyMapPlanToFiles, planAthreeMap } from './mapPlanWiring';
import { loadEmittedAthree } from './mapRobotRun';
import { previewMapInWorker, previewMapOnFiles } from './mapPreviewRun';
import { gameWorldSeed, mapCardFor } from './mapPreviewCard';
import { parseMapPreview, parseMapPreviewCard, MAP_CELL } from '../../../lib/mapPreview';

vi.setConfig({ testTimeout: 180000 });

const filesFor = (prompt: string, seed = 1) => {
  const plan = planAthreeMap(prompt);
  const a = applyMapPlanToFiles(generateAthreeMap(undefined, plan.choice).files, plan, plan.choice, { seed, profile: 'open-world' });
  return { plan, files: a.files, data: a.data };
};

/** The world's own classification at a point — written here from the world's functions, independent of the sampler. */
function expected(w: any, x: number, z: number): string {
  const b = w.boundary;
  if (b && b.kind !== 'none' && b.kind !== 'sea' && Math.hypot(x, z) > b.limitAt(Math.atan2(z, x))) return MAP_CELL.edge;
  if (w.waterAt(x, z)) return MAP_CELL.inlandWater;
  const h = w.heightAt(x, z);
  if (h < w.seaLevel) { const d = w.seaLevel - h; return d >= 20 ? MAP_CELL.deepSea : d >= 5 ? MAP_CELL.sea : MAP_CELL.shallowSea; }
  return ({ beach: MAP_CELL.beach, desert: MAP_CELL.desert, forest: MAP_CELL.forest, mountain: MAP_CELL.rock, snow: MAP_CELL.snow, ocean: MAP_CELL.shallowSea } as Record<string, string>)[w.biomeAt(x, z)] ?? MAP_CELL.grass;
}

const CASES: Array<[string, number]> = [
  ['pahaadon se ghira 5 km ka shooter jisme 3 talaab ho', 11],
  ['battle royale game banao', 4],
  ['5 km ka registan shooter', 902],
];

describe('every pixel is the world\'s own answer', () => {
  for (const [prompt, seed] of CASES) {
    it(`"${prompt}" (seed ${seed})`, () => {
      const { files } = filesFor(prompt, seed);
      const r = previewMapOnFiles(files, { seed, profile: 'open-world', size: 64 });
      expect(r.ok, r.ok ? '' : r.error).toBe(true);
      if (!r.ok) return;
      const p = r.preview;
      const A = loadEmittedAthree(files) as any;
      const w = A.createAthreeMap({ seed, profile: 'open-world' }).world;
      expect(p.seed).toBe(seed);
      expect(p.sideMeters).toBe(w.sizeMeters);
      const N = p.width, cell = w.sizeMeters / N, half = w.sizeMeters / 2;
      const centre = (i: number) => -half + (i + 0.5) * cell;
      // Land and water cells: the classification at the centre, every 3rd cell (a few thousand world calls).
      let checked = 0;
      for (let j = 0; j < N; j += 3) for (let i = 0; i < N; i += 3) {
        const c = p.cells[j * N + i];
        if (c === MAP_CELL.road || c === MAP_CELL.pond || c === MAP_CELL.plot) continue;
        expect(c, `cell ${i},${j}`).toBe(expected(w, centre(i), centre(j)));
        checked++;
      }
      expect(checked).toBeGreaterThan(300);
      // Road cells: a point of the network's centre line inside the cell where roadAt answers a road.
      const net = w.roadNetwork();
      const roads = (net.style() !== null ? [net.home()] : net.regionsNear(-half, -half, half, half)).flatMap((g: any) => g.roads);
      const onRoad = new Set<number>();
      for (const rd of roads) for (let k = 1; k < rd.points.length; k++) {
        const a = rd.points[k - 1], b = rd.points[k];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (cell / 2)));
        for (let s = 0; s <= steps; s++) {
          const x = a.x + (b.x - a.x) * (s / steps), z = a.z + (b.z - a.z) * (s / steps);
          const i = Math.floor((x + half) / cell), j = Math.floor((z + half) / cell);
          if (i >= 0 && j >= 0 && i < N && j < N && w.roadAt(x, z)) onRoad.add(j * N + i);
        }
      }
      const roadCells = [...p.cells].map((c, i) => (c === MAP_CELL.road ? i : -1)).filter((i) => i >= 0);
      expect(roadCells.length).toBeGreaterThan(0);
      expect(p.counts.roadCells).toBe(roadCells.length);
      for (const i of roadCells) expect(onRoad.has(i), `road cell ${i} has no road under it`).toBe(true);
      // Pond cells: water there, by the world's own list.
      for (const pd of w.ponds()) {
        const i = Math.floor((pd.x + half) / cell), j = Math.floor((pd.z + half) / cell);
        if (w.waterAt(pd.x, pd.z)) expect(p.cells[j * N + i]).toBe(MAP_CELL.pond);
      }
      expect(p.counts.ponds).toBe(w.ponds().filter((pd: any) => w.waterAt(pd.x, pd.z)).length);
      // The spawn is the world's first player spawn.
      const sp = w.spawnPoints('player', 1)[0];
      expect(p.spawn!.u).toBeCloseTo((sp.x + half) / w.sizeMeters, 6);
      expect(p.spawn!.v).toBeCloseTo((sp.z + half) / w.sizeMeters, 6);
    });
  }

  it('a bounded map with a mountain edge draws the edge where the world puts its limit', () => {
    const { files } = filesFor('pahaadon se ghira 4 km ka island shooter', 3);
    const r = previewMapOnFiles(files, { seed: 3, profile: 'open-world', size: 64 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.preview.mode).toBe('bounded');
      expect(r.preview.boundary).toBe('mountains');
      expect(r.preview.cells).toContain(MAP_CELL.edge);
      expect(r.preview.cells[0]).toBe(MAP_CELL.edge); // a corner is outside the ring
    }
  });

  it('a different seed is a different picture; the same seed is the same picture', () => {
    const { files } = filesFor('battle royale game banao', 1);
    const a = previewMapOnFiles(files, { seed: 5, profile: 'open-world', size: 48 });
    const b = previewMapOnFiles(files, { seed: 5, profile: 'open-world', size: 48 });
    const c = previewMapOnFiles(files, { seed: 6, profile: 'open-world', size: 48 });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) { expect(a.preview.cells).toBe(b.preview.cells); expect(c.preview.cells).not.toBe(a.preview.cells); }
  });
});

describe('🪷 ponds on a loop world (found by the preview): the world no longer dies of recursion', () => {
  it('"3 talaab" on a 5 km loop: heightAt, the roads and the ponds all answer', () => {
    const { files } = filesFor('pahaadon se ghira 5 km ka shooter jisme 3 talaab ho', 1);
    const w = (loadEmittedAthree(files) as any).createAthreeMap({ seed: 1, profile: 'open-world' }).world;
    expect(() => { for (let i = 0; i < 50; i++) w.heightAt(i * 97 - 2400, i * 53 - 2400); }).not.toThrow();
    expect(w.ponds().length).toBe(3);
    expect(w.roadNetwork().home().roads.length).toBeGreaterThan(0);
  });
});

describe('the worker gives the same picture, within a budget, and never a stand-in', () => {
  it('worker and in-thread runs are identical', async () => {
    const { files } = filesFor('5 km ka registan shooter', 902);
    const a = previewMapOnFiles(files, { seed: 902, profile: 'open-world' });
    const b = await previewMapInWorker(files, { seed: 902, profile: 'open-world' });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.preview).toEqual(a.preview);
  });

  it('a run past its budget is stopped and reported, not drawn', async () => {
    const { files } = filesFor('battle royale game banao');
    const r = await previewMapInWorker(files, { seed: 1, profile: 'open-world', budgetMs: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/did not finish within/);
  });

  it('a map too big to measure in time says so at once (it does not burn the budget and time out)', async () => {
    const { files } = filesFor('ek 3D game banao jiska map bahut bada ho');
    const started = Date.now();
    const r = await previewMapInWorker(files, { seed: 1, profile: 'open-world' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^a map 500 km across is too big to measure from above in time \(pictures are drawn for maps up to 120 km\)$/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('a world that cannot be built is a failure with its reason', () => {
    const { files } = filesFor('battle royale game banao');
    const broken = { ...files, 'src/game/athree/index.ts': 'export const createAthreeMap = () => { throw new Error("broken world"); };' };
    const r = previewMapOnFiles(broken, { seed: 1, profile: 'open-world' });
    expect(r).toEqual({ ok: false, error: 'broken world' });
    const { data } = filesFor('battle royale game banao');
    const card = mapCardFor(r, data, 1, { title: 'Your map, from above' });
    expect(card.card.preview).toBeNull();
    expect(card.card.unavailable).toBe('Map preview unavailable: broken world.');
    expect(card.note).toMatch(/could not be drawn/);
    expect(parseMapPreviewCard(card.card)).not.toBeNull();
  });
});

describe('the shapes are checked where they enter', () => {
  it('a grid of the wrong length or with an unknown cell is not a preview', () => {
    const good = { v: 1, width: 8, height: 8, cells: '7'.repeat(64), sideMeters: 1000, mode: 'loop', seed: 1, boundary: 'none', spawn: { u: 0.5, v: 0.5 }, counts: { roadCells: 0, ponds: 0, plots: 0 } };
    expect(parseMapPreview(good)).not.toBeNull();
    expect(parseMapPreview({ ...good, cells: '7'.repeat(63) })).toBeNull();
    expect(parseMapPreview({ ...good, cells: '7'.repeat(63) + 'z' })).toBeNull();
    expect(parseMapPreview({ ...good, spawn: { u: 2, v: 0 } })).toBeNull();
    expect(parseMapPreviewCard({ title: 'x', preview: null })).toBeNull(); // neither a picture nor a reason
  });

  it('the game\'s seed: WORLD.seed from src/game/world.ts wins, else the plan\'s', () => {
    expect(gameWorldSeed("export const WORLD: OpenWorldOptions = {\n  seed: 90551631,\n  regions: [],\n};", 4)).toBe(90551631);
    expect(gameWorldSeed(null, 4)).toBe(4);
    expect(gameWorldSeed('export const OTHER = { seed: 9, };', 4)).toBe(4);
  });
});
