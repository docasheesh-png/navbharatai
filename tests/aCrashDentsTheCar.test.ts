/**
 * 🚗 A CRASH DENTS THE CAR (admin 2026-11-24, question 9: "cars ke accident ko realistic banao, car me dent padna chahiye").
 * The kit heard every crash and never changed the car. src/game/three/dents.ts pushes the body in where it hit — deeper for a
 * harder crash, capped — scuffs it, keeps a damage total, and never dents another car that shares the same geometry.
 * Runs the REAL kit files with the real three.js.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { GAME_DENTS_PATH } from '../src/server/lib/GameDentsGenerator';
import { buildGameContract, gameContractBlock, scopeMatch } from '../src/server/AgentV3/gameIntent';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-dents-${process.pid}`);
let D: any; let EV: any;
beforeAll(async () => {
  for (const r of [generateGameRuntime(['events']), generateGame3D(['dents'])]) {
    for (const [p, c] of Object.entries(r.files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  }
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  D = await import(join(DIR, GAME_DENTS_PATH));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A 2 × 1 × 4 m car body (nose at +Z), finely divided like a real model. */
function car(shared?: THREE.BufferGeometry) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(shared ?? new THREE.BoxGeometry(2, 1, 4, 8, 4, 16), new THREE.MeshStandardMaterial({ color: 0xcc0000 }));
  body.position.y = 0.5; body.name = 'body';
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 12), new THREE.MeshStandardMaterial()); wheel.name = 'wheel_fl'; wheel.position.set(0.9, 0.35, 1.4);
  root.add(body, wheel);
  return { root, body, wheel };
}
const zMax = (m: THREE.Mesh) => { m.geometry.computeBoundingBox(); return m.geometry.boundingBox!.max.z; };
/** z of the nose vertex nearest the impact (local (0, 0, 2)) — where a dent shows. */
const noseZ = (m: THREE.Mesh) => {
  const pos = m.geometry.getAttribute('position'); let best = Infinity, z = 0; const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const d = Math.hypot(v.x, v.y); if (v.z > 1.5 && d < best) { best = d; z = v.z; } }
  return z;
};

describe('a crash dents the car where it hit', () => {
  it('🔴 the nose is pushed in, deeper for a harder crash, and the car says VEHICLE_DAMAGED', () => {
    const seen: number[] = [];
    const off = EV.events.on('VEHICLE_DAMAGED', (p: { damage: number }) => seen.push(p.damage));
    const soft = car(); const hard = car();
    const at = new THREE.Vector3(0, 0.5, 2);
    D.dentVehicle(soft.root, at, 5);
    D.dentVehicle(hard.root, at, 18);
    off();
    expect(noseZ(soft.body)).toBeLessThan(2 - 0.03);
    expect(noseZ(hard.body)).toBeLessThan(noseZ(soft.body));
    expect(2 - noseZ(hard.body)).toBeLessThanOrEqual(0.25 + 1e-6); // capped
    expect(seen.length).toBe(2);
    expect(hard.root.userData.damage).toBeGreaterThan(soft.root.userData.damage);
    // the back of the car and the wheels are untouched
    soft.body.geometry.computeBoundingBox();
    expect(soft.body.geometry.boundingBox!.min.z).toBeCloseTo(-2, 5);
    expect(soft.wheel.userData.dentOwned).toBeUndefined();
    // the paint is scuffed
    expect((soft.body.material as THREE.MeshStandardMaterial).color.getHex()).not.toBe(0xcc0000);
  });
  it('a shared model geometry is copied: one car\'s dent never appears on another', () => {
    const geo = new THREE.BoxGeometry(2, 1, 4, 8, 4, 16);
    const a = car(geo); const b = car(geo);
    D.dentVehicle(a.root, new THREE.Vector3(0, 0.5, 2), 15);
    expect(a.body.geometry).not.toBe(geo);
    expect(noseZ(a.body)).toBeLessThan(2 - 0.03);
    expect(noseZ(b.body)).toBeCloseTo(2, 5);
  });
  it('repairVehicle puts it back as new', () => {
    const c = car();
    D.dentVehicle(c.root, new THREE.Vector3(0, 0.5, 2), 15);
    expect(noseZ(c.body)).toBeLessThan(2 - 0.03);
    D.repairVehicle(c.root);
    expect(noseZ(c.body)).toBeCloseTo(2, 5);
    expect(zMax(c.body)).toBeCloseTo(2, 5);
    expect(c.root.userData.damage).toBe(0);
  });
  it('a crash with no speed lost changes nothing', () => {
    const c = car();
    expect(D.dentVehicle(c.root, new THREE.Vector3(0, 0.5, 2), 0)).toBe(0);
    expect(c.body.userData.dentOwned).toBeUndefined();
  });
});

describe('the builder is told when the user asks', () => {
  it('🔴 "car me dent padna chahiye" makes it a required feature with the call to make, checked from code', () => {
    const contract = buildGameContract('racing game banao, cars ke accident ko realistic banao, car me dent padna chahiye');
    expect(contract.requiredFeatures).toContain('crashDamage');
    expect(gameContractBlock(contract)).toMatch(/call enableVehicleDents\(\) once/);
    expect(scopeMatch(contract, { 'src/game/Race.ts': 'enableVehicleDents();' }).missing).not.toContain('crashDamage');
    expect(scopeMatch(contract, { 'src/game/Race.ts': 'driveVehicle(car)' }).missing).toContain('crashDamage');
    expect(buildGameContract('a racing game with 5 laps').requiredFeatures).not.toContain('crashDamage');
  });
});
