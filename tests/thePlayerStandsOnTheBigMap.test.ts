// THE PLAYER STANDS ON THE BIG MAP (failedbr #2485, 2026-11-21 — admin: "is game me to map aya hi nahi, bas ek character aya
// … jo joystick se hawa me move kar raha hai … library ka use kyu nahi ho raha, hona chahiye").
//
// 🔑 ROOT CAUSE. The platform laid the Athree map AND the game shell down, with nothing joining them: the join (a walkable
// ground from the map's height function, the floating origin, level ground under a city) was left to the builder's first
// turn, and a weak builder wrote its own game instead. The user got the shell's player walking on the controller's implicit
// y = 0 with no world under it. 🧬 THE CLASS: two kit layers that only work together, shipped with no code between them.
// This runs the REAL generated kit (map + shell + city + the new bridge) headless and walks the real character controller.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool, GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';
import { generateOpenWorld, openWorldAppSource, OPEN_WORLD_STARTER_PATH, OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { gameKitPlan, gameKitRecipeInput, gameKitHandoffBlock, gameTurnRequest, openWorldOnFoot, openWorldWantsCity, OPEN_WORLD_HANDOFF, ON_FOOT_LINE, CITY_LINE } from '../src/server/AgentV3/gameKitSeed';
import { buildGameContract } from '../src/server/AgentV3/gameIntent';
import { GAME_STARTERS } from '../src/server/lib/gameStarters';
import { RECIPE_TOOLS } from '../src/server/AgentV3/ToolCatalog';

// The REAL request of failedbr #2485 (its first lines).
const REQUEST = 'ek bada open-world 3D game banao jisme PUBG, GTA aur racing game teeno ka mazaa ho.\n\n- Bahut bada map ho: shehar ki sadkein, buildings, traffic wali gaadiyan aur footpath par chalte log, shehar ke bahar khule maidan aur pahad.\n- Mera character joystick se chale, daude aur kude (phone par touch joystick, computer par WASD keys). Camera character ke peeche rahe.';
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const DIR = join(__dirname, `.tmp-openworld-${process.pid}`);

describe('🗺️ the seed plans the join, and mounts it', () => {
  it('the exact #2485 request: the map, the shell, then the open-world starter — with a city', () => {
    const plan = gameKitPlan(REQUEST, 'vite-react');
    expect(plan).toEqual(expect.arrayContaining(['generate_athree_map', 'generate_game_shell', 'generate_open_world']));
    expect(plan.indexOf('generate_open_world')).toBeGreaterThan(plan.indexOf('generate_game_shell'));
    expect(plan.indexOf('generate_open_world')).toBeGreaterThan(plan.indexOf('generate_athree_map'));
    expect(gameKitRecipeInput('generate_open_world', plan, REQUEST)).toEqual({ mount: true, city: true });
  });

  it('on foot only: a race or a flight on the big map keeps its own vehicle; a game with no big map gets no starter', () => {
    expect(openWorldOnFoot(REQUEST)).toBe(true);
    expect(openWorldOnFoot('make a bgmi for me')).toBe(true);
    expect(gameKitPlan('3d flight simulator game banao, plane udao', 'vite-react')).not.toContain('generate_open_world');
    expect(gameKitPlan('ludo game banao', 'vite-react')).not.toContain('generate_open_world');
    expect(gameKitPlan('a 3D car racing game on a track', 'vite-react')).not.toContain('generate_open_world');
  });

  it('a roadmap milestone keeps both answers from the user\'s own request, and adds no feature the user did not ask for', () => {
    const turn = gameTurnRequest(REQUEST, 'Create a basic 3D scene with a ground plane and a player.');
    expect(turn).toContain(ON_FOOT_LINE);
    expect(turn).toContain(CITY_LINE);
    expect(gameKitPlan(turn, 'vite-react')).toContain('generate_open_world');
    expect(gameKitRecipeInput('generate_open_world', gameKitPlan(turn, 'vite-react'), turn)).toEqual({ mount: true, city: true });
    expect(buildGameContract(`Step.\n${ON_FOOT_LINE}\n${CITY_LINE}`).requiredFeatures).toEqual([]);
  });

  it('a city only where the world has one', () => {
    expect(openWorldWantsCity(REQUEST)).toBe(true);
    expect(openWorldWantsCity('ek gta jaisa game banao')).toBe(true);
    expect(openWorldWantsCity('ek bada jungle survival game, kahin bhi ghoom sakun')).toBe(false);
  });

  it('the builder is told the game already plays, and what NOT to write beside it', () => {
    const block = gameKitHandoffBlock(['generate_game_runtime', 'generate_game_3d', 'generate_athree_map', 'generate_game_shell', 'generate_open_world'].map((recipe) => ({ recipe, ok: true, content: '' })) as never, { request: REQUEST });
    expect(block).toContain(OPEN_WORLD_HANDOFF);
    expect(OPEN_WORLD_HANDOFF).toMatch(/no CustomGame, no WorldSetup, no characterController of your own/);
    expect(OPEN_WORLD_HANDOFF).toMatch(/never y = 0/);
  });

  it('the App the platform mounts renders the starter (and a title can never break out of it)', () => {
    expect(openWorldAppSource({ city: true })).toContain('<OpenWorldGame title="Open World" world={{ city: true }} />');
    expect(openWorldAppSource({ title: '"} /><script>x</script>' })).not.toMatch(/<script>/);
  });

  it('🧬 it is a real recipe everywhere a recipe is known: the pool, the catalog, the starters, the dispatcher', () => {
    expect(Object.keys(GAME_RECIPES)).toContain('generate_open_world');
    expect(RECIPE_TOOLS).toContain('generate_open_world');
    expect(recipeFilePool().get(OPEN_WORLD_STARTER_PATH)?.recipe).toBe('generate_open_world');
    expect(GAME_STARTERS.map((s) => s.name)).toContain('OpenWorldGame');
    const dispatcher = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(dispatcher).toMatch(/case 'generate_open_world': \{/);
    // Never a world under an app that has no map; never over an App that already renders a game.
    expect(dispatcher).toMatch(/The open-world starter stands on the Athree map, and this project has none/);
    expect(dispatcher).toMatch(/GameCanvas\|OpenWorldGame\|RacingRoadGame\|LaneRunnerGame/);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('🧍 the real kit, joined: the character walks the map and the city stands on level ground', () => {
  let OW: any; let CH: any; let COL: any;
  beforeAll(async () => {
    const files: Record<string, string> = {};
    for (const [path, f] of recipeFilePool()) if (/^src\/game\//.test(path) && !/\.test\.tsx?$/.test(path)) files[path] = f.content;
    Object.assign(files, generateOpenWorld().files);
    for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
    OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
    CH = await import(join(DIR, 'src/game/play/character.ts'));
    COL = await import(join(DIR, 'src/game/three/collision.ts'));
  }, 120_000);
  afterAll(() => rmSync(DIR, { recursive: true, force: true }));

  const context = () => {
    const scene = new THREE.Scene();
    const player = new CH.CharacterController({});
    scene.add(player.object);
    const added: THREE.Object3D[] = [];
    const ctx = { scene, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), player, vehicles: { add: (v: THREE.Object3D) => { added.push(v); }, seated: null } };
    return { ctx, added, scene, player };
  };
  const walk = (world: any, c: ReturnType<typeof context>, seconds: number, moveX: number, moveZ: number) => {
    for (let i = 0; i < seconds * 60; i++) {
      world.frame(c.ctx, 1 / 60);
      c.player.update(1 / 60, { moveX, moveZ, sprint: false, jumpPressed: false, jumpHeld: false });
    }
  };

  it('open country: the player stands on the map\'s own ground, and stays on it while walking 30 m', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7 });
    walk(world, c, 1, 0, 0);
    const start = world.playerWorld();
    expect(c.player.isGrounded).toBe(true);
    expect(start.y).toBeCloseTo(world.heightAt(start.x, start.z), 0);   // on the terrain — never the implicit y = 0
    expect(Math.abs(start.y)).toBeGreaterThan(0.5);
    walk(world, c, 8, 0, -1);
    const end = world.playerWorld();
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(20);
    expect(c.player.isGrounded).toBe(true);
    expect(Math.abs(end.y - world.heightAt(end.x, end.z))).toBeLessThan(0.6);
    expect(c.ctx.camera.far).toBeGreaterThan(3000);                      // the far terrain is not clipped away
    expect(COL.hasWorldGround(COL.worldColliders(c.scene), c.scene)).toBe(true);
    world.dispose();
  }, 60_000);

  it('a city: level ground under it, nothing growing through it, the player on a street, cars to get into', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, city: { blocksX: 3, blocksZ: 3, traffic: { count: 4 }, people: { count: 6 }, parkedCars: 3 } });
    const town = world.city;
    expect(town).not.toBeNull();
    const plan = town.city.plan;
    // LEVEL: every place under the city is at the city's height (the terrain was levelled before it was drawn).
    const heights: number[] = [];
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) heights.push(world.heightAt(town.centre.x + (i / 4) * plan.width / 2, town.centre.z + (j / 4) * plan.depth / 2));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.01);
    expect(heights[0]).toBeCloseTo(town.centre.y, 2);
    expect(town.centre.y).toBeGreaterThan(1);                            // dry land
    expect(world.map.world.clearAt(town.centre.x, town.centre.z)).toBe(true);   // no trees, no grass through the streets
    // …and it eases back into the land: no cliff at the edge.
    const edge = world.heightAt(town.centre.x + plan.width / 2 + 8 + 30, town.centre.z);
    expect(Math.abs(edge - town.centre.y)).toBeLessThan(40);
    // The player starts on a street and stands on it.
    walk(world, c, 1, 0, 0);
    const at = world.playerWorld();
    expect(town.city.onStreet(at.x - town.centre.x, at.z - town.centre.z)).toBe(true);
    expect(c.player.isGrounded).toBe(true);
    expect(at.y).toBeCloseTo(town.centre.y, 0);
    expect(town.parked).toHaveLength(3);
    expect(c.added).toHaveLength(3);                                     // each one given to ctx.vehicles
    expect(town.traffic.cars.length).toBe(4);
    expect(town.toWorld(0, 0)).toEqual({ x: town.centre.x, z: town.centre.z });
    walk(world, c, 3, 0, -1);
    expect(c.player.isGrounded).toBe(true);
    world.dispose();
  }, 60_000);
});
