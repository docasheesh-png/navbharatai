// A CITY IS LIGHT WITHOUT A GPU (queue Q-2698: every open-world build ended GAME_PLAYTEST_NOT_RUN at 1–4 frames a second in the
// build sandbox's software renderer, and a weak phone hits the same wall). Two root causes, both measured on the real starter:
//   1. The playtest's click asked for POINTER LOCK, and in the automated headless browser that floods the page with synthetic
//      input (36,000 messages a second): 4–9 fps with the lock, 14–16 without it, same scene. The kit no longer asks for the
//      lock in a browser driven by automation (navigator.webdriver) — a person's own browser never sets that flag.
//   2. The city drew ~360 meshes / 85k triangles for one 4 x 4 place — 209 of the meshes were the 12 moving vehicles (17–22
//      parts each). The LIGHT geometry tier draws the same streets, buildings and colliders as 163 meshes / 34k triangles.
// Runs the REAL generated kit headless and counts what is drawn, per tier.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool, relativeImports, resolveInPool } from '../src/server/lib/gameRecipeLayers';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-light-city-${process.pid}`);
const pool = recipeFilePool();
const file = (p: string) => pool.get(p)!.content;
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any; let CITY: any; let TRAFFIC: any; let PEOPLE: any; let COLL: any; let SURF: any; let SET: any;
const g = globalThis as any;
const hadWindow = 'window' in g;
beforeAll(async () => {
  for (const [p, f] of pool) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  CITY = await import(join(DIR, 'src/game/three/city.ts'));
  TRAFFIC = await import(join(DIR, 'src/game/three/citytraffic.ts'));
  PEOPLE = await import(join(DIR, 'src/game/three/citypeople.ts'));
  COLL = await import(join(DIR, 'src/game/three/collision.ts'));
  SURF = await import(join(DIR, 'src/game/three/surfaces.ts'));
  SET = await import(join(DIR, 'src/game/core/settings.ts'));
  if (!hadWindow) g.window = {};
}, 180_000);
afterAll(() => { if (!hadWindow) delete g.window; rmSync(DIR, { recursive: true, force: true }); });

const census = (o: THREE.Object3D) => {
  let meshes = 0, tris = 0;
  o.traverse((c: any) => { if (c.isMesh && c.visible !== false) { meshes++; const geo = c.geometry; tris += ((geo.index ? geo.index.count : geo.attributes.position.count) / 3) * (c.isInstancedMesh ? c.count : 1); } });
  return { meshes, tris: Math.round(tris) };
};
/** The open-world starter's first place, built with the player's Settings as given. */
const starterPlace = (choice: { autoQuality: boolean; quality: 'low' | 'medium' | 'high' }) => {
  SET.settings.set(choice);
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  const ctx = { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
  const world = OW.createOpenWorld(ctx, { seed: 7, regions: [{ id: 'main-city', kind: 'city' }] });
  const region = scene.children.find((c) => /^Region/.test(c.name))!;
  return { world, region, place: world.cities?.[0] ?? world.city };
};

describe('📉 the light tier draws several times less, on the real starter', () => {
  it('full tier: what a device with a GPU always drew (the budget it must not exceed either)', () => {
    const { world, region } = starterPlace({ autoQuality: false, quality: 'high' });
    const c = census(region);
    expect(c.meshes).toBeGreaterThan(300);      // 360 measured: 209 of them the 12 vehicles
    expect(c.meshes).toBeLessThanOrEqual(380);
    expect(c.tris).toBeLessThanOrEqual(90_000);
    world.dispose();
  }, 120_000);

  it('light tier (Settings: Auto off + low): at most half the meshes and 45% of the triangles', () => {
    const full = starterPlace({ autoQuality: false, quality: 'high' }); const f = census(full.region); full.world.dispose();
    const lite = starterPlace({ autoQuality: false, quality: 'low' }); const l = census(lite.region);
    expect(l.meshes).toBeLessThanOrEqual(170);  // 163 measured (68 of them the 4 parked cars the player can drive — kept whole)
    expect(l.tris).toBeLessThanOrEqual(36_000); // 33,992 measured
    expect(l.meshes * 2).toBeLessThanOrEqual(f.meshes);
    expect(l.tris).toBeLessThanOrEqual(f.tris * 0.45);
    const traffic = lite.region.children.find((c) => c.name === 'City traffic')!;
    expect(census(traffic).meshes).toBeLessThanOrEqual(TRAFFIC.LIGHT_TRAFFIC + 3);  // one mesh a vehicle + the lights' 3
    lite.world.dispose();
  }, 120_000);
});

describe('🧱 the light tier changes nothing that can be walked into, stood on or driven past', () => {
  const colliders = (tier: 'full' | 'light') => {
    const city = CITY.createCity({ seed: 11, blocksX: 3, blocksZ: 3, tier });
    const scene = new THREE.Scene(); scene.add(city.root);
    const list = COLL.worldColliders(scene) as THREE.Mesh[];
    const sig = list.map((m) => m.name + ':' + Array.from(m.geometry.getAttribute('position').array as Float32Array).map((v) => v.toFixed(3)).join(',')).sort();
    return { city, sig, list };
  };
  it('the same collider meshes, vertex for vertex (buildings, poles, park trees, pavements, streets)', () => {
    const full = colliders('full'), lite = colliders('light');
    expect(full.list.length).toBeGreaterThan(10);
    expect(lite.sig).toEqual(full.sig);
    expect(lite.city.tier).toBe('light');
    for (let k = 0; k < 40; k++) {
      const x = (k * 37) % 120 - 60, z = (k * 53) % 120 - 60;
      expect(lite.city.solidAt(x, z, 0.5)).toBe(full.city.solidAt(x, z, 0.5));
      expect(lite.city.heightAt(x, z)).toBe(full.city.heightAt(x, z));
    }
    full.city.dispose(); lite.city.dispose();
  });
  it('windows are one textured panel a facade in the light tier, a box each in the full tier', () => {
    const full = CITY.createCity({ seed: 11, tier: 'full' }), lite = CITY.createCity({ seed: 11, tier: 'light' });
    const named = (c: any, n: string) => { let t = 0; c.root.traverse((m: any) => { if (m.isMesh && m.name === n) t += m.geometry.getAttribute('position').count / 3; }); return t; };
    expect(named(full, 'facades')).toBe(0);
    expect(named(lite, 'facades')).toBeGreaterThan(0);
    expect(named(lite, 'windows')).toBeLessThan(named(full, 'windows') / 20);
    let map: any = null; lite.root.traverse((m: any) => { if (m.isMesh && m.name === 'facades') map = m.material.map; });
    expect(map?.isDataTexture).toBe(true);
    full.dispose(); lite.dispose();
  });
});

describe('🚗 traffic and people still work in the light tier', () => {
  it('fewer vehicles, each one mesh, still driving, stopping and pushing the player out', () => {
    const city = CITY.createCity({ seed: 5, tier: 'light' });
    const traffic = TRAFFIC.createCityTraffic(city, { count: 20, tier: 'light' });
    expect(traffic.cars.length).toBe(TRAFFIC.LIGHT_TRAFFIC);
    for (const car of traffic.cars) expect(census(car.object).meshes).toBe(1);
    const start = traffic.cars.map((c: any) => c.object.position.clone());
    for (let i = 0; i < 120; i++) traffic.update(1 / 30);
    expect(traffic.cars.some((c: any, k: number) => c.object.position.distanceTo(start[k]) > 1)).toBe(true);
    const probe = new THREE.Object3D(); city.root.add(probe);
    probe.position.copy(traffic.cars[0].object.position);
    expect(traffic.pushOut(probe)).toBe(true);
    traffic.dispose(); city.dispose();
  });
  it('fewer and plainer people, still walking', () => {
    const city = CITY.createCity({ seed: 5, tier: 'light' });
    const people = PEOPLE.createCityPeople(city, { count: 40, tier: 'light' });
    expect(people.root.children.find((c: any) => c.name === 'people').count).toBe(PEOPLE.LIGHT_PEOPLE);
    const full = PEOPLE.createCityPeople(city, { count: 40, tier: 'full' });
    expect(full.root.children.find((c: any) => c.name === 'people').count).toBe(40);
    people.dispose(); full.dispose(); city.dispose();
  });
});

describe('🎚️ who picks the tier', () => {
  it('the player\'s Settings win; Auto on a device with a GPU (this headless run) stays full', () => {
    expect(SURF.geometryTier({ autoQuality: false, quality: 'low' })).toBe('light');
    expect(SURF.geometryTier({ autoQuality: false, quality: 'medium' })).toBe('full');
    expect(SURF.geometryTier({ autoQuality: false, quality: 'high' })).toBe('full');
    expect(SURF.geometryTier({ autoQuality: true, quality: 'low' })).toBe('full');
    expect(SURF.geometryTier()).toBe('full');
  });
  it('Auto on a software renderer is light (the same detector the shell already reads)', () => {
    const src = file('src/game/three/surfaces.ts');
    expect(src).toMatch(/if \(choice && choice\.autoQuality === false\) return choice\.quality === 'low' \? 'light' : 'full';\s*if \(softwareRenderer\(\)\) return 'light';/);
  });
  it('the open world reads it as each place is built and hands the city\'s tier to its traffic and people', () => {
    const ow = file(OPEN_WORLD_BRIDGE_PATH);
    expect(ow).toContain('const tier = geometryTier(settings.get());');
    expect(ow).toContain('createCity({ tier, ...p.cityOptions })');
    expect(ow).toMatch(/createCityTraffic\(city, \{ count: p\.preset\.traffic, tier: city\.tier,/);
    expect(ow).toMatch(/createCityPeople\(city, \{ traffic, count: p\.preset\.people, tier: city\.tier,/);
  });
});

describe('🖱️ no pointer lock in a browser driven by automation', () => {
  it('the shell skips the lock when navigator.webdriver is set — and only then', () => {
    const game = file('src/game/Game.ts');
    expect(game).toContain("if (this.options.pointerLock === false || touchDevice() || automatedBrowser()) return;");
    expect(game).toMatch(/function automatedBrowser\(\): boolean \{\s*try \{ return typeof navigator !== 'undefined' && \(navigator as Navigator & \{ webdriver\?: boolean \}\)\.webdriver === true; \}/);
  });
});

describe('📦 a city asked for on its own still arrives with everything it imports', () => {
  // The tier lives in surfaces.ts. The first version of this change shipped generateGame3D(['city']) without it (caught by
  // aCityHasStreetsAndBlocks: "Cannot find module './surfaces'"). Every import of a 3D-kit module must arrive with it.
  it.each([['city'], ['citytraffic'], ['citypeople']])('%s', (mod: string) => {
    const files = generateGame3D([mod]).files;
    const pool = new Map(Object.entries(FULL_3D).map(([p, c]) => [p, { content: c }])) as never;
    for (const [path, content] of Object.entries(files)) {
      for (const spec of relativeImports(content)) {
        const target = resolveInPool(path, spec, pool);
        if (target) expect(files[target], path + ' imports ' + spec).toBeDefined();
      }
    }
  });
});
const FULL_3D = generateGame3D().files;
