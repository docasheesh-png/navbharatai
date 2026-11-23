// A LATE EDIT SAYS WHEN A COLLIDER IS STALE (map expansion plan, #4466 follow-ups). With lateEdits: true a late levelGround,
// setLand or addRoad redraws the terrain chunks and plants, but a physics heightfield the game made earlier with colliderFor
// still held the old heights: a car drove on hills that were no longer drawn. A heightfield now carries the world's edit count
// when it was sampled, and map.colliderStale(hf) is true once an edit overlapping it has happened — the game makes it again.
// The road mesh and the river water are NOT redrawn on purpose: they are built from the road network and the rivers, which no
// pad, land or game road changes, so a redraw would draw the very same triangles (the guard tests below pin that down).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';

const DIR = join(__dirname, `.tmp-latecollider-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let AM: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  AM = await import(join(DIR, 'src/game/athree/index.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const mk = (extra: Record<string, unknown> = {}) => AM.createAthreeMap({ seed: 3, profile: 'open-world', quality: 'phone', three: THREE, vegetation: false, sky: false, ...extra });

describe('✏️ late edits and stored physics heightfields', () => {
  it('colliderStale: false until an edit overlaps the heightfield, true after; an edit far away does not count', () => {
    const map = mk({ lateEdits: true });
    const hf = map.colliderFor(-100, -100, 200, 32);
    expect(typeof hf.edits).toBe('number');
    expect(map.colliderStale(hf)).toBe(false);
    map.world.levelGround(3000, 3000, 50, 50, 20);
    expect(map.colliderStale(hf)).toBe(false);
    map.world.levelGround(0, 0, 20, 20, 10, 55);
    expect(map.colliderStale(hf)).toBe(true);
    const fresh = map.colliderFor(-100, -100, 200, 32);
    expect(map.colliderStale(fresh)).toBe(false);
    // the stale one really held old heights; the fresh one matches the ground now
    const mid = 16 * 33 + 16;
    expect(Math.abs(fresh.heights[mid] - map.world.heightAt(0, 0))).toBeLessThan(1e-3);
    expect(Math.abs(hf.heights[mid] - map.world.heightAt(0, 0))).toBeGreaterThan(1e-3);
    map.dispose();
  }, 120_000);

  it('a late setLand or addRoad over the heightfield makes it stale too', () => {
    const map = mk({ lateEdits: true });
    const a = map.colliderFor(-300, -300, 200, 16);
    const b = map.colliderFor(300, 300, 200, 16);
    map.world.setLand(-200, -200, 60, 'mountain');
    expect(map.colliderStale(a)).toBe(true);
    expect(map.colliderStale(b)).toBe(false);
    map.world.addRoad([{ x: 250, z: 400 }, { x: 550, z: 400 }], 9);
    expect(map.colliderStale(b)).toBe(true);
    map.dispose();
  }, 120_000);

  it('a heightfield without a stamp (made by an older kit) never claims to be stale', () => {
    const map = mk();
    const hf = map.colliderFor(-100, -100, 200, 16);
    map.world.levelGround(0, 0, 20, 20, 10);
    expect(map.colliderStale({ ...hf, edits: undefined })).toBe(false);
    map.dispose();
  }, 120_000);

  it('guard: the road mesh tiles are the same before and after late edits (nothing to redraw)', () => {
    const map = mk();
    const p = map.world.homeRoads().roads.flatMap((r: any) => r.points).find((q: any) => !q.bridge);
    expect(p).toBeTruthy();                                                         // there are roads to compare
    const cx = Math.floor(p.x / 512) * 512 - 256, cz = Math.floor(p.z / 512) * 512 - 256;
    expect(AM.roadsInRect(map.world, cx, cz, cx + 512, cz + 512).triangles).toBeGreaterThan(0);
    const before = AM.roadsInRect(map.world, cx, cz, cx + 512, cz + 512);
    map.world.levelGround(cx + 256, cz + 256, 200, 200, 40, 30);
    map.world.setLand(cx + 100, cz + 100, 150, 'mountain');
    map.world.addRoad([{ x: cx, z: cz + 250 }, { x: cx + 512, z: cz + 260 }], 9);
    const after = AM.roadsInRect(map.world, cx, cz, cx + 512, cz + 512);
    expect(after.triangles).toBe(before.triangles);
    expect(Array.from(after.position)).toEqual(Array.from(before.position));
    expect(Array.from(after.index)).toEqual(Array.from(before.index));
    map.dispose();
  }, 120_000);

  it('guard: the rivers and lakes the water is drawn from do not move with late edits', () => {
    const map = mk();
    const before = JSON.stringify(map.world.waterBodies());
    expect(map.world.waterBodies().rivers.length + map.world.waterBodies().lakes.length).toBeGreaterThan(0);
    map.world.levelGround(0, 0, 200, 200, 40, 30);
    map.world.setLand(100, 100, 150, 'mountain');
    expect(JSON.stringify(map.world.waterBodies())).toBe(before);
    map.dispose();
  }, 120_000);
});
