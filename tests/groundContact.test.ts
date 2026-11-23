// A car and a character dropped onto flat ground and onto a slope must finish with their lowest point
// on the surface. This runs the SAME source the kit writes to src/game/three/groundContact.ts.
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { GROUND_CONTACT_SOURCE } from '../src/server/lib/groundContact';
import { missingGroundContact, GROUND_CONTACT_RULE } from '../src/server/AgentV3/groundContactRule';
import { architectSystemPrompt, GAME_KIT_RULE } from '../src/server/AgentV3/systemPrompt';

interface Wheel { x: number; y: number; z: number; radius: number }
interface Body {
  x: number; y: number; z: number; pitch: number; roll: number; vy: number;
  meshBottom: number; wheels: Wheel[]; compression: number[];
}
interface Contact {
  GROUND_EPSILON: number;
  dropOnto(body: Body, heightAt: (x: number, z: number) => number, frames: number, dt?: number): Body;
  wheelContact(body: Body, wheel: Wheel): { x: number; y: number; z: number };
  meshLowestY(body: Body): number;
  standsOn(originY: number, lowest: number, surface: number): boolean;
}

function loadContact(): Contact {
  const js = ts.transpileModule(GROUND_CONTACT_SOURCE, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Contact = {
    GROUND_EPSILON: 0, dropOnto: () => { throw new Error('missing'); },
    wheelContact: () => { throw new Error('missing'); }, meshLowestY: () => { throw new Error('missing'); },
    standsOn: () => { throw new Error('missing'); },
  };
  // The emitted module has no imports. Transpiled CommonJS writes onto exports.
  new Function('exports', 'require', js)(exports, () => { throw new Error('ground contact has no imports'); });
  return exports;
}

const contact = loadContact();
const FRAMES = 180;

function car(x: number, y: number): Body {
  // Origin at the body centre. The tyres hang below it — the case that used to sink.
  const wheels: Wheel[] = [
    { x: 0.7, y: -0.4, z: 1.2, radius: 0.34 },
    { x: -0.7, y: -0.4, z: 1.2, radius: 0.34 },
    { x: 0.7, y: -0.4, z: -1.2, radius: 0.34 },
    { x: -0.7, y: -0.4, z: -1.2, radius: 0.34 },
  ];
  return { x, y, z: 0, pitch: 0, roll: 0, vy: 0, meshBottom: -0.75, wheels, compression: [0, 0, 0, 0] };
}

function person(x: number, y: number): Body {
  // Origin at the hips. The feet are the lowest point.
  return { x, y, z: 0, pitch: 0, roll: 0, vy: 0, meshBottom: -0.92, wheels: [], compression: [] };
}

function clearance(body: Body, heightAt: (x: number, z: number) => number): number {
  let gap = contact.meshLowestY(body) - heightAt(body.x, body.z);
  for (const wheel of body.wheels) {
    const at = contact.wheelContact(body, wheel);
    gap = Math.min(gap, at.y - heightAt(at.x, at.z));
  }
  return gap;
}

describe('ground contact — a dropped car and character stay on the surface', () => {
  const flat = () => 0;
  const slope = (x: number) => 0.25 * x;

  it('after 180 frames on flat ground, both lowest points are on the surface', () => {
    const landedCar = contact.dropOnto(car(0, 6), flat, FRAMES);
    const landedPerson = contact.dropOnto(person(0, 4), flat, FRAMES);
    expect(clearance(landedCar, flat)).toBeGreaterThanOrEqual(-contact.GROUND_EPSILON);
    expect(clearance(landedPerson, flat)).toBeGreaterThanOrEqual(-contact.GROUND_EPSILON);
    expect(contact.standsOn(landedPerson.y, landedPerson.meshBottom, 0)).toBe(true);
    expect(landedCar.compression.every((c) => c >= 0 && c <= 0.12)).toBe(true);
  });

  it('after 180 frames on a slope, both lowest points are still above that slope', () => {
    const landedCar = contact.dropOnto(car(4, 8), slope, FRAMES);
    const landedPerson = contact.dropOnto(person(4, 6), slope, FRAMES);
    expect(clearance(landedCar, slope)).toBeGreaterThanOrEqual(-contact.GROUND_EPSILON);
    expect(clearance(landedPerson, slope)).toBeGreaterThanOrEqual(-contact.GROUND_EPSILON);
  });
});

describe('the kit ships that module and the builder cannot skip it', () => {
  const files = generateGame3D().files;

  it('every 3D kit includes groundContact.ts, and the ground and the vehicles call it', () => {
    expect(files['src/game/three/groundContact.ts']).toBe(GROUND_CONTACT_SOURCE);
    expect(files['src/game/three/surfaces.ts']).toContain("from './groundContact'");
    expect(files['src/game/three/surfaces.ts']).toContain('export function standOnGround');
    expect(files['src/game/three/surfaces.ts']).toContain('export function localLowestY');
    expect(files['src/game/three/objects.ts']).toContain('localLowestY');
    expect(files['src/game/three/physics.ts']).toContain('clampOriginY');
    expect(missingGroundContact(files)).toBe('');
  });

  it('a game that draws ground and never calls the module is rejected', () => {
    const bad = new Map([
      ['src/game/World.tsx', 'const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40));\nmarkWorldCollider(ground, "ground");\ncar.position.y = 0;'],
    ]);
    expect(missingGroundContact(bad)).toContain('GROUND CONTACT MISSING');
    expect(missingGroundContact(new Map([['src/App.tsx', 'export function App() { return <div>Hello</div>; }']]))).toBe('');
  });

  it('the architect prompt and the writing-agent rule both state the law', () => {
    expect(architectSystemPrompt()).toContain('GROUND CONTACT IS MANDATORY');
    expect(GAME_KIT_RULE).toContain('GROUND CONTACT IS MANDATORY');
    expect(GROUND_CONTACT_RULE).toContain('standOnGround');
  });
});
