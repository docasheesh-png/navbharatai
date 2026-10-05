// A HERO OBJECT IS NOT A BOX (admin 2026-10-05, game graphics Phase 2).
//
// The admin's bar, verbatim from the brief: "If the player vehicle still looks like a box: FAIL. If the
// human still looks like stacked blocks: FAIL." The benchmark render on main showed exactly that: a car
// made of four stacked boxes, a human of box limbs with a box head and a box of hair, and four animals
// that were one box body, one box head and box legs at four sizes.
//
// So these tests measure the GEOMETRY that the generated app actually runs (the modules are written to
// disk and imported with real three, as in the3DLayerDrawsWhatItPromises.test.ts), not the source text:
//   • the car's body is an extruded side profile with the wheel wells cut out — the body has NO vertex
//     over an axle below the top of the well, and its bonnet sits well below its roof;
//   • the human and every animal contain no box at all, stand on the ground, and reach their height;
//   • no lathed part folds back through itself (a short thick neck once rendered as a flat disc);
//   • the lite tier is genuinely lighter, and small parts are baked so a scene stays cheap to draw.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';

const DIR = join(__dirname, `.tmp-game3d-hero-${process.pid}`);

function fakeCanvas(): unknown {
  return {
    width: 0, height: 0,
    getContext: () => ({
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => undefined,
    }),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let objects: any; let humanoid: any; let surfaces: any;

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
  humanoid = await import(join(DIR, 'src/game/three/humanoid.ts'));
  surfaces = await import(join(DIR, 'src/game/three/surfaces.ts'));
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
const boxOf = (o: THREE.Object3D): THREE.Box3 => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
const triangles = (root: THREE.Object3D): number => meshesOf(root).reduce((n, m) => {
  const g = m.geometry;
  return n + (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}, 0);
/** Every lathed part's profile must run one way along its axis; a profile that turns back is a fold. */
const foldedLathes = (root: THREE.Object3D): number => meshesOf(root).filter((m) => {
  const g = m.geometry as THREE.LatheGeometry;
  if (g.type !== 'LatheGeometry') return false;
  const ys = g.parameters.points.map((p) => p.y);
  const up = ys.every((y, i) => i === 0 || y >= ys[i - 1] - 1e-9);
  const down = ys.every((y, i) => i === 0 || y <= ys[i - 1] + 1e-9);
  return !up && !down;
}).length;

const KINDS = ['dog', 'cow', 'horse', 'deer', 'goat', 'tiger'] as const;

describe('the car is a car, not stacked boxes', () => {
  const bodyOf = (car: THREE.Group): THREE.Mesh => {
    // The body is the biggest painted extrusion — the profile itself.
    const extrusions = meshesOf(car).filter((m) => m.geometry.type === 'ExtrudeGeometry');
    return extrusions.sort((a, b) => boxOf(b).getSize(new THREE.Vector3()).z - boxOf(a).getSize(new THREE.Vector3()).z)[0];
  };

  for (const detail of ['real', 'lite'] as const) {
    it(`${detail}: the body is an extruded side profile with the wheel wells CUT OUT of it`, () => {
      const car: THREE.Group = objects.createCar({ detail });
      const body = bodyOf(car);
      expect(body, 'no extruded body — the car is boxes again').toBeTruthy();
      expect(meshesOf(car).some((m) => m.geometry.type === 'BoxGeometry' && boxOf(m).getSize(new THREE.Vector3()).z > 2),
        'a box as long as the car is a box body').toBe(false);
      // Over each axle, the body starts ABOVE the tyre: the tyre sits in a well, not under a slab.
      const wheels = car.children.filter((c) => c.name === 'wheel');
      expect(wheels).toHaveLength(4);
      const wheelTop = Math.max(...wheels.map((w) => boxOf(w).max.y));
      const pos = body.geometry.getAttribute('position');
      for (const axleZ of new Set(wheels.map((w) => Math.round(w.position.z * 100) / 100))) {
        let lowest = Infinity;
        for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - axleZ) < 0.12) lowest = Math.min(lowest, pos.getY(i));
        expect(lowest, `the body reaches below the tyre top over the axle at z=${axleZ}`).toBeGreaterThan(wheelTop);
      }
    });
  }

  it('the outline steps: a bonnet well below the roof, glass narrower than the body', () => {
    const car: THREE.Group = objects.createCar({ detail: 'real' });
    const body = bodyOf(car);
    const pos = body.geometry.getAttribute('position');
    let bonnetTop = -Infinity;
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > 1.6) bonnetTop = Math.max(bonnetTop, pos.getY(i));
    const roofTop = boxOf(car).max.y;
    expect(roofTop - bonnetTop, 'a flat top is a box').toBeGreaterThan(0.45);
    const glass = meshesOf(car).filter((m) => m.geometry.type === 'ExtrudeGeometry' && m !== body);
    const bodyWidth = boxOf(body).getSize(new THREE.Vector3()).x;
    expect(glass.some((g) => boxOf(g).getSize(new THREE.Vector3()).x < bodyWidth * 0.9), 'the cabin sits on a shoulder').toBe(true);
  });

  it('real proportions, on the ground: ~4.3 m long, ~1.8 m wide, ~1.45 m tall, tyres touching y = 0', () => {
    const size = boxOf(objects.createCar({ detail: 'real' })).getSize(new THREE.Vector3());
    const box = boxOf(objects.createCar({ detail: 'real' }));
    expect(size.z).toBeGreaterThan(4.2); expect(size.z).toBeLessThan(4.6);
    expect(size.x).toBeGreaterThan(1.7); expect(size.x).toBeLessThan(2.1);   // mirrors stand proud
    expect(size.y).toBeGreaterThan(1.35); expect(size.y).toBeLessThan(1.6);
    expect(Math.abs(box.min.y)).toBeLessThan(0.01);
  });
});

describe('the human is a body, not stacked blocks', () => {
  it('has no box anywhere, reaches its height, stands on its feet, and faces +Z', () => {
    for (const H of [1.8, 1.2]) {
      const h = humanoid.createHumanoid({ height: H });
      const parts = meshesOf(h.root);
      expect(parts.filter((m) => m.geometry.type === 'BoxGeometry'), 'a box in the body').toHaveLength(0);
      const box = boxOf(h.root);
      expect(box.max.y / H, 'the crown lands at the height asked for').toBeGreaterThan(0.97);
      expect(box.max.y / H).toBeLessThan(1.03);
      expect(Math.abs(box.min.y), 'the soles are on the ground').toBeLessThan(0.03 * H);
      // The eyes are on the FRONT of the head (+Z), like every model in the library.
      const eyes = meshesOf(h.joints.head).find((m) => (m.material as THREE.MeshStandardMaterial).color.getHex() === 0x1a1410)!;
      expect(eyes, 'the head has eyes').toBeTruthy();
      const skullCentre = boxOf(h.joints.head).getCenter(new THREE.Vector3());
      expect(boxOf(eyes).getCenter(new THREE.Vector3()).z).toBeGreaterThan(skullCentre.z);
    }
  });

  it('keeps every joint the gameplay code drives, and still walks', () => {
    const h = humanoid.createHumanoid();
    expect(Object.keys(h.joints).sort()).toEqual([
      'chest', 'head', 'hips', 'leftElbow', 'leftHip', 'leftKnee', 'leftShoulder',
      'neck', 'rightElbow', 'rightHip', 'rightKnee', 'rightShoulder', 'spine',
    ]);
    h.update(0.3, 2, true);
    expect(h.joints.leftHip.rotation.x).not.toBeCloseTo(h.joints.rightHip.rotation.x, 3);
  });

  it('no lathed limb folds through itself, and parts are baked (a crowd stays cheap to draw)', () => {
    const h = humanoid.createHumanoid();
    expect(foldedLathes(h.root)).toBe(0);
    expect(meshesOf(h.root).length).toBeLessThanOrEqual(18);
  });
});

describe('the animals are animals, each its own', () => {
  for (const kind of KINDS) {
    it(`${kind}: no box, head exactly at its height, hooves or paws on the ground, longer than it is wide`, () => {
      for (const detail of ['real', 'lite'] as const) {
        const a = objects.createAnimal({ kind, detail });
        expect(meshesOf(a.root).filter((m) => m.geometry.type === 'BoxGeometry'), 'a box in the animal').toHaveLength(0);
        const box = boxOf(a.root);
        expect(box.max.y).toBeCloseTo(objects.ANIMAL_HEIGHT[kind], 2);
        expect(Math.abs(box.min.y), 'standing on the ground').toBeLessThan(0.03);
        const size = box.getSize(new THREE.Vector3());
        expect(size.z, 'a quadruped is long, not square').toBeGreaterThan(size.x * 1.5);
        expect(foldedLathes(a.root)).toBe(0);
      }
    });
  }

  it('four kinds are four silhouettes, not one animal at four sizes', () => {
    // Length and width, each over height: the old builder gave every kind the SAME box, so these two
    // ratios were identical for all four and only the scale differed.
    const shape = (kind: string) => {
      const s = boxOf(objects.createAnimal({ kind, detail: 'lite' }).root).getSize(new THREE.Vector3());
      return [s.z / s.y, s.x / s.y];
    };
    const ratios = KINDS.map(shape);
    for (let i = 0; i < ratios.length; i++) {
      for (let j = i + 1; j < ratios.length; j++) {
        const apart = Math.hypot(ratios[i][0] - ratios[j][0], ratios[i][1] - ratios[j][1]);
        expect(apart, `${KINDS[i]} and ${KINDS[j]} have the same outline`).toBeGreaterThan(0.06);
      }
    }
  });
});

describe('the cost stays honest', () => {
  it('every hero object is lighter in lite than in real, and draws in few calls', () => {
    const pairs: Array<[string, (d: 'lite' | 'real') => THREE.Object3D]> = [
      ['car', (d) => objects.createCar({ detail: d })],
      ...KINDS.map((k): [string, (d: 'lite' | 'real') => THREE.Object3D] => [k, (d) => objects.createAnimal({ kind: k, detail: d }).root]),
    ];
    for (const [name, make] of pairs) {
      const lite = make('lite'), real = make('real');
      expect(triangles(lite), `${name}: lite is not lighter`).toBeLessThan(triangles(real));
      expect(meshesOf(real).length, `${name}: too many draw calls`).toBeLessThanOrEqual(28);
      expect(meshesOf(lite).length, `${name}: too many draw calls in lite`).toBeLessThanOrEqual(22);
    }
  });

  it('the one shared merge applies a posed part\'s transform and keeps its UVs', () => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    part.position.set(5, 0, 0);
    const merged: THREE.BufferGeometry = surfaces.mergeGeometries([part, new THREE.BoxGeometry(1, 1, 1)]);
    merged.computeBoundingBox();
    expect(merged.boundingBox!.max.x).toBeCloseTo(5.5, 5);
    expect(merged.boundingBox!.min.x).toBeCloseTo(-0.5, 5);
    expect(merged.getAttribute('uv').count).toBe(merged.getAttribute('position').count);
  });
});
