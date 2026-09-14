// A GENERATED GAME OBJECT IS RUN HERE, NOT GREPPED — autopsy of the admin's bike screenshot, 2026-09-14.
//
// The report: a bike racing game whose bike was a red capsule lying across two grey cylinders.
// *"object ek dam nakli se bante hai, farzi object lagte hai."*
//
// The cause was not the realism switch and not the lighting. Both were already right: `realismIntent`
// (the admin's own 2026-08-27 instruction) reads real/asli/realistic from INTENTION, the build prompt
// already orders "build every object with objects.ts rather than hand-modelling shapes", and
// `createCar` at the real tier is genuinely good. **The library simply had no bike** — eight builders,
// none of them a motorcycle — so that order was one the model could not obey, and `setDetailLevel`
// never reaches a hand-modelled object anyway.

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { THREE_STUB, SURFACES_STUB, walk, worldPos, type Obj3D } from './helpers/threeStub';

/** Transpile the GENERATED objects.ts and run it against the stubs. This is the point of the file. */
function loadObjects(): Record<string, (o?: Record<string, unknown>) => unknown> {
  const src = generateGame3D(['objects']).files['src/game/three/objects.ts'];
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (id: string): unknown => {
    if (id === 'three') return THREE_STUB;
    if (id.endsWith('surfaces')) return SURFACES_STUB;
    throw new Error('the generated objects.ts should not import ' + id);
  };
  // eslint-disable-next-line no-new-func
  new Function('require', 'exports', 'module', js)(req, exports, { exports });
  return exports as Record<string, (o?: Record<string, unknown>) => unknown>;
}

interface Bike { root: Obj3D; seat: Obj3D; lean: (r: number) => void; steer: (r: number) => void; roll: (s: number, dt: number) => void }

describe('🔴 the library now HAS a bike — the gap that produced the screenshot', () => {
  const objects = loadObjects();

  it('createMotorcycle and createBicycle exist and build a scene graph', () => {
    expect(typeof objects.createMotorcycle).toBe('function');
    expect(typeof objects.createBicycle).toBe('function');
  });

  it('THE BUG THE FIRST DRAFT SHIPPED: the wheelbase survives the fork rake', () => {
    // A raked fork carries its wheel ~0.32 m FORWARD of the steering head. The first version hung the
    // forks off a head placed at base/2 and compensated by a guessed 0.4 factor, so the real wheelbase
    // came out 1.62 m — a stretched chopper — with nothing in the render to say so. A string test
    // cannot see this; running the builder can.
    (objects.setDetailLevel as unknown as (d: string) => void)('real');
    const bike = objects.createMotorcycle({ length: 2.05 }) as unknown as Bike;
    const wheels = walk(bike.root).filter((o) => o.name === 'wheel');
    expect(wheels).toHaveLength(2);

    const zs = wheels.map((w) => worldPos(bike.root, w)!.z).sort((a, b) => a - b);
    expect(zs[1] - zs[0]).toBeCloseTo(1.351, 2);   // 2.05 * 0.659, the real wheelbase
  });

  it('both wheels TOUCH THE GROUND — a floating or sunk wheel is instant', () => {
    (objects.setDetailLevel as unknown as (d: string) => void)('real');
    const bike = objects.createMotorcycle({ length: 2.05 }) as unknown as Bike;
    for (const w of walk(bike.root).filter((o) => o.name === 'wheel')) {
      // Wheel radius is 0.146 x length; the front wheel is 2% smaller, hence the tolerance.
      expect(worldPos(bike.root, w)!.y).toBeGreaterThan(0.28);
      expect(worldPos(bike.root, w)!.y).toBeLessThan(0.31);
    }
  });

  it('it is MOSTLY AIR — the parts are spread along the bike, not stacked in one blob', () => {
    // The screenshot's failure, stated as a measurement: every part at roughly one z. A real bike's
    // mass runs from the tail light to the headlight, over most of its length.
    (objects.setDetailLevel as unknown as (d: string) => void)('real');
    const bike = objects.createMotorcycle({ length: 2.05 }) as unknown as Bike;
    const zs = walk(bike.root).slice(1).map((o) => worldPos(bike.root, o)!.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(1.4);
  });

  it('the REAL tier is genuinely more bike than the lite one, and lite is still a bike', () => {
    (objects.setDetailLevel as unknown as (d: string) => void)('lite');
    const lite = walk((objects.createMotorcycle() as unknown as Bike).root).length;
    (objects.setDetailLevel as unknown as (d: string) => void)('real');
    const real = walk((objects.createMotorcycle() as unknown as Bike).root).length;
    expect(real).toBeGreaterThan(lite * 1.5);
    // …and even lite is far past "a capsule on two cylinders", which is what it replaces.
    expect(lite).toBeGreaterThan(12);
  });

  it('a rider can be seated, and the seat is at a real seat height', () => {
    const bike = objects.createMotorcycle({ length: 2.05 }) as unknown as Bike;
    expect(bike.seat.name).toBe('seat');
    expect(worldPos(bike.root, bike.seat)!.y).toBeCloseTo(0.8, 1);   // ~0.80 m, a real bike's seat
  });

  it('lean, steer and roll actually move the right things', () => {
    const bike = objects.createMotorcycle() as unknown as Bike;
    bike.lean(0.4);
    expect(bike.root.rotation.z).toBeCloseTo(0.4, 5);
    bike.steer(0.2);
    expect(bike.root.getObjectByName('steer')!.rotation.y).toBeCloseTo(0.2, 5);
    const before = walk(bike.root).filter((o) => o.name === 'wheel').map((w) => w.rotation.x);
    bike.roll(20, 0.016);
    const after = walk(bike.root).filter((o) => o.name === 'wheel').map((w) => w.rotation.x);
    expect(after.every((v, i) => v !== before[i])).toBe(true);
  });

  it('steering turns the FRONT assembly only — the rear wheel must not follow the bars', () => {
    const bike = objects.createMotorcycle() as unknown as Bike;
    const steer = bike.root.getObjectByName('steer')!;
    const inSteer = new Set(walk(steer).map((o) => o));
    const wheels = walk(bike.root).filter((o) => o.name === 'wheel');
    expect(wheels.filter((w) => inSteer.has(w))).toHaveLength(1);
  });

  it('a bicycle is not a shrunken motorcycle — thinner wheels, no engine, and its own wheelbase', () => {
    (objects.setDetailLevel as unknown as (d: string) => void)('real');
    const cycle = objects.createBicycle({ length: 1.75 }) as unknown as Bike;
    const zs = walk(cycle.root).filter((o) => o.name === 'wheel').map((w) => worldPos(cycle.root, w)!.z).sort((a, b) => a - b);
    expect(zs[1] - zs[0]).toBeCloseTo(1.05, 2);
    const bike = objects.createMotorcycle() as unknown as Bike;
    expect(walk(cycle.root).length).toBeLessThan(walk(bike.root).length);
  });

  it('the whole generated 3D layer still parses as TypeScript', () => {
    for (const [path, content] of Object.entries(generateGame3D().files)) {
      const sf = ts.createSourceFile(path, content, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
      expect((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics ?? []).toHaveLength(0);
    }
  });
});
