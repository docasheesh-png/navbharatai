// SUBJECTS AND SPINNING WHEELS: the Forge makes ANY subject from DATA, and the first answer is good because the model is shown the example and
// the checklist closest to what it was asked for. The vehicle examples prove the spec language can express a train, a car and a bike, wheels
// that really roll included. No model code is ever run: everything here is data checked and built by the Forge's own engine.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import ts from 'typescript';
import { subjectKindOf, exampleForSubject, subjectChecklist, SUBJECT_CHECKLIST, exampleIdForKind, type SubjectKind } from './forgeSubjects';
import { FORGE_EXAMPLES } from './forgeExamples';
import { authorObject, loadForge } from './forgeRuntime';
import { FORGE_ENGINE } from './forgeEngineSource';
import { selfAuthorObject } from './forgeSelfAuthor';

const { engine: E, check: C } = loadForge();

describe('what kind of subject was asked for', () => {
  const cases: Array<[string, SubjectKind]> = [
    ['a steam train', 'rail'], ['relgadi', 'rail'], ['metro rake', 'rail'], ['motorcycle', 'bike'], ['a red scooter', 'bike'], ['bicycle', 'bike'],
    ['a car', 'road'], ['gaadi', 'road'], ['a bus', 'road'], ['auto rickshaw', 'road'], ['tractor', 'road'],
    ['a helicopter', 'air'], ['aeroplane', 'air'], ['rocket', 'air'], ['a fishing boat', 'water'], ['naav', 'water'], ['ship', 'water'],
    ['a lion', 'animal'], ['elephant', 'animal'], ['narsingh', 'animal'], ['kutta', 'animal'], ['a dragon', 'animal'],
    ['an eagle', 'bird'], ['mor', 'bird'], ['a parrot', 'bird'],
    ['a mango tree', 'plant'], ['phool', 'plant'], ['cactus', 'plant'],
    ['a temple', 'building'], ['lighthouse', 'building'], ['mandir', 'building'], ['castle', 'building'], ['a hut', 'building'],
    ['a woman', 'person'], ['ladki', 'person'], ['zombie', 'person'], ['a robot', 'person'],
    ['a spoon', 'prop'], ['samosa', 'prop'], ['', 'prop'],
  ];
  for (const [text, kind] of cases) it(`"${text}" is a ${kind}`, () => expect(subjectKindOf(text)).toBe(kind));
  it('the first subject named wins ("a bike with a dog" is a bike, "a dog on a bike" is a dog)', () => {
    expect(subjectKindOf('a bike with a dog')).toBe('bike'); expect(subjectKindOf('a dog on a bike')).toBe('animal');
  });
  it('rubbish never throws and is a prop', () => {
    for (const t of ['!!!', 'x'.repeat(10000), '\u0000', '12345']) expect(subjectKindOf(t)).toBe('prop');
  });
});

describe('the right help for each kind', () => {
  const kinds = Object.keys(SUBJECT_CHECKLIST) as SubjectKind[];
  it('every kind has a checklist and an example that exists and is valid', () => {
    expect(kinds.length).toBe(11);
    for (const k of kinds) {
      expect(SUBJECT_CHECKLIST[k].length, k).toBeGreaterThanOrEqual(3);
      for (const line of SUBJECT_CHECKLIST[k]) expect(line.length).toBeGreaterThan(30);
      expect(FORGE_EXAMPLES[exampleIdForKind(k)], k).toBeDefined();
      expect(subjectChecklist(k)).toMatch(new RegExp('^WHAT A ' + k.toUpperCase() + ' MUST HAVE'));
    }
  });
  it('a train gets the train, a car the car, a bike the bike, a lion the animal, a tree the tree, a temple the house, a person the person', () => {
    for (const [text, id] of [['train', 'train'], ['car', 'car'], ['motorcycle', 'bike'], ['lion', 'quadruped'], ['tree', 'tree'], ['temple', 'house'], ['woman', 'person'], ['spoon', 'sword']]) expect(exampleForSubject(text).id, text).toBe(id);
  });
  it('the model\'s first prompt shows the example AND the checklist for the subject, and never code', async () => {
    const prompts: string[] = [];
    await selfAuthorObject('a steam train', { ask: async (p) => { prompts.push(p); return null; } });
    expect(prompts[0]).toContain('"id":"train"'); expect(prompts[0]).toContain('WHAT A RAIL MUST HAVE'); expect(prompts[0]).toMatch(/spin/);
    prompts.length = 0;
    await selfAuthorObject('narsingh, sher ke sir wala yoddha', { ask: async (p) => { prompts.push(p); return null; } });
    expect(prompts[0]).toContain('WHAT A ANIMAL MUST HAVE'); expect(prompts[0]).toContain('"id":"quadruped"');
    expect(prompts[0]).not.toMatch(/function |=>|import /); // data, not code: the model is not shown any program to imitate
  });
});

describe('a wheel that turns for ever (spin)', () => {
  const wheelSpec = (track: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 'wheel-test', name: 'W', materials: { m: { color: '#222222' } }, nodes: [{ name: 'wheel', shape: { type: 'cylinder', radiusTop: 0.4, radiusBottom: 0.4, height: 0.2, seg: 16 }, material: 'm', position: [0, 0.4, 0], rotation: [0, 0, 90], clips: { roll: [track] }, ...extra }] });

  it('a spin is linear in time: speed turns a second, in degrees', () => {
    const t = { property: 'rotation', axis: 'x', speed: 2, spin: true };
    expect(E.trackValue(t, 0)).toBe(0); expect(E.trackValue(t, 0.25)).toBeCloseTo(180, 9); expect(E.trackValue(t, 1)).toBeCloseTo(720, 9);
    expect(E.trackValue({ ...t, speed: -2 }, 0.25)).toBeCloseTo(-180, 9);
    expect(E.trackValue({ ...t, offset: 30, phase: 0.5 }, 0)).toBeCloseTo(210, 9);
  });
  it('keeps turning (a swing would come back; a spin does not)', () => {
    const ex = E.expandNodes(wheelSpec({ property: 'rotation', axis: 'x', speed: 1, spin: true }));
    const at = (time: number) => E.poseOf(ex[0], 'roll', time).rotation[0];
    expect(at(10) - at(0)).toBeCloseTo(3600, 6); expect(at(0.5)).toBeCloseTo(180, 6);
  });
  it('validates: spin needs a rotation and a speed from 0.01 to 10 turns a second (either way), and no amplitude', () => {
    const errs = (track: Record<string, unknown>) => C.validateObjectSpec(wheelSpec(track)).errors.join(' | ');
    expect(errs({ property: 'rotation', axis: 'x', speed: 2, spin: true })).toBe('');
    expect(errs({ property: 'rotation', axis: 'x', speed: -2, spin: true })).toBe('');
    expect(errs({ property: 'position', axis: 'x', speed: 2, spin: true })).toMatch(/only a rotation can be/);
    expect(errs({ property: 'rotation', axis: 'x', speed: 0, spin: true })).toMatch(/turns between 0.01 and 10/);
    expect(errs({ property: 'rotation', axis: 'x', speed: 11, spin: true })).toMatch(/turns between 0.01 and 10/);
    expect(errs({ property: 'rotation', axis: 'x', speed: 2, spin: 'yes' })).toMatch(/spin must be true or false/);
    expect(errs({ property: 'rotation', axis: 'x', speed: 0, amplitude: 5 })).toMatch(/speed is 0/); // a swing still needs a real speed and an amplitude
  });
  it('mirrored: the same wheel on the other side rolls the SAME way about the axle, and the other way about the other axes', () => {
    const ex = E.expandNodes(wheelSpec({ property: 'rotation', axis: 'x', speed: 1, spin: true }, { mirror: 'x' }));
    expect(E.poseOf(ex[1], 'roll', 0.25).rotation[0]).toBeCloseTo(E.poseOf(ex[0], 'roll', 0.25).rotation[0], 9);
    const y = E.expandNodes(wheelSpec({ property: 'rotation', axis: 'y', speed: 1, spin: true }, { mirror: 'x' }));
    expect(E.poseOf(y[1], 'roll', 0.25).rotation[1]).toBeCloseTo(-E.poseOf(y[0], 'roll', 0.25).rotation[1], 9);
  });
  it('a spinning wheel does not trip the "tears the object apart" check (it only turns)', () => {
    const r = authorObject(wheelSpec({ property: 'rotation', axis: 'x', speed: 3, spin: true }, { position: [0, 0.4, 0] }));
    expect(r.errors).toEqual([]);
    expect(r.report!.warnings.filter((w: string) => /clip roll/.test(w))).toEqual([]);
  });
});

describe('the vehicle examples are real vehicles', () => {
  const built = Object.fromEntries(['train', 'car', 'bike'].map((id) => [id, authorObject(FORGE_EXAMPLES[id].spec)]));
  const names = (id: string): string[] => (E.expandNodes(FORGE_EXAMPLES[id].spec) as Array<{ name: string }>).map((n) => n.name);

  it('all three build with no warnings: every part touches, they stand on the ground, they are centred', () => {
    for (const id of ['train', 'car', 'bike']) { expect(built[id].errors, id).toEqual([]); expect(built[id].report!.warnings, id).toEqual([]); }
  });
  it('the train is 26 to 34 m long, about 3 m wide, 3.5 to 5 m high', () => {
    const [w, h, l] = built.train.report!.size; expect(l).toBeGreaterThan(26); expect(l).toBeLessThan(34); expect(w).toBeGreaterThan(2.8); expect(w).toBeLessThan(3.6); expect(h).toBeGreaterThan(3.5); expect(h).toBeLessThan(5);
  });
  it('the car is 4.2 to 4.7 m long and under 2.1 m wide and 1.6 m high; the bike 1.9 to 2.4 m long', () => {
    const [w, h, l] = built.car.report!.size; expect(l).toBeGreaterThan(4.2); expect(l).toBeLessThan(4.7); expect(w).toBeLessThan(2.1); expect(h).toBeLessThan(1.6);
    expect(built.bike.report!.size[2]).toBeGreaterThan(1.9); expect(built.bike.report!.size[2]).toBeLessThan(2.4);
  });
  it('the right number of wheels: the train 6 + 2 carriages x 4, the car 4, the bike 2', () => {
    expect(names('train').filter((n) => /^loco_wheel/.test(n)).length).toBe(6);
    expect(names('train').filter((n) => /^wheel/.test(n)).length).toBe(8);
    expect(names('car').filter((n) => /^wheel(_\d+)?(_mirror)?$/.test(n)).length).toBe(4);
    expect(names('bike').filter((n) => /^wheel(_\d+)?$/.test(n)).length).toBe(2);
  });
  it('every wheel has a spin clip, all rolling the same way, and they touch the ground (their lowest point is y = 0)', () => {
    for (const [id, clip] of [['train', 'run'], ['car', 'drive'], ['bike', 'ride']]) {
      const wheels = (E.expandNodes(FORGE_EXAMPLES[id].spec) as Array<{ name: string; clips: Record<string, Array<{ spin?: boolean; speed: number }>> }>).filter((n) => /wheel/.test(n.name) && n.clips[clip]);
      expect(wheels.length, id).toBeGreaterThanOrEqual(2);
      for (const w of wheels) { expect(w.clips[clip][0].spin, w.name).toBe(true); expect(w.clips[clip][0].speed, w.name).toBeGreaterThan(0); }
      expect(Math.abs(built[id].report!.min[1]), id).toBeLessThan(0.02);
    }
  });
  it('in a real three.js scene the wheels actually roll: play, update, and every wheel has turned', () => {
    const js = ts.transpileModule(FORGE_ENGINE, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const ex: Record<string, any> = {};
    // eslint-disable-next-line no-new-func
    new Function('exports', js)(ex);
    for (const [id, clip, wheel] of [['car', 'drive', 'wheel'], ['train', 'run', 'loco_wheel'], ['bike', 'ride', 'wheel']]) {
      const o = ex.createObject(THREE, FORGE_EXAMPLES[id].spec);
      const before = o.nodes[wheel].rotation.x;
      o.play(clip); o.update(0.1);
      expect(Math.abs(o.nodes[wheel].rotation.x - before), `${id} ${wheel}`).toBeGreaterThan(0.2);
      const t1 = o.nodes[wheel].rotation.x; o.update(0.1);
      expect(o.nodes[wheel].rotation.x, `${id} keeps turning`).not.toBeCloseTo(t1, 3);
      const box = new THREE.Box3().setFromObject(o.group, true); // precise: the real vertices, not the loose box of a turning cylinder
      expect(box.min.y).toBeGreaterThan(-0.05); // rolling does not sink the vehicle
    }
  });
  it('the carriage is built ONCE and repeated: its geometry is shared (a longer train costs no more shapes)', () => {
    const ex = E.expandNodes(FORGE_EXAMPLES.train.spec) as Array<{ name: string; source: number }>;
    const bodies = ex.filter((n) => /^body/.test(n.name));
    expect(bodies.length).toBe(2); expect(new Set(bodies.map((b) => b.source)).size).toBe(1);
  });
  it('they are cheap enough for a phone', () => { for (const id of ['train', 'car', 'bike']) expect(built[id].report!.triangles, id).toBeLessThan(4000); });
});
