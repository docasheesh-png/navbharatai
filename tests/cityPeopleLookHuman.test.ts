// CITY PEOPLE LOOK HUMAN (admin 2026-11-25, open-world problem #7: "villeges human jaise nahi … gol cylinder ke upar ek ball").
// A person in the crowd is a torso with arms, two legs with shoes, a neck, a head and hands — shirt, trousers and skin each
// one instanced part for the whole crowd, so a hundred people are still three draw calls. The look takes no random numbers,
// so the same seed walks the same crowd (cityPeopleWalkSafely). Runs the REAL generated kit.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_CITY_PEOPLE } from '../src/server/lib/GameCityPeopleGenerator';

const DIR = join(__dirname, `.tmp-human-people-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let C: any; let P: any;
beforeAll(async () => {
  (globalThis as any).window ??= { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  C = await import(join(DIR, 'src/game/three/city.ts'));
  P = await import(join(DIR, 'src/game/three/citypeople.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('🧍 a person, not a cylinder with a ball', () => {
  it('three instanced parts — shirt, trousers, skin — for 100 people; no cylinder anywhere', () => {
    const city = C.createCity({ seed: 3, blocksX: 2, blocksZ: 2, tier: 'full' });
    const people = P.createCityPeople(city, { count: 100, tier: 'full' });
    const meshes: any[] = [];
    people.root.traverse((o: any) => { if (o.isMesh) meshes.push(o); });
    expect(meshes.map((m) => m.name).sort()).toEqual(['people', 'people heads', 'people legs']);
    expect(meshes.every((m) => m.isInstancedMesh && m.count === 100)).toBe(true);
    expect(meshes.some((m) => m.geometry.type === 'CylinderGeometry')).toBe(false);
    people.dispose(); city.dispose();
  });
  it('built like a person: legs to the hips, torso to the shoulders, the head on top, arms beside the torso', () => {
    const city = C.createCity({ seed: 3, blocksX: 2, blocksZ: 2, tier: 'light' });
    const people = P.createCityPeople(city, { count: 1, tier: 'light' });
    const box = (name: string) => { let g: any; people.root.traverse((o: any) => { if (o.name === name) g = o.geometry; }); g.computeBoundingBox(); return g.boundingBox as THREE.Box3; };
    const legs = box('people legs'), body = box('people'), skin = box('people heads');
    expect(legs.min.y).toBeLessThanOrEqual(0.01); expect(legs.max.y).toBeGreaterThan(0.8); expect(legs.max.y).toBeLessThan(0.9);
    expect(body.min.y).toBeGreaterThan(0.8); expect(body.max.y).toBeCloseTo(1.4, 2);
    expect(body.max.x - body.min.x).toBeGreaterThan(0.55);                 // arms beside the torso, wider than a cylinder
    expect(skin.max.y).toBeGreaterThan(1.65); expect(skin.max.y).toBeLessThan(1.8);
    people.dispose(); city.dispose();
  });
  it('the look takes no random numbers (the same seed walks the same crowd)', () => {
    expect(GAME_CITY_PEOPLE).toMatch(/legs\.setColorAt\(k, colour\.setHex\(trousers\[\(k \* 5 \+ 2\) % trousers\.length\]\)\)/);
  });
});
