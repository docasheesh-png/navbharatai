/**
 * 🌄 Admin 2026-11-26 list #20: "real 3D graphics jab user kahe". Every game had one look and a request for realistic
 * graphics had nowhere to go. three/realism.ts (shell option graphics: 'real') lights with a studio environment and soft
 * shadows on every device, and adds ambient occlusion and a subtle bloom only on a capable one. Runs the REAL emitted module
 * (its passes are three's own) against a renderer stand-in; the request reader and the first build are checked too.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D, GAME_3D_MODULES } from '../src/server/lib/Game3DGenerator';
import { realGraphicsWanted, GAME_REALISM_PATH } from '../src/server/lib/GameRealismGenerator';
import { openWorldAppSource } from '../src/server/lib/GameOpenWorldGenerator';
import { gameKitRecipeInput } from '../src/server/AgentV3/gameKitSeed';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

const GAME_SHELL = generateGameShell(['game']).files['src/game/Game.ts'];

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-realism-${process.pid}`);
let R: any;
beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGame3D(['realism']).files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  R = await import(join(DIR, GAME_REALISM_PATH));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** What the module touches on a renderer (no GPU here): size, pixel ratio, shadow map, render. */
function fakeRenderer() {
  return {
    shadowMap: { enabled: false, type: 0 as number },
    getSize: (v: THREE.Vector2) => v.set(800, 450),
    getPixelRatio: () => 1,
    render: () => {}, setRenderTarget: () => {}, getRenderTarget: () => null, setSize: () => {},
  } as any;
}
function sceneWithSun() {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  scene.add(sun);
  return { scene, sun };
}

describe('#20 the real look', () => {
  it('ships in the 3D kit with the device-tier check it reads', () => {
    expect(GAME_3D_MODULES).toContain('realism');
    expect(Object.keys(generateGame3D(['realism']).files)).toEqual(expect.arrayContaining([GAME_REALISM_PATH, 'src/game/three/surfaces.ts']));
  });

  it('a capable device: soft 2048 shadows from every sun, and three\'s own AO, a subtle bloom and the output pass', () => {
    const r = fakeRenderer(); const { scene, sun } = sceneWithSun();
    const env = new THREE.Texture();
    const look = R.applyRealism(r, scene, new THREE.PerspectiveCamera(), { tier: 'full', environment: env });
    expect(look.post).toBe(true);
    expect(look.passes).toEqual(['render', 'ao', 'bloom', 'output']);
    expect(r.shadowMap.enabled).toBe(true);
    expect(r.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.x).toBe(2048);
    expect(scene.environment).toBe(env);              // metal, glass and paint reflect it
    look.dispose();
    expect(scene.environment).toBeNull();
  });

  it('a weak device keeps the lighting and shadows and runs no passes (never a slideshow)', () => {
    const r = fakeRenderer(); const { scene, sun } = sceneWithSun();
    let drew = 0; r.render = () => { drew++; };
    const look = R.applyRealism(r, scene, new THREE.PerspectiveCamera(), { tier: 'light', environment: null });
    expect(look.post).toBe(false);
    expect(look.passes).toEqual([]);
    expect(sun.shadow.mapSize.x).toBe(1024);
    look.render(scene, new THREE.PerspectiveCamera());
    expect(drew).toBe(1);                              // the plain render call
  });

  it('bloom 0 and ao false leave them out', () => {
    const look = R.applyRealism(fakeRenderer(), sceneWithSun().scene, new THREE.PerspectiveCamera(), { tier: 'full', environment: null, bloom: 0, ao: false });
    expect(look.passes).toEqual(['render', 'output']);
  });

  it('the shell draws through it only when graphics is real, follows the canvas size, and disposes it', () => {
    expect(GAME_SHELL).toMatch(/if \(options\.graphics === 'real'\) \{ try \{ this\.realism = applyRealism\(this\.renderer, this\.scene, this\.rig\.camera\)/);
    expect(GAME_SHELL).toMatch(/else if \(this\.realism\) \{[\s\S]{0,300}this\.realism\.setSize\(sz\.x, sz\.y\)[\s\S]{0,80}this\.realism\.render\(this\.scene, this\.rig\.camera\)/);
    expect(GAME_SHELL).toMatch(/if \(this\.realism\) safe\(\(\) => this\.realism!\.dispose\(\)\)/);
  });
});

describe('#20 only when the user asks', () => {
  it('reads the request in the words users type, and a refusal', () => {
    for (const p of ['real 3D graphics wala game', 'realistic city game banao', 'HD graphics chahiye', 'asli jaisa dikhe', 'GTA jaise high graphics']) expect(realGraphicsWanted(p), p).toBe(true);
    for (const p of ['ek 3D city game', 'simple graphics rakho', 'realistic graphics nahi chahiye', 'a real fun game']) expect(realGraphicsWanted(p), p).toBe(false);
  });
  it('the first open-world build asks the game for it', () => {
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'open world realistic graphics wala')).toMatchObject({ graphics: 'real' });
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'open world')).not.toHaveProperty('graphics');
    expect(openWorldAppSource({ graphics: 'real' })).toContain("options={{ graphics: 'real' }}");
    expect(openWorldAppSource({ graphics: 'real', cinematics: { death: true } })).toContain("options={{ cinematics: { death: true }, graphics: 'real' }}");
  });
});
