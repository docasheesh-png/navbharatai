// A LATE GROUND EDIT IS REDRAWN (map expansion plan, item 2; maps autopsy D3). levelGround, setLand and addRoad were only right
// before the first map.update(): the terrain chunks and plants already drawn were never drawn again, so a pad laid later stood
// on ground that still showed the old hills (and trees). With the map option lateEdits: true (default OFF), every edit notes the
// rectangle it can change, and the next updates redraw the chunks and plant tiles it touches — a few per update, nearest first,
// within the device tier's budget. With the option left out nothing changes: what is drawn is never redrawn, as before.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-lateedits-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let AM: any; let OW: any; let CH: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  AM = await import(join(DIR, 'src/game/athree/index.ts'));
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const SIZE = 256;
/** Every chunk mesh with its world corner. */
/** A chunk's geometry is an n × n grid then 4n skirt nodes (buildChunkGeometry); the sea, ocean and other meshes are not. */
const gridSide = (o: any): number => {
  const count = o.geometry?.getAttribute('position')?.count ?? 0;
  const n = Math.round(Math.sqrt(4 + count) - 2);
  return o.isMesh && o.geometry.getAttribute('color') && n > 1 && n * n + 4 * n === count ? n : 0;
};
const chunkMeshes = (map: any) => map.chunks.group.children.filter((o: any) => gridSide(o) > 0)
  .map((mesh: any) => ({ mesh, x0: mesh.position.x + map.chunks.origin.x, z0: mesh.position.z + map.chunks.origin.z }));
/** Vertices of the drawn terrain inside a rectangle whose height is not the world's height there. */
function staleInside(map: any, x0: number, z0: number, x1: number, z1: number): number {
  let stale = 0;
  for (const c of chunkMeshes(map)) {
    const pos = c.mesh.geometry.getAttribute('position');
    const n = gridSide(c.mesh);
    for (let i = 0; i < n * n; i++) {                                     // the grid only: skirts hang below on purpose
      const wx = c.x0 + pos.getX(i), wz = c.z0 + pos.getZ(i);
      if (wx < x0 || wx > x1 || wz < z0 || wz > z1) continue;
      const want = map.world.heightAt(wx, wz);
      if (Math.abs(pos.getY(i) - want) > 1e-3) stale++;
    }
  }
  return stale;
}
const settle = (map: any, x: number, z: number, max = 400) => { for (let i = 0; i < max; i++) map.update(x, z, i / 60); };

describe('✏️ late ground edits, Athree map', () => {
  it('lateEdits: true — a pad laid after the map was drawn is drawn level, chunk by chunk within the tier budget', () => {
    const map = AM.createAthreeMap({ seed: 7, profile: 'open-world', quality: 'phone', three: THREE, lateEdits: true, vegetation: false, sky: false });
    settle(map, 0, 0);
    const loaded = map.chunks.loadedCount();
    expect(loaded).toBe(81);                                                         // phone: 9 × 9 chunks
    const before = new Set(chunkMeshes(map).map((c: any) => c.mesh));
    const y = map.world.levelGround(100, 100, 300, 300, 40, 77);
    expect(y).toBe(77);
    expect(staleInside(map, -200, -200, 400, 400)).toBeGreaterThan(0);              // the drawn ground still shows the old hills
    // Each update rebuilds at most the phone tier's one chunk.
    let replaced = 0, updates = 0;
    while (updates < 200) {
      map.update(0, 0, 10 + updates / 60); updates++;
      const now = chunkMeshes(map).map((c: any) => c.mesh);
      const fresh = now.filter((m: any) => !before.has(m)).length;
      expect(fresh - replaced).toBeLessThanOrEqual(1);
      replaced = fresh;
      if (staleInside(map, -200, -200, 400, 400) === 0) break;
    }
    expect(staleInside(map, -200, -200, 400, 400)).toBe(0);
    expect(map.chunks.loadedCount()).toBe(loaded);                                   // nothing leaked, nothing lost
    // Only chunks the edit can touch were drawn again: one far away is the same mesh.
    const far = chunkMeshes(map).find((c: any) => c.x0 <= -900 && c.z0 <= -900);
    expect(far && before.has(far.mesh)).toBe(true);
    map.dispose();
  }, 120_000);

  it('a late setLand and a late addRoad are redrawn too', () => {
    const map = AM.createAthreeMap({ seed: 3, profile: 'open-world', quality: 'phone', three: THREE, lateEdits: true, vegetation: false, sky: false });
    settle(map, 0, 0);
    map.world.setLand(-300, 200, 250, 'mountain');
    map.world.addRoad([{ x: -500, z: -400 }, { x: 500, z: -380 }], 9);
    settle(map, 0, 0, 200);
    expect(staleInside(map, -700, -700, 700, 700)).toBe(0);
    map.dispose();
  }, 120_000);

  it('default (lateEdits left out): nothing drawn is redrawn — the old contract, unchanged', () => {
    const map = AM.createAthreeMap({ seed: 7, profile: 'open-world', quality: 'phone', three: THREE, vegetation: false, sky: false });
    settle(map, 0, 0);
    const before = new Set(chunkMeshes(map).map((c: any) => c.mesh));
    map.world.levelGround(100, 100, 300, 300, 40, 77);
    settle(map, 0, 0, 100);
    expect(chunkMeshes(map).every((c: any) => before.has(c.mesh))).toBe(true);
    expect(staleInside(map, -200, -200, 400, 400)).toBeGreaterThan(0);
    map.dispose();
  }, 120_000);

  it('edits made before the first update cost nothing extra (no chunk is drawn twice)', () => {
    const map = AM.createAthreeMap({ seed: 7, profile: 'open-world', quality: 'phone', three: THREE, lateEdits: true, vegetation: false, sky: false });
    map.world.levelGround(100, 100, 300, 300, 40, 77);
    const seen = new Set<any>();
    let rebuilt = 0;
    for (let i = 0; i < 300; i++) { map.update(0, 0, i / 60); for (const c of chunkMeshes(map)) { if (!seen.has(c.mesh)) { seen.add(c.mesh); rebuilt++; } } }
    expect(rebuilt).toBe(81);                                                       // each chunk built once: the camera never moved
    expect(staleInside(map, -200, -200, 400, 400)).toBe(0);
    map.dispose();
  }, 120_000);

  it('a rectangle that is not finite redraws every loaded chunk', () => {
    const map = AM.createAthreeMap({ seed: 7, profile: 'open-world', quality: 'phone', three: THREE, vegetation: false, sky: false });
    settle(map, 0, 0);
    expect(map.chunks.invalidate(Number.NaN, 0, 0, 0)).toBe(81);
    expect(map.chunks.invalidate(5000, 5000, 5100, 5100)).toBe(0);
    map.dispose();
  }, 120_000);

  it('plants: a late pad is cleared of trees once its tiles are scattered again', () => {
    const map = AM.createAthreeMap({ seed: 7, profile: 'open-world', quality: 'phone', three: THREE, lateEdits: true, sky: false });
    settle(map, 0, 0, 300);
    const treesOn = (x0: number, z0: number, x1: number, z1: number) => {
      let n = 0;
      const g = map.vegetation.group;
      for (const m of g.children) {
        if (!m.isInstancedMesh || m.count === 0 || m.geometry?.getAttribute('aTint')?.count === undefined) continue;
        const a = m.instanceMatrix.array as Float32Array;
        for (let i = 0; i < m.count; i++) {
          const wx = a[i * 16 + 12] + g.position.x + map.chunks.origin.x, wz = a[i * 16 + 14] + g.position.z + map.chunks.origin.z;
          if (wx > x0 && wx < x1 && wz > z0 && wz < z1) n++;
        }
      }
      return n;
    };
    // Find a 120 m square near the camera that has plants now.
    let spot: [number, number] | null = null;
    for (const [x, z] of [[0, 0], [60, 60], [-60, 60], [60, -60], [-60, -60], [120, 0], [0, 120], [-120, 0], [0, -120]]) if (treesOn(x - 60, z - 60, x + 60, z + 60) > 0) { spot = [x, z]; break; }
    expect(spot).not.toBeNull();
    const [sx, sz] = spot!;
    map.world.levelGround(sx, sz, 60, 60, 20, 30);
    settle(map, 0, 0, 120);
    expect(treesOn(sx - 58, sz - 58, sx + 58, sz + 58)).toBe(0);
    map.dispose();
  }, 120_000);
});

describe('✏️ late ground edits, open world (world: { lateEdits: true })', () => {
  const context = () => {
    const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
    return { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
  };
  const walkable = (c: any) => c.scene.children.find((o: any) => o.isMesh && o.material && o.material.visible === false && o.geometry?.parameters?.widthSegments === 32);
  const patchTop = (c: any, world: any) => {
    const g = walkable(c); const pos = g.geometry.getAttribute('position');
    const at = world.playerWorld();
    let best = { d: Infinity, y: 0 };
    for (let i = 0; i < pos.count; i++) { const wx = g.position.x + pos.getX(i) + world.map.chunks.origin.x, wz = g.position.z + pos.getZ(i) + world.map.chunks.origin.z; const d = Math.hypot(wx - at.x, wz - at.z); if (d < best.d) best = { d, y: pos.getY(i) }; }
    return best.y;
  };
  it('a pad laid under the standing player: the walkable ground is sampled again at once', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, lateEdits: true, vegetation: false });
    world.frame(c, 1 / 60);
    const at = world.playerWorld();
    world.map.world.levelGround(at.x, at.z, 60, 60, 20, 123);
    world.frame(c, 1 / 60);
    expect(patchTop(c, world)).toBeCloseTo(123, 3);
    world.dispose();
  }, 120_000);
  it('default: the walkable ground is not sampled again until the player moves (as before)', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, vegetation: false });
    world.frame(c, 1 / 60);
    const at = world.playerWorld();
    const old = patchTop(c, world);
    world.map.world.levelGround(at.x, at.z, 60, 60, 20, 123);
    world.frame(c, 1 / 60);
    expect(patchTop(c, world)).toBe(old);
    world.dispose();
  }, 120_000);
});
