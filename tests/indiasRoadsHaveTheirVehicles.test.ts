// INDIA'S ROADS HAVE THEIR VEHICLES — and the catalogue points at them (admin 2026-10-05: train the game
// engine item by item, "same intensity").
//
// The object catalogue described an auto-rickshaw, a bus, a truck and a tractor (dimensions, parts, the one
// "tell" that makes each read as itself) but had no builder for any of them, so the model hand-modelled them
// — the box-with-wheels the Phase 2 brief calls a FAIL. They are built now, from side profiles at real size,
// on the SAME wheel and body helpers as the car. These tests measure the generated geometry with real three.
//
// Found while doing it, and fixed in the same change: `big-cat` and `goat` were built as
// `createAnimal({ kind: 'deer' })` — harmless while every animal was one box, wrong the moment the deer got
// antlers (Phase 2). A tiger with antlers. They have their own kinds now. And `house` named no builder
// although createHouse has existed since Phase 1.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { OBJECT_CATALOG } from '../src/server/lib/objectCatalog';

const DIR = join(__dirname, `.tmp-game3d-india-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let O: any;

beforeAll(async () => {
  (globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }) }) };
  for (const r of [generateGame3D(), generateGameRuntime()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  O = await import(join(DIR, 'src/game/three/objects.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).document; });

const meshesOf = (root: THREE.Object3D): THREE.Mesh[] => { const out: THREE.Mesh[] = []; root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
const boxOf = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
const sizeOf = (o: THREE.Object3D) => boxOf(o).getSize(new THREE.Vector3());
const wheelsOf = (g: THREE.Object3D) => g.children.filter((c) => c.name === 'wheel');
/** "2.6 m long, 1.3 m wide, 1.7 m tall" → numbers, from the catalogue's own spec. */
function specDims(id: string): { long: number; wide: number; tall: number } {
  const e = OBJECT_CATALOG.find((x) => x.id === id)!;
  const n = (word: string) => Number(new RegExp(`([\\d.]+) m ${word}`).exec(e.dims)![1]);
  return { long: n('long'), wide: n('wide'), tall: n('tall') };
}

const VEHICLES = [
  { id: 'auto-rickshaw', make: (d: string) => O.createAutoRickshaw({ detail: d }), wheels: 3 },
  { id: 'bus', make: (d: string) => O.createBus({ detail: d }), wheels: 6 },
  { id: 'truck', make: (d: string) => O.createTruck({ detail: d }), wheels: 6 },
  { id: 'tractor', make: (d: string) => O.createTractor({ detail: d }), wheels: 4 },
];

describe('each vehicle is its catalogue spec, built — not a box with wheels', () => {
  for (const v of VEHICLES) {
    it(`${v.id}: the catalogue's own size (±12%), its wheel count, on the ground, an extruded body, cheap to draw`, () => {
      for (const d of ['real', 'lite']) {
        const g = v.make(d);
        const size = sizeOf(g);
        const spec = specDims(v.id);
        expect(size.z / spec.long, 'length').toBeGreaterThan(0.88); expect(size.z / spec.long).toBeLessThan(1.12);
        expect(size.x / spec.wide, 'width').toBeGreaterThan(0.88); expect(size.x / spec.wide).toBeLessThan(1.22); // mirrors stand proud
        expect(size.y / spec.tall, 'height').toBeGreaterThan(0.88); expect(size.y / spec.tall).toBeLessThan(1.12);
        expect(wheelsOf(g)).toHaveLength(v.wheels);
        expect(Math.abs(boxOf(g).min.y), 'tyres touch the road').toBeLessThan(0.02);
        expect(meshesOf(g).some((m) => m.geometry.type === 'ExtrudeGeometry'), 'the body is a profile').toBe(true);
        expect(meshesOf(g).length, 'draw calls').toBeLessThanOrEqual(d === 'real' ? 30 : 24);
      }
      // Its wheels roll, so driveVehicle can drive it.
      const g = v.make('lite');
      const before = wheelsOf(g)[0].rotation.x;
      O.rollWheels(g, 10, 0.1);
      expect(wheelsOf(g)[0].rotation.x).not.toBe(before);
    });
  }
});

describe("each one's TELL — the thing that makes it read as itself", () => {
  it('auto-rickshaw: three wheels, ONE in front on the centre line — and you can see straight through it', () => {
    const g = O.createAutoRickshaw({ detail: 'real' });
    const front = wheelsOf(g).filter((w) => w.position.z > 0);
    expect(front).toHaveLength(1);
    expect(Math.abs(front[0].position.x)).toBeLessThan(0.01);
    // A ray straight across, at a seated passenger's head height between the posts, meets NOTHING.
    g.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(-3, 1.25, 0), new THREE.Vector3(1, 0, 0));
    expect(ray.intersectObject(g, true), 'open sides').toHaveLength(0);
    // …while across a car the same ray hits the body.
    const car = O.createCar({ detail: 'real' });
    car.updateMatrixWorld(true);
    expect(new THREE.Raycaster(new THREE.Vector3(-3, 1.1, 0), new THREE.Vector3(1, 0, 0)).intersectObject(car, true).length).toBeGreaterThan(0);
  });

  it('bus: a window band along most of its length, and its doors on the kerb side (+X, India drives on the left)', () => {
    const g = O.createBus({ detail: 'lite' });
    const glass = meshesOf(g).find((m) => (m.material as THREE.MeshStandardMaterial).color?.getHex() === 0x10151a)!;
    expect(sizeOf(glass).z / sizeOf(g).z).toBeGreaterThan(0.8);
    // The doors are the only glass standing proud of the +X side.
    const pos = glass.geometry.getAttribute('position');
    let maxX = -Infinity, minX = Infinity;
    for (let i = 0; i < pos.count; i++) { maxX = Math.max(maxX, pos.getX(i)); minX = Math.min(minX, pos.getX(i)); }
    expect(maxX).toBeGreaterThan(-minX);
  });

  it('truck: a GAP between the cab and the load body — one continuous box is a bus', () => {
    const g = O.createTruck({ detail: 'lite' });
    const cab = meshesOf(g).find((m) => m.geometry.type === 'ExtrudeGeometry')!;
    const cargo = meshesOf(g).find((m) => (m.material as THREE.MeshStandardMaterial).color?.getHex() === 0xf9a825)!;
    const cabBox = boxOf(cab), cargoBox = boxOf(cargo);
    expect(cabBox.min.z - cargoBox.max.z, 'the gap').toBeGreaterThan(0.1);
    // Doubled rear wheels: two per side behind the cab.
    const rear = wheelsOf(g).filter((w) => w.position.z < 0);
    expect(rear).toHaveLength(4);
  });

  it('tractor: rear wheels nearly twice the front ones — equal wheels make it a truck', () => {
    const g = O.createTractor({ detail: 'lite' });
    const radius = (w: THREE.Object3D) => sizeOf(w).y / 2;
    const rear = wheelsOf(g).filter((w) => w.position.z < 0).map(radius);
    const front = wheelsOf(g).filter((w) => w.position.z > 0).map(radius);
    expect(rear[0] / front[0]).toBeGreaterThan(1.7);
  });
});

describe('the catalogue points at every builder that exists, and never at the wrong animal', () => {
  it('auto, bus, truck, tractor and house name their builders; tiger and goat are not deer', () => {
    const by = (id: string) => OBJECT_CATALOG.find((e) => e.id === id)!.builder ?? '';
    expect(by('auto-rickshaw')).toBe('createAutoRickshaw');
    expect(by('bus')).toBe('createBus');
    expect(by('truck')).toBe('createTruck');
    expect(by('tractor')).toBe('createTractor');
    expect(by('house')).toBe('createHouse');
    expect(by('big-cat')).toContain("kind: 'tiger'");
    expect(by('goat')).toContain("kind: 'goat'");
  });

  it('CENSUS: every export of objects.ts that builds a catalogue object is named by that object', () => {
    // A builder nobody names is a builder the model never uses — the house sat unused this way since Phase 1.
    const src = readFileSync(join(__dirname, '../src/server/lib/Game3DGenerator.ts'), 'utf8');
    const builders = [...src.matchAll(/export function (create[A-Z]\w+)\(/g)].map((m) => m[1]);
    const named = new Set(OBJECT_CATALOG.map((e) => (e.builder ?? '').replace(/\(.*$/s, '').trim()).filter(Boolean));
    // Builders that are not catalogue objects on their own (world-building pieces, the renderer).
    const NOT_OBJECTS = new Set(['createRenderer', 'createTerrain', 'createVehicleState']);
    for (const b of builders) {
      if (NOT_OBJECTS.has(b)) continue;
      expect(named.has(b), `${b} exists but no catalogue entry names it`).toBe(true);
    }
  });

  it('a tiger and a goat have their own anatomy: no antlers, the tiger is striped and long-tailed', () => {
    for (const kind of ['tiger', 'goat']) {
      const a = O.createAnimal({ kind, detail: 'real' });
      const size = sizeOf(a.root);
      expect(size.y).toBeCloseTo(O.ANIMAL_HEIGHT[kind], 2);
      // Antlers are the deer's: its antler material colour must not appear.
      expect(meshesOf(a.root).some((m) => (m.material as THREE.MeshStandardMaterial).color?.getHex() === 0x6b5338)).toBe(false);
    }
    const tiger = O.createAnimal({ kind: 'tiger', detail: 'lite' });
    expect(meshesOf(tiger.root).some((m) => (m.material as THREE.MeshStandardMaterial).color?.getHex() === 0x1a1410 && m.geometry.getAttribute('position').count > 100)).toBe(true);
    const deer = sizeOf(O.createAnimal({ kind: 'deer', detail: 'lite' }).root);
    const t = sizeOf(tiger.root);
    expect(t.z / t.y, 'long and low').toBeGreaterThan((deer.z / deer.y) * 1.8);
  });
});
