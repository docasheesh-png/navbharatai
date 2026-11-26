/**
 * 🚪 Admin 2026-11-26 list #2: "bina gate wala painted door wala ghar … user kahe to andar ja sake". A city lot was part of
 * its block's merged geometry with a painted door, so nothing could open it. city.openLot redraws only that block without
 * the lot's ground floors and stands a real walk-in building there (three/buildings.ts: a door that swings with Use, a
 * hollow inside, a floor to stand on), facing its street; a tall building keeps its upper floors. Runs the REAL emitted kit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { GAME_WORLD_COLLIDER_KEY } from '../src/server/lib/GameAssetRuntimeGenerator';
import { openBuildingsWanted, gameWorldFileSource, GAME_OPEN_WORLD_BRIDGE } from '../src/server/lib/GameOpenWorldGenerator';
import { gameKitRecipeInput } from '../src/server/AgentV3/gameKitSeed';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-open-lot-${process.pid}`);
let C: any; let B: any; let COL: any;
beforeAll(async () => {
  (globalThis as any).window = { addEventListener: () => {} };
  for (const [p, c] of Object.entries(generateGame3D(['city']).files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  C = await import(join(DIR, 'src/game/three/city.ts'));
  B = await import(join(DIR, 'src/game/three/buildings.ts'));
  COL = await import(join(DIR, 'src/game/three/collision.ts'));
}, 60_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).window; });

describe('#2 a city building opens when asked', () => {
  it('the city module brings the walk-in building with it', () => {
    expect(Object.keys(generateGame3D(['city']).files)).toContain('src/game/three/buildings.ts');
  });

  it('openLot: the lot is no longer solid, a walk-in building with a door stands on its footprint facing the street, and only its block is redrawn', () => {
    const city = C.createCity({ blocksX: 3, blocksZ: 3, seed: 4, tier: 'full' });
    const lot = city.plan.lots.find((l: any) => l.kind !== 'park' && l.height > 8);
    expect(lot).toBeTruthy();
    const fp = C.buildingFootprint(lot);
    expect(city.solidAt(fp.x, fp.z, 0.3)).toBe(true);
    const blocksBefore = city.root.children.filter((c: any) => /^City block/.test(c.name)).map((c: any) => c.name).sort();
    const otherBlock = city.root.children.find((c: any) => c.name !== 'City block ' + lot.block.join(',') && /^City block/.test(c.name));
    const house = city.openLot(lot);
    expect(house).toBeTruthy();
    expect(lot.open).toBe(true);
    expect(city.solidAt(fp.x, fp.z, 0.3)).toBe(false);          // the kit no longer treats it as a solid block
    expect(B.houseDoor(house)).toBeTruthy();                       // a real door (opens with Use)
    expect(house.rotation.y).toBe(lot.facing.z > 0 ? 0 : Math.PI);
    expect(Math.hypot(house.position.x - fp.x, house.position.z - fp.z)).toBeLessThan(1e-6);
    expect(city.root.children.filter((c: any) => /^City block/.test(c.name)).map((c: any) => c.name).sort()).toEqual(blocksBefore);
    expect(city.root.children).toContain(otherBlock);              // other blocks untouched (same objects)
    // A tall building keeps its upper floors: the redrawn block still reaches the lot's full height above its footprint.
    const block = city.root.children.find((c: any) => c.name === 'City block ' + lot.block.join(','));
    const box = new THREE.Box3().setFromObject(block);
    expect(box.max.y).toBeGreaterThan(lot.height - 0.5);
    // Opening it again, or a park, does nothing.
    expect(city.openLot(lot)).toBeNull();
    city.dispose();
  });

  it('the walk-in building has a floor to stand on and walls that collide', () => {
    const city = C.createCity({ blocksX: 2, blocksZ: 2, seed: 9, tier: 'full' });
    const lot = city.plan.lots.find((l: any) => l.kind !== 'park');
    const house = city.openLot(lot.id);
    const kinds = new Set<string>();
    house.traverse((o: any) => { const k = o.userData?.[GAME_WORLD_COLLIDER_KEY]; if (k) kinds.add(k); });
    expect(kinds.has('ground')).toBe(true);   // the floor is ground: the player stands on it
    expect(kinds.has('solid')).toBe(true);    // the walls collide
    void COL;
    city.dispose();
  });
});

describe('#2 only when the user asks', () => {
  it('reads the request, writes WORLD.openBuildings, and the open world opens the door the player walks up to', () => {
    expect(openBuildingsWanted('city ke ghar ke andar ja sake')).toBe(true);
    expect(openBuildingsWanted('buildings should be enterable')).toBe(true);
    expect(openBuildingsWanted('ek bada sheher banao')).toBe(false);
    expect(openBuildingsWanted('ghar ke andar mat jane do')).toBe(false);
    expect(gameWorldFileSource({ openBuildings: true })).toContain('openBuildings: true,');
    expect(gameWorldFileSource({})).not.toContain('openBuildings');
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'open world city jisme building ke andar ja sake')).toMatchObject({ openBuildings: true });
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/if \(openBuildings && !seated\)[\s\S]{0,300}t\.city\.openLot\(lot\)/);
  });
});

describe('#2 the reader never fires on words about the map', () => {
  it('failedbr #2485\'s own request ("open-world", "khule maidan", "buildings") does not ask to go inside', () => {
    const R = 'ek bada open-world 3D game banao jisme PUBG, GTA aur racing game teeno ka mazaa ho.\n\n- Bahut bada map ho: shehar ki sadkein, buildings, traffic wali gaadiyan aur footpath par chalte log, shehar ke bahar khule maidan aur pahad.';
    expect(openBuildingsWanted(R)).toBe(false);
    expect(openBuildingsWanted('building ka darwaza khule aur andar ja sake')).toBe(true);
    expect(openBuildingsWanted('open the door of the house')).toBe(true);
  });
});
