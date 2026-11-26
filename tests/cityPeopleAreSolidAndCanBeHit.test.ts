// CITY PEOPLE ARE SOLID, AND A PUNCH LANDS (admin 2026-11-25, open-world problem #6: "citizens aar paar ho jate hai … punch
// to maar hi nahi sakta").
//
// The crowd (three/citypeople.ts) stepped aside for the player, but nothing stopped the player walking straight through a
// person, and nothing took a punch. Now: pushOut() keeps the player outside every standing person (the open world calls it
// every frame, like the traffic's), and hit() — the Attack button in the open world — knocks the person in front down; they
// lie DOWN_SECONDS, get up and walk on; CITIZEN_HIT is announced and street danger counts it as an assault (wanted stars).
// Runs the REAL generated kit with the real three.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_OPEN_WORLD_STARTER, GAME_STREET_DANGER_FEATURE, OPEN_WORLD_BRIDGE_PATH, generateOpenWorld } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-solid-people-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let C: any; let P: any;
beforeAll(async () => {
  (globalThis as any).window ??= { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  C = await import(join(DIR, 'src/game/three/city.ts'));
  P = await import(join(DIR, 'src/game/three/citypeople.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A city standing somewhere on a map (moved and turned, as an open world places one), with its crowd. */
function town() {
  const scene = new THREE.Scene();
  const city = C.createCity({ seed: 5, blocksX: 2, blocksZ: 2, tier: 'light' });
  city.root.position.set(1200, 0, -800); city.root.rotation.y = 0.7;
  scene.add(city.root);
  const people = P.createCityPeople(city, { count: 6, tier: 'light' });
  city.root.add(people.root);
  const player = new THREE.Object3D(); scene.add(player);
  people.update(0.016, []);
  const worldOf = (w: any) => people.root.localToWorld(new THREE.Vector3(w.x, 0, w.z));
  return { scene, city, people, player, worldOf };
}

describe('🧍 nobody walks through a person', () => {
  it('🔴 the player standing inside a person is pushed out, in a city that is moved and turned on the map', () => {
    const t = town();
    const w = t.people.walkers[0];
    const at = t.worldOf(w);
    t.player.position.set(at.x + 0.05, 0, at.z);
    expect(t.people.pushOut(t.player, 0.4)).toBe(true);
    const after = t.worldOf(w);
    expect(Math.hypot(t.player.position.x - after.x, t.player.position.z - after.z)).toBeGreaterThanOrEqual(0.65 - 1e-6);
    expect(t.people.pushOut(t.player, 0.4)).toBe(false);              // already outside: nothing moves
  });
});

describe('👊 a punch lands', () => {
  it('🔴 the person in front falls (where, in WORLD metres, is returned), lies there, gets up and walks on', () => {
    const t = town();
    const w = t.people.walkers[1];
    const at = t.worldOf(w);
    const from = new THREE.Vector3(at.x, 0, at.z - 1);                  // one metre behind them, facing +Z (yaw 0) at them
    for (const o of t.people.walkers) if (o !== w) { o.x += 50; o.z += 50; }
    const fell = t.people.hit(from, 0);
    expect(fell).not.toBeNull();
    expect(Math.hypot(fell.x - at.x, fell.z - at.z)).toBeLessThan(1e-6);
    expect(w.state).toBe('down');
    expect(t.people.hit(from, 0)).toBeNull();                           // a person on the ground is not hit again
    expect(t.people.pushOut(new THREE.Object3D(), 0.4)).toBe(false);
    for (let i = 0; i < Math.ceil(P.DOWN_SECONDS / 0.1) + 1; i++) t.people.update(0.1, []);
    expect(w.state).not.toBe('down');
  });
  it('a punch thrown the other way, or from too far, hits nobody', () => {
    const t = town();
    const w = t.people.walkers[2];
    for (const o of t.people.walkers) if (o !== w) { o.x += 50; o.z += 50; }
    const at = t.worldOf(w);
    expect(t.people.hit(new THREE.Vector3(at.x, 0, at.z - 1), Math.PI)).toBeNull();   // facing away
    expect(t.people.hit(new THREE.Vector3(at.x, 0, at.z - 5), 0)).toBeNull();         // out of reach
    expect(w.state).not.toBe('down');
  });
});

describe('🔒 the open world uses it, and a knocked-down passer-by is a crime', () => {
  it('every frame on foot: pushOut, and hit on the Attack button', () => {
    const src = generateOpenWorld().files[OPEN_WORLD_BRIDGE_PATH] ?? GAME_OPEN_WORLD_STARTER;
    expect(src).toMatch(/if \(!seated && t\.people\) \{\s*t\.people\.pushOut\(ctx\.player\.object, 0\.4\);\s*const fell = punched \? t\.people\.hit\(/);
    expect(src).toMatch(/if \(fell\) \{ try \{ events\.emit\('CITIZEN_HIT', \{ position:/);
    expect(src).toMatch(/const punched = !seated && !![\s\S]{0,120}?\.input\?\.wasPressed\?\.\('attack'\);/);
  });
  it('street danger turns CITIZEN_HIT into an assault', () => {
    expect(GAME_STREET_DANGER_FEATURE).toMatch(/events\.on\('CITIZEN_HIT', \(\) => wanted\.commit\('assault'\)\)/);
  });
});
