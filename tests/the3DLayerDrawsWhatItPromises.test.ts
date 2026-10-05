// THE 3D LAYER, RUN — not read (admin 2026-10-05, the game-graphics upgrade).
//
// The admin forwarded a plan to rebuild game graphics from scratch. Before building anything, the
// existing 3D layer (Game3DGenerator.ts — the library every generated 3D game is told to use) was
// RENDERED in a real browser, used exactly as the builder's prompt instructs. The best case it could
// produce had six defects, every one invisible to the existing tests because those tests only read the
// SOURCE TEXT of the generated files:
//
//   1. the road sat in the ground's plane, so it flickered into black zebra stripes (z-fighting);
//   2. one kerb and one edge line (a `break` after the first side), and that kerb was inside the road;
//   3. the car's wheel arches floated beside the car (offset applied twice) and spun with the wheels;
//   4. merged geometry dropped its UVs, so a brick or plaster house rendered as one flat colour;
//   5. the ground stayed a flat colour after setDetailLevel('real') (the tier lived where world.ts
//      could not read it), and every texture showed its tile edge as a grid (non-wrapping noise);
//   6. a texture's repeat was set on the SHARED cached texture, so the last caller's repeat won for all.
//
// 🔒 THE CLASS: a geometry library verified by grepping its source cannot see geometry. These tests
// EXECUTE the generated modules with real three.js (a devDependency for exactly this) and assert the
// facts a render showed — positions, parents, attributes, materials — so each bug fails here first.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';

const DIR = join(__dirname, `.tmp-game3d-${process.pid}`);

// A canvas that remembers what was drawn, so a texture's pixels can be inspected without a browser.
interface FakeCanvas { width: number; height: number; pixels: Uint8ClampedArray | null; getContext: () => unknown }
function fakeCanvas(): FakeCanvas {
  const c: FakeCanvas = {
    width: 0, height: 0, pixels: null,
    getContext: () => ({
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img: { data: Uint8ClampedArray }) => { c.pixels = img.data; },
    }),
  };
  return c;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let objects: any; let world: any; let surfaces: any; let materials: any;

beforeAll(async () => {
  (globalThis as any).document = { createElement: () => fakeCanvas() };
  for (const r of [generateGame3D(), generateGameRuntime()]) {
    for (const [p, c] of Object.entries(r.files)) {
      const f = join(DIR, p);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, c);
    }
  }
  objects = await import(join(DIR, 'src/game/three/objects.ts'));
  world = await import(join(DIR, 'src/game/three/world.ts'));
  surfaces = await import(join(DIR, 'src/game/three/surfaces.ts'));
  materials = await import(join(DIR, 'src/game/three/materials.ts'));
});
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  delete (globalThis as any).document;
});

const meshesOf = (root: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
};
const worldPos = (o: THREE.Object3D) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };

describe('the road (render: black zebra stripes, one kerb)', () => {
  for (const detail of ['lite', 'real'] as const) {
    it(`${detail}: the asphalt sits ABOVE the ground plane and every marking sits above the asphalt`, () => {
      const road: THREE.Group = objects.createRoad({ detail, length: 100, width: 8 });
      const flat = road.children.filter((c) => (c as THREE.Mesh).geometry instanceof THREE.PlaneGeometry) as THREE.Mesh[];
      const asphalt = flat[0];
      expect(asphalt.position.y).toBeGreaterThanOrEqual(0.02);
      expect(objects.ROAD_SURFACE_Y).toBe(asphalt.position.y);
      for (const m of flat.slice(1)) expect(m.position.y, 'a marking in the asphalt plane z-fights').toBeGreaterThan(asphalt.position.y);
    });
  }

  it('edge lines on BOTH sides; in real, a kerb on both sides, each OUTSIDE the asphalt', () => {
    const W = 8;
    const road: THREE.Group = objects.createRoad({ detail: 'real', length: 100, width: W });
    const lines = road.children.filter((c) => {
      const g = (c as THREE.Mesh).geometry as THREE.PlaneGeometry;
      return g instanceof THREE.PlaneGeometry && g.parameters.width === 0.12;
    });
    expect(lines.map((l) => Math.sign(l.position.x)).sort()).toEqual([-1, 1]);
    const kerbs = road.children.filter((c) => (c as THREE.Mesh).geometry instanceof THREE.BoxGeometry);
    expect(kerbs).toHaveLength(2);
    for (const k of kerbs) expect(Math.abs(k.position.x)).toBeGreaterThan(W / 2);
    expect(kerbs.map((k) => Math.sign(k.position.x)).sort()).toEqual([-1, 1]);
  });
});

describe('the car (render: arches floating beside the car)', () => {
  it('each wheel arch is on the BODY, over its own wheel — and does not turn when the wheels roll', () => {
    const car: THREE.Group = objects.createCar({ detail: 'real' });
    const wheels = car.children.filter((c) => c.name === 'wheel');
    const arches = car.children.filter((c) => c.name === 'wheel-arch');
    expect(wheels).toHaveLength(4);
    expect(arches).toHaveLength(4);
    for (const w of wheels) {
      expect(meshesOf(w).some((m) => m.geometry instanceof THREE.TorusGeometry), 'an arch inside a wheel group spins with it').toBe(false);
    }
    const before = arches.map((a) => a.rotation.toArray().join());
    objects.rollWheels(car, 20, 0.5);
    expect(arches.map((a) => a.rotation.toArray().join())).toEqual(before);
    // Over its wheel: same side, same axle, within a few centimetres of the tyre's outer face.
    for (const a of arches) {
      const pa = worldPos(a);
      const near = wheels.map((w) => worldPos(w)).sort((p, q) => p.distanceTo(pa) - q.distanceTo(pa))[0];
      expect(Math.abs(pa.z - near.z)).toBeLessThan(0.01);
      expect(Math.abs(pa.x - near.x)).toBeLessThan(0.15);
      expect(Math.sign(pa.x)).toBe(Math.sign(near.x));
    }
  });
});

describe('textures (render: flat-colour houses, a grid of tile seams, the wrong grain)', () => {
  it('merged shapes keep their UVs, so a textured material can map onto them', () => {
    for (const g of [world.buildingGeometry(5, 3, 5), world.treeGeometry()] as THREE.BufferGeometry[]) {
      const uv = g.getAttribute('uv');
      expect(uv, 'no uv set → a brick or plaster wall renders as one flat colour').toBeTruthy();
      expect(uv.count).toBe(g.getAttribute('position').count);
    }
  });

  it('every surface TILES: the right edge continues into the left, so repeating it shows no seam', () => {
    for (const kind of ['grass', 'plaster', 'stone', 'soil', 'sand', 'asphalt']) {
      const maps = surfaces.surfaceMaps(kind, { size: 64, seed: 99 });
      const px: Uint8ClampedArray = (maps.map.image as FakeCanvas).pixels!;
      const size = 64;
      const at = (x: number, y: number) => px[(y * size + x) * 4];
      let seam = 0, inner = 0;
      for (let y = 0; y < size; y++) {
        seam += Math.abs(at(size - 1, y) - at(0, y));
        inner += Math.abs(at(31, y) - at(32, y));
      }
      // The wrap step must look like any other step between neighbouring pixels, not like a cliff.
      expect(seam / size, `${kind}: the tile edge is a visible seam`).toBeLessThanOrEqual(Math.max(3, (inner / size) * 3));
    }
  });

  it('a repeat belongs to its material: a later surface of the same kind cannot rescale an earlier one', () => {
    const road = surfaces.surfaceMaterial('asphalt', { repeat: 40 });
    const patch = surfaces.surfaceMaterial('asphalt', { repeat: 4 });
    expect(road.map.repeat.x).toBe(40);
    expect(patch.map.repeat.x).toBe(4);
    expect(road.map.image).toBe(patch.map.image); // …while still sharing the one generated image
  });
});

describe('the ground (render: flat green under textured objects)', () => {
  it('reads the SAME detail tier as the objects — setDetailLevel on objects.ts textures the ground', () => {
    objects.setDetailLevel('real');
    try {
      const t: THREE.Mesh = world.createTerrain({ size: 60, flat: true });
      expect((t.material as THREE.MeshStandardMaterial).map, 'real ground must be textured').toBeTruthy();
    } finally {
      objects.setDetailLevel('lite');
    }
    const lite: THREE.Mesh = world.createTerrain({ size: 60, flat: true });
    expect((lite.material as THREE.MeshStandardMaterial).map).toBeFalsy();
  });

  it('both tiers carry soft patches, without tinting the SHARED ground material everyone else uses', () => {
    for (const detail of ['lite', 'real'] as const) {
      const t: THREE.Mesh = world.createTerrain({ size: 60, detail });
      expect(t.geometry.getAttribute('color')).toBeTruthy();
      expect((t.material as THREE.Material).vertexColors).toBe(true);
    }
    const shared = materials.sharedMaterial('ground', materials.paletteColor('indianVillage', 4));
    expect(shared.vertexColors).toBe(false);
  });
});

describe('a house, not a box (render: every building was a box with a hat)', () => {
  for (const roof of ['flat', 'tiled'] as const) {
    it(`${roof} roof: a door on the front, windows, everything standing on the ground`, () => {
      const h: THREE.Group = objects.createHouse({ detail: 'real', roof, storeys: 2, width: 7, depth: 6, seed: 4 });
      const box = new THREE.Box3().setFromObject(h);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(box.max.y).toBeGreaterThan(6); // two 3 m storeys + roof
      const meshes = meshesOf(h);
      const door = meshes.find((m) => {
        const p = (m.geometry as THREE.BoxGeometry).parameters as { width?: number; height?: number };
        return m.geometry instanceof THREE.BoxGeometry && p.width === 1 && p.height === 2.1;
      });
      expect(door, 'no door').toBeTruthy();
      expect(worldPos(door!).z).toBeGreaterThan(0); // the front faces +Z
      const windows = h.children.filter((c) => c.type === 'Group');
      expect(windows.length).toBeGreaterThanOrEqual(6);
      for (const m of meshes) expect(m.geometry.getAttribute('uv'), 'an untextured part').toBeTruthy();
    });
  }

  it('the flat roof has its parapet and water tank; walls are textured plaster in real, plain colour in lite', () => {
    const real: THREE.Group = objects.createHouse({ detail: 'real', roof: 'flat', seed: 2 });
    expect(meshesOf(real).some((m) => m.geometry instanceof THREE.CylinderGeometry)).toBe(true);
    const wall = meshesOf(real)[0].material as THREE.MeshStandardMaterial;
    expect(wall.map).toBeTruthy();
    const lite: THREE.Group = objects.createHouse({ detail: 'lite', roof: 'flat', seed: 2 });
    expect((meshesOf(lite)[0].material as THREE.MeshStandardMaterial).map).toBeFalsy();
  });
});
