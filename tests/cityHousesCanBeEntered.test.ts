// CITY HOUSES CAN BE ENTERED — WHEN THE USER ASKS (admin 2026-11-26, open-world problem #3: "jaise user bole — ghar me game
// open karo, to painted gate ko real gate banao, aur ghar andar se khokhla hota hi hai, hero andar chala jayega").
//
// A city house was one solid shell with its door painted on. CityOptions.enterableHouses (OpenWorldOptions.enterableHouses,
// set in src/game/world.ts by the platform when the user asks — housesTurn.ts) makes every HOUSE lot the kit's enterable
// house from #4535's buildings kit: a real door, hollow rooms, walls that collide. Off, nothing changes. The city's random
// draws are kept, so the rest of the city is exactly the same. Runs the REAL generated kit with the real three.js.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { asksForEnterableHouses, withEnterableHouses, housesAtTurnStart, WORLD_FILE, OPEN_WORLD_KIT, CITY_KIT } from '../src/server/AgentV3/buildPhases/housesTurn';

const fixture = join(__dirname, `.tmp-city-houses-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let buildings: any, collision: any, character: any, city: any;
beforeAll(async () => {
  vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
  for (const { files } of [generateGameRuntime(), generateGame3D(), generateGameController()]) for (const [path, source] of Object.entries(files)) {
    const file = join(fixture, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, source);
  }
  buildings = await import(join(fixture, 'src/game/three/buildings.ts'));
  collision = await import(join(fixture, 'src/game/three/collision.ts'));
  character = await import(join(fixture, 'src/game/play/character.ts'));
  city = await import(join(fixture, 'src/game/three/city.ts'));
}, 120_000);
afterAll(() => rmSync(fixture, { recursive: true, force: true }));
const still = { moveX: 0, moveZ: 0, sprint: false, jumpPressed: false, jumpHeld: false };

describe('🚪 a city whose houses can be entered', () => {
  it('every house lot is an enterable house with a real door; nothing else in the city changes', () => {
    const off = city.createCity({ seed: 4, blocksX: 3, blocksZ: 3, style: 'town', tier: 'light' });
    const on = city.createCity({ seed: 4, blocksX: 3, blocksZ: 3, style: 'town', tier: 'light', enterableHouses: true });
    const lots = on.plan.lots.filter((l: any) => l.kind === 'house');
    expect(lots.length).toBeGreaterThan(2);
    expect(off.houses).toEqual([]);
    expect(on.houses.length).toBe(lots.length);
    for (const h of on.houses) expect(buildings.houseDoor(h)).toBeTruthy();
    expect(JSON.stringify(on.plan)).toBe(JSON.stringify(off.plan));          // the same city, lot for lot
    // The rest of the city drew the same (the random draws were kept): the same park trees and lamps, by name and count.
    const inHouse = (o: any) => { for (let p = o; p; p = p.parent) if (String(p.name).startsWith('City house')) return true; return false; };
    // Everything except the merged building batches (the houses left them) and the houses themselves: streets, pavements,
    // park trees, lamps — by name and count.
    const names = (c: any) => { const n: string[] = []; c.root.traverse((o: any) => { if (o.isMesh && !inHouse(o)) n.push(o.name); }); return n.filter((x) => !/^(buildings|details|windows|facades)$/.test(x)).sort(); };
    expect(names(on)).toEqual(names(off));
    off.dispose(); on.dispose();
  });

  it('🔴 the hero walks in through the door once it opens — and the closed door stops him', () => {
    const scene = new THREE.Scene();
    const c = city.createCity({ seed: 4, blocksX: 3, blocksZ: 3, style: 'town', tier: 'light', enterableHouses: true });
    scene.add(c.root);
    const ground = new THREE.Mesh(new THREE.BoxGeometry(400, 0.2, 400)); ground.position.y = -0.1; scene.add(collision.markWorldCollider(ground));
    const house = c.houses.find((h: any) => Math.abs(h.rotation.y) < 1e-6);          // a house whose door faces +Z
    expect(house).toBeTruthy();
    scene.updateMatrixWorld(true);
    const door = buildings.houseDoor(house);
    const box = new THREE.Box3().setFromObject(house);
    const front = box.max.z, mid = (box.min.z + box.max.z) / 2;
    const player = new character.CharacterController(); scene.add(player.object);
    const doorX = house.position.x;
    player.reset(doorX, house.position.y + 0.2, front + 1.5);
    for (let i = 0; i < 90; i++) player.update(1 / 60, { ...still, moveZ: -1 });
    expect(player.object.position.z).toBeGreaterThan(front - 0.3);                  // closed: stopped at the door
    door.setOpen(true); for (let i = 0; i < 60; i++) door.update(1 / 60);
    for (let i = 0; i < 150; i++) player.update(1 / 60, { ...still, moveZ: -1 });
    expect(player.object.position.z).toBeLessThan(front - 1);                       // inside
    expect(player.object.position.z).toBeGreaterThan(box.min.z);                    // and still within the walls
    void mid;
    c.dispose();
  });
});

describe('🗣️ "ghar ke andar jaana hai" switches it on — only when asked, only where the kit can', () => {
  it('reads the wish in Hindi, Hinglish and English; a house to BUILD is not a wish to enter', () => {
    for (const s of ['ghar me game open karo', 'ghar ke andar ja sake hero', 'make the houses enterable', 'gharon ka darwaza khule', 'घर के अंदर जाना है', 'painted gate ko real gate banao ghar ka']) expect(asksForEnterableHouses(s), s).toBe(true);
    for (const s of ['ek ghar banao', 'make the city bigger', 'add more houses', 'open the map']) expect(asksForEnterableHouses(s), s).toBe(false);
  });
  it('WORLD gets enterableHouses: true once; an existing false becomes true', () => {
    const w = "export const WORLD: OpenWorldOptions = {\n  city: true,\n};\n";
    const a = withEnterableHouses(w)!;
    expect(a.source).toMatch(/enterableHouses: true/);
    expect(withEnterableHouses(a.source)!.changed).toBe(false);
    expect(withEnterableHouses("export const WORLD = { enterableHouses: false };")!.source).toContain('enterableHouses: true');
    expect(withEnterableHouses('nothing here')).toBeNull();
  });
  it('the turn: writes it when the kit can, refuses honestly when the game\'s kit copy is older', async () => {
    const world = "export const WORLD: OpenWorldOptions = {\n};\n";
    const run = async (kit: string) => {
      const disk = new Map<string, string>([[WORLD_FILE, world], [OPEN_WORLD_KIT, kit], [CITY_KIT, kit]]);
      const issues: any[] = [];
      const note = await housesAtTurnStart({ prompt: 'ghar ke andar ja sake', filesAtTurnStart: Object.fromEntries(disk), read: async (p) => disk.get(p)!, write: async (p, c) => { disk.set(p, c); }, record: (i) => issues.push(i) });
      return { note, world: disk.get(WORLD_FILE)!, codes: issues.map((i) => i.code) };
    };
    const ok = await run('// knows enterableHouses');
    expect(ok.world).toMatch(/enterableHouses: true/);
    expect(ok.codes).toEqual(['HOUSES_ENTERABLE']);
    expect(ok.note).toMatch(/ALREADY DONE BY THE PLATFORM/);
    const old = await run('// an older kit');
    expect(old.world).toBe(world);
    expect(old.codes).toEqual(['HOUSES_NOT_ENTERABLE']);
    expect(old.note).toMatch(/Do NOT fake it/);
  });
  it('🔒 the route runs it at the start of a turn, its write counted as the platform\'s', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/buildPrompt = withPlatformHandoff\(await housesAtTurnStart\(\{ skip: isImportTurn \|\| !!projectModuleRef, prompt, filesAtTurnStart: projectFilesAtTurnStart,[\s\S]{0,300}?preseededGolden\.set\(p, c\);/);
  });
});
