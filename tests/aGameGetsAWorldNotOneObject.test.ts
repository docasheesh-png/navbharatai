/**
 * L3 step 4 (admin 2026-11-04): "downloaded assets create complete, playable environments — not just isolated
 * objects". A racing game used to get a road and nothing beside it unless the prompt named "trees".
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { sceneryFor, generateWorldDressingModule } from '../src/server/AgentV3/gameAssets/worldDressing';
import { REVIEWED_GAME_ASSETS } from '../src/server/AgentV3/gameAssets/providers';

describe('the scenery a kind of game needs', () => {
  it('racing, city racing, shooting, village (Hindi), train and open world each get their own set', () => {
    expect(sceneryFor('make a car racing game')).toEqual({ layout: 'roadside', subjects: ['tree', 'rock', 'bush', 'building'] });
    expect(sceneryFor('city street racing game')?.subjects).toEqual(['building', 'streetlight', 'tree', 'bush']);
    expect(sceneryFor('a 3D shooting game')).toEqual({ layout: 'range', subjects: ['target', 'barrel', 'wall'] });
    expect(sceneryFor('गाँव वाला खेल बनाओ')?.layout).toBe('village');
    expect(sceneryFor('train simulator game')?.subjects).toContain('hill');
    expect(sceneryFor('open world adventure game')?.layout).toBe('village');
  });
  it('🔒 only subjects the reviewed catalogue serves, and nothing for games that are not a world', () => {
    const served = new Set(REVIEWED_GAME_ASSETS.flatMap((a) => a.subjects));
    for (const p of ['car racing', 'city racing', 'shooting game', 'village game', 'train game', 'open world rpg']) {
      for (const s of sceneryFor(p)?.subjects ?? []) expect(served.has(s), `${p}: ${s}`).toBe(true);
    }
    for (const p of ['a sudoku puzzle', 'a chess game', 'quiz app', 'boxing game']) expect(sceneryFor(p), p).toBeNull();
  });
});

describe('🔴 the built game’s dressWorld — run for real', () => {
  const load = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-dress-'));
    mkdirSync(join(dir, 'node_modules', 'three'), { recursive: true });
    // Minimal stand-ins for three.js and the asset runtime: dressWorld's own logic is what is under test.
    writeFileSync(join(dir, 'node_modules', 'three', 'package.json'), JSON.stringify({ name: 'three', type: 'module', main: 'index.js' }));
    writeFileSync(join(dir, 'node_modules', 'three', 'index.js'), `export class Group { constructor(){ this.children=[]; this.position={set:(x,y,z)=>{this.position.x=x;this.position.y=y;this.position.z=z;}}; this.rotation={y:0}; } add(c){ this.children.push(c); } clone(){ const g=new Group(); g.src=this.src; return g; } }`);
    writeFileSync(join(dir, 'assetModels.ts'), `import { Group } from 'three';\nexport async function loadRequestedAsset(s: string, fb: () => any) { if (s === 'missing') return fb(); const g: any = new Group(); g.src = s; return { root: g, source: 'model', update() {}, dispose() {} }; }`);
    writeFileSync(join(dir, 'externalAssets.ts'), `export type GameAssetHandle = any;`);
    return { dir, write: (subjects: string[], layout: any) => { const f = join(dir, `dress-${subjects.join('-')}-${layout}.ts`); writeFileSync(f, generateWorldDressingModule(subjects, layout)); return f; } };
  };
  it('roadside: bounded, deterministic, never on the road, sitting on the terrain', async () => {
    const { dir, write } = await load();
    try {
      const mod = await import(pathToFileURL(write(['tree', 'rock', 'missing'], 'roadside')).href);
      const plan1 = mod.planDressing(['tree', 'rock'], { count: 40, roadHalfWidth: 5 }); const plan2 = mod.planDressing(['tree', 'rock'], { count: 40, roadHalfWidth: 5 });
      expect(plan1).toEqual(plan2);
      expect(plan1.length).toBe(40);
      expect(plan1.every(([, x]: number[]) => Math.abs(x) >= 8)).toBe(true); // 5 m half-width + 3 m clearance
      const scene: any = new (await import(pathToFileURL(join(dir, 'node_modules/three/index.js')).href)).Group();
      const placed = await mod.dressWorld(scene, { count: 30, heightAt: (x: number) => 0.1 * Math.abs(x) });
      expect(placed).toBe(30);
      const clones = scene.children[0].children;
      expect(new Set(clones.map((c: any) => c.src))).toEqual(new Set(['tree', 'rock'])); // the missing model is skipped, never substituted
      expect(clones.every((c: any) => Math.abs(c.position.y - 0.1 * Math.abs(c.position.x)) < 1e-9)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('accept() keeps the play space clear; village rings the centre; range is in front of the player', async () => {
    const { dir, write } = await load();
    try {
      const v = await import(pathToFileURL(write(['house', 'tree'], 'village')).href);
      const ring = v.planDressing(['house', 'tree'], { count: 50, accept: (x: number, z: number) => Math.hypot(x, z) > 14 });
      expect(ring.every(([, x, z]: number[]) => Math.hypot(x, z) > 14)).toBe(true);
      const r = await import(pathToFileURL(write(['target', 'barrel'], 'range')).href);
      const range = r.planDressing(['target', 'barrel'], { count: 40 });
      expect(range.every(([, , z]: number[]) => z <= -10)).toBe(true); // all in front of the player
      // 🔴 The firing lane stays open: every target is IN it, no cover is (walls once hid every target).
      expect(range.filter(([i]: number[]) => i === 0).every(([, x, z]: number[]) => Math.abs(x) <= 5 && z <= -25)).toBe(true);
      expect(range.filter(([i]: number[]) => i === 1).every(([, x]: number[]) => Math.abs(x) >= 6)).toBe(true);
      expect(r.planDressing(['target', 'barrel'], { count: 500 }).length).toBeLessThanOrEqual(120); // bounded for phones
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
