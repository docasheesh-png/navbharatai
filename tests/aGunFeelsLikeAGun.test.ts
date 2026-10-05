// A GUN FEELS LIKE A GUN (admin 2026-10-05, the taxonomy's weapons — "same intensity").
//
// A generated shooter usually fires one projectile per click and calls it a gun. These tests hold the
// behaviour every player knows without being told: a rifle keeps firing while the trigger is held and a
// pistol does not; a magazine runs dry and the reload takes time; the cone blooms while you spray and
// tightens when you stop; a shotgun is eight pellets and ONE bang; an arrow falls; a sword hits what is in
// front, once per swing. Plus the models (a gun is a profile, not a box) and a hand to hold them in.
// Everything runs the GENERATED modules.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';

const DIR = join(__dirname, `.tmp-game3d-weapons-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let Wp: any; let P: any; let E: any; let O: any; let H: any;
beforeAll(async () => {
  (globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }) }) };
  for (const r of [generateGameRuntime(), generateGameSystems(), generateGame3D()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  Wp = await import(join(DIR, 'src/game/systems/weapon.ts'));
  P = await import(join(DIR, 'src/game/systems/projectile.ts'));
  E = await import(join(DIR, 'src/game/core/events.ts'));
  O = await import(join(DIR, 'src/game/three/objects.ts'));
  H = await import(join(DIR, 'src/game/three/humanoid.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).document; });

const muzzle = { x: 0, y: 1.5, z: 0 }, aim = { x: 0, y: 0, z: 1 };
const hold = (w: any, p: any, seconds: number, held = true) => { let shots = 0; for (let i = 0; i < Math.round(seconds * 60); i++) shots += w.update(1 / 60, held, muzzle, aim, p); return shots; };
const tap = (w: any, p: any, presses: number) => { let shots = 0; for (let i = 0; i < presses; i++) { shots += w.update(1 / 60, true, muzzle, aim, p); for (let k = 0; k < 20; k++) shots += w.update(1 / 60, false, muzzle, aim, p); } return shots; };

describe('the trigger', () => {
  it('a rifle fires at its rate while HELD; a pistol fires once per PRESS', () => {
    const rifle = new Wp.Weapon('rifle'); const p = new P.ProjectileSystem();
    expect(hold(rifle, p, 1)).toBe(9);
    const pistol = new Wp.Weapon('pistol'); const p2 = new P.ProjectileSystem();
    expect(hold(pistol, p2, 1)).toBe(1);
    expect(tap(new Wp.Weapon('pistol'), new P.ProjectileSystem(), 5)).toBe(5);
  });

  it('a magazine runs dry, says so with a click, and the reload takes its time — no firing during it', () => {
    const smg = new Wp.Weapon('smg'); const p = new P.ProjectileSystem();
    const heard: string[] = [];
    const offs = ['WEAPON_EMPTY', 'WEAPON_RELOADED'].map((e) => E.events.on(e, () => heard.push(e)));
    // 13 rounds a second: the 32-round magazine empties in 2.46 s. Holding on through the last round
    // clicks ONCE and starts the reload — the trigger is still down, so the player obviously wants it.
    expect(hold(smg, p, 2.55)).toBe(32);
    expect(smg.ammo).toBe(0);
    expect(heard.filter((h) => h === 'WEAPON_EMPTY')).toHaveLength(1);
    expect(smg.reloading).toBeGreaterThan(0);
    expect(hold(smg, p, 1.2)).toBe(0);                      // still reloading (1.6 s) — no firing during it
    expect(heard).not.toContain('WEAPON_RELOADED');
    hold(smg, p, 0.5, false);
    expect(heard).toContain('WEAPON_RELOADED');
    expect(smg.ammo).toBe(32);
    offs.forEach((o: any) => o());
  });
});

describe('where the shots go', () => {
  it('spread blooms while spraying and recovers when you stop; every shot stays inside its cone', () => {
    const rifle = new Wp.Weapon('rifle', 5); const p = new P.ProjectileSystem(512);
    const calm = rifle.spread;
    hold(rifle, p, 0.8);
    expect(rifle.spread).toBeGreaterThan(calm * 1.5);
    expect(rifle.spread).toBeLessThanOrEqual(calm * Wp.MAX_BLOOM + 1e-9);
    hold(rifle, p, 1.5, false);
    expect(rifle.spread).toBeCloseTo(calm, 6);
    // The first shot's direction is inside the calm cone.
    const fired: any[] = [];
    const real = new P.ProjectileSystem();
    const spy = { fire: (o: any) => { fired.push(o); return real.fire(o); } };
    new Wp.Weapon('sniper', 3).update(1 / 60, true, muzzle, aim, spy);
    const d = fired[0].direction; const len = Math.hypot(d.x, d.y, d.z);
    expect(Math.acos(d.z / len)).toBeLessThanOrEqual(Wp.WEAPONS.sniper.spread + 1e-9);
  });

  it('a shotgun is eight pellets and ONE bang — the projectile system no longer announces each pellet', () => {
    const p = new P.ProjectileSystem(); const bangs: any[] = [];
    const off = E.events.on('WEAPON_FIRED', (x: any) => bangs.push(x));
    new Wp.Weapon('shotgun').update(1 / 60, true, muzzle, aim, p);
    off();
    expect(p.activeCount).toBe(8);
    expect(bangs).toHaveLength(1);
  });

  it('recoil kicks the view and settles; the same seed fires the same pattern', () => {
    const w = new Wp.Weapon('sniper'); const p = new P.ProjectileSystem();
    w.update(1 / 60, true, muzzle, aim, p);
    expect(w.kick).toBeGreaterThan(0.1);
    hold(w, p, 1, false);
    expect(w.kick).toBeLessThan(0.001);
    const dirs = (seed: number) => { const out: any[] = []; const s = { fire: (o: any) => { out.push(o.direction); return true; } }; new Wp.Weapon('shotgun', seed).update(1 / 60, true, muzzle, aim, s); return JSON.stringify(out); };
    expect(dirs(4)).toBe(dirs(4));
    expect(dirs(4)).not.toBe(dirs(5));
  });

  it('an arrow falls; a bow nocks the next arrow by itself', () => {
    const bow = new Wp.Weapon('bow'); const p = new P.ProjectileSystem();
    bow.update(1 / 60, true, muzzle, aim, p);
    const target = { position: { x: 0, y: 1.5, z: 30 }, radius: 0.4 };
    let hits = 0; for (let i = 0; i < 120; i++) hits += p.update(1 / 60, [target]).length;
    expect(hits, 'aimed level at 30 m, an arrow drops below the target').toBe(0);
    expect(bow.reloading).toBeGreaterThan(0);
    hold(bow, p, 0.7, false);
    expect(bow.ammo).toBe(1);
  });
});

describe('a blade hits what is in front, once per swing', () => {
  const at = (x: number, z: number) => ({ position: { x, y: 1, z }, radius: 0.4 });
  it('in front and in reach: yes; behind, beside or too far: no', () => {
    const hits = Wp.meleeHits({ x: 0, y: 0, z: 0 }, 0, [at(0, 1.5), at(0, -1.5), at(2.5, 0), at(0, 4)]);
    expect(hits).toHaveLength(1);
    expect(hits[0].position.z).toBe(1.5);
  });
  it('one swing lands once, at its strike moment, and the next waits for the cooldown', () => {
    const sword = new Wp.MeleeWeapon(30, 2);
    const t = [at(0, 1)];
    expect(sword.swing()).toBe(true);
    let landed = 0;
    for (let i = 0; i < 30; i++) landed += sword.update(1 / 60, { x: 0, y: 0, z: 0 }, 0, t).length;
    expect(landed).toBe(1);
    expect(sword.swing()).toBe(true);                       // 0.5 s later, ready again
    expect(sword.swing()).toBe(false);
  });
});

describe('the models, and a hand to hold them', () => {
  it('every weapon is real-sized, built from a profile, gripped at the origin, muzzle at the front', () => {
    const LONG: Record<string, [number, number]> = { pistol: [0.15, 0.3], rifle: [0.85, 1.15], smg: [0.5, 0.8], shotgun: [0.95, 1.2], sniper: [1.2, 1.5], sword: [0.95, 1.1], axe: [0.65, 0.9], bow: [0.15, 0.8] };
    for (const kind of Object.keys(LONG)) {
      const w = O.createWeapon({ kind, detail: 'real' });
      w.root.updateMatrixWorld(true);
      // Precise, and only what is SHOWN: a rotated arc's corner box overstates it, and a bow's arrow is
      // hidden until it is drawn.
      const box = new THREE.Box3();
      w.root.traverseVisible((o: any) => { if (o.isMesh) box.union(new THREE.Box3().setFromObject(o, true)); });
      const len = box.max.z - box.min.z;
      expect(len, kind).toBeGreaterThan(LONG[kind][0]); expect(len, kind).toBeLessThan(LONG[kind][1]);
      expect(box.containsPoint(new THREE.Vector3(0, 0, 0)), `${kind}: grip at the origin`).toBe(true);
      const m = w.muzzle.getWorldPosition(new THREE.Vector3());
      expect(m.z, `${kind}: muzzle at the front`).toBeGreaterThan(box.max.z - 0.05);
      if (kind !== 'bow') {
        const shapes: string[] = []; w.root.traverse((o: any) => { if (o.isMesh) shapes.push(o.geometry.type); });
        expect(shapes.some((g) => g === 'ExtrudeGeometry' || (kind === 'sword' && g === 'BufferGeometry')), `${kind} is built from a profile`).toBe(true);
      }
    }
  });

  it('a sword blade thins toward its point and toward both edges (a ground bevel, not a ruler)', () => {
    const sword = O.createWeapon({ kind: 'sword', detail: 'real' });
    const blade = (sword.root.getObjectByName('blade') as any).geometry;
    const pos = blade.getAttribute('position');
    const thick = (z0: number, z1: number, yMax: number) => { let m = 0; for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i), y = Math.abs(pos.getY(i)); if (z >= z0 && z <= z1 && y <= yMax) m = Math.max(m, Math.abs(pos.getX(i))); } return m; };
    expect(thick(0.6, 0.8, 0.004), 'thinner near the point').toBeLessThan(thick(0.1, 0.3, 0.004) * 0.85);
    expect(thick(0.1, 0.3, 0.03) , 'the spine is thickest').toBe(thick(0.1, 0.3, 0.004));
    let edge = 0; for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i), y = Math.abs(pos.getY(i)); if (z >= 0.1 && z <= 0.3 && y > 0.02) edge = Math.max(edge, Math.abs(pos.getX(i))); }
    expect(edge, 'the edges are ground thin').toBeLessThan(thick(0.1, 0.3, 0.004) * 0.4);
  });

  it('a bow draws: the limbs bend back, the string meets them and the nock, and an arrow rides on it', () => {
    const bow = O.createWeapon({ kind: 'bow', detail: 'real' });
    const meshes = (): any[] => { const out: any[] = []; bow.root.traverse((o: any) => { if (o.isMesh) out.push(o); }); return out; };
    const tubes = () => meshes().filter((m) => m.geometry.type === 'TubeGeometry');
    const strings = () => meshes().filter((m) => m.geometry.type === 'CylinderGeometry' && m.geometry.parameters.radiusTop < 0.003);
    const ends = (m: any) => { const h = new THREE.Vector3(0, 0.5, 0).applyQuaternion(m.quaternion).multiplyScalar(m.scale.y); return [m.position.clone().add(h), m.position.clone().sub(h)]; };
    const tipsOf = () => tubes().map((t: any) => { t.updateMatrixWorld(true); const pts = t.geometry.parameters.path.points; return pts[pts.length - 1].clone().applyMatrix4(t.parent.matrix); });
    expect(typeof bow.setDraw).toBe('function');
    bow.root.updateMatrixWorld(true);
    const height = new THREE.Box3().setFromObject(bow.root, true);
    expect(height.max.y - height.min.y, 'a bow is ~1.5 m tip to tip').toBeGreaterThan(1.4);
    const arrow = meshes().find((m) => m.geometry.type === 'ConeGeometry')!.parent;
    expect(arrow.visible, 'no arrow at rest').toBe(false);
    const restTips = tipsOf();
    for (const draw of [0, 0.5, 1]) {
      bow.setDraw!(draw);
      bow.root.updateMatrixWorld(true);
      const tips = tipsOf();
      const segs = strings().map(ends);
      expect(segs).toHaveLength(2);
      // Every string segment runs from a limb tip to the one nock point — never floating behind the bow.
      for (const [a, b] of segs) {
        const nockEnd = Math.abs(a.y) < Math.abs(b.y) ? a : b, tipEnd = nockEnd === a ? b : a;
        expect(nockEnd.distanceTo(new THREE.Vector3(0, 0, -0.2 - 0.55 * draw)), `nock at draw ${draw}`).toBeLessThan(0.002);
        expect(Math.min(...tips.map((t) => t.distanceTo(tipEnd))), `string meets the tip at draw ${draw}`).toBeLessThan(0.002);
      }
    }
    const fullTips = tipsOf();
    for (let k = 0; k < 2; k++) expect(fullTips[k].z, 'a drawn limb bends back').toBeLessThan(restTips[k].z - 0.05);
    expect(arrow.visible, 'an arrow on the drawn string').toBe(true);
    const head = meshes().find((m) => m.geometry.type === 'ConeGeometry')!.getWorldPosition(new THREE.Vector3());
    expect(head.z, 'at full draw the arrowhead sits at the grip').toBeGreaterThan(-0.05);
    expect(head.z).toBeLessThan(0.08);
  });

  it('a humanoid holds a weapon in its right hand and, aiming, points it straight ahead', () => {
    const hero = H.createHumanoid();
    const rifle = O.createWeapon({ kind: 'rifle' });
    hero.hold(rifle.root);
    expect(hero.joints.rightHand.children).toContain(rifle.root);
    hero.aim(true);
    hero.root.updateMatrixWorld(true);
    const grip = rifle.root.getWorldPosition(new THREE.Vector3());
    const tip = rifle.muzzle.getWorldPosition(new THREE.Vector3());
    const dir = tip.clone().sub(grip).normalize();
    expect(dir.z, 'pointing forward (+Z), not at the ground').toBeGreaterThan(0.9);
    expect(grip.y, 'held at chest height').toBeGreaterThan(1.1);
    hero.hold(null);
    expect(hero.joints.rightHand.children).not.toContain(rifle.root);
  });
});
