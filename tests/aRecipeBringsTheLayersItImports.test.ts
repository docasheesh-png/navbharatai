// AUTOPSY 6a55d939 + 26b03113 (2026-09-30) — "Build a app like god of war", Weak tier.
//
// The builder ran the game recipes and skipped generate_game_3d. generate_game_shell wrote a Game.ts
// importing ./three/{renderer,lighting,materials,camera}; generate_game_systems wrote a spawner importing
// ../three/world. The model wrote those files by hand with other APIs, and the next build spent 11 minutes
// and ₹402.68 reconciling them. Meanwhile our missing-import healer "added" imports to three correct recipe
// files on every run, and the recipe re-runs undid it. Measured with real tsc on the recipes' output: all
// seven together had one error (a 'cloth' surface the 3D recipe does not define); without the 3D layer,
// five. These lock all three fixes.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GAME_RECIPES, recipeFilePool, missingLayerFiles, missingLayersNote, relativeImports, resolveInPool,
} from '../src/server/lib/gameRecipeLayers';
import { addMissingProjectImports } from '../src/server/AgentV3/ImportExportReconcile';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const all = (): Record<string, string> => Object.assign({}, ...Object.values(GAME_RECIPES).map((g) => g().files));
const filesOf = (...names: string[]): Record<string, string> => Object.assign({}, ...names.map((n) => GAME_RECIPES[n]().files));

describe('a recipe brings the layers it imports', () => {
  it('the report\'s exact run — every recipe but generate_game_3d — is missing precisely the 3D files, and gets them', () => {
    const ran = filesOf('generate_game_runtime', 'generate_game_controller', 'generate_game_systems', 'generate_game_vfx', 'generate_melody', 'generate_game_shell');
    const missing = missingLayerFiles(ran, new Set(Object.keys(ran)));
    expect([...missing.keys()].sort()).toEqual([
      'src/game/three/camera.ts', 'src/game/three/lighting.ts', 'src/game/three/materials.ts',
      'src/game/three/renderer.ts', 'src/game/three/world.ts',
    ]);
    expect([...missing.values()].every((f) => f.recipe === 'generate_game_3d')).toBe(true);
    expect(missing.get('src/game/three/renderer.ts')!.content).toBe(GAME_RECIPES.generate_game_3d().files['src/game/three/renderer.ts']);
  });

  it('a file the project already has is never replaced', () => {
    const shell = filesOf('generate_game_shell');
    const present = new Set(['src/game/three/renderer.ts']);
    expect(missingLayerFiles(shell, present).has('src/game/three/renderer.ts')).toBe(false);
  });

  it('the recipe set is closed: every relative import in every recipe resolves to a file some recipe writes', () => {
    const pool = recipeFilePool();
    const dangling: string[] = [];
    for (const [path, content] of Object.entries(all())) {
      for (const spec of relativeImports(content)) {
        if (/\.css$/.test(spec)) continue;
        if (!resolveInPool(path, spec, pool)) dangling.push(`${path} → ${spec}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it('with every recipe present, nothing is missing', () => {
    const everything = all();
    expect(missingLayerFiles(everything, new Set(Object.keys(everything))).size).toBe(0);
  });

  it('the note names the recipe, the files and the dependency, and tells the model not to write its own', () => {
    const shell = filesOf('generate_game_shell');
    const note = missingLayersNote(missingLayerFiles(shell, new Set(Object.keys(shell))));
    expect(note).toContain('generate_game_3d (not run yet)');
    expect(note).toContain('src/game/three/renderer.ts');
    expect(note).toMatch(/add the dependency: three@/);
    expect(note).toContain('do NOT write your own versions');
  });
});

describe('the 3D recipe only asks for surfaces it defines', () => {
  it('every literal passed to shared()/surfaceMaterial() is a SurfaceKind', () => {
    const src = read('src/server/lib/Game3DGenerator.ts');
    const union = src.match(/export type SurfaceKind =([\s\S]*?);/)![1];
    const kinds = new Set([...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]));
    const used = [...src.matchAll(/(?:shared|surfaceMaterial)\('([a-z]+)'/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(5);
    expect(used.filter((k) => !kinds.has(k))).toEqual([]);
  });
});

describe('the missing-import healer does not touch correct recipe code', () => {
  it('adds nothing to the whole recipe set (it added state/load imports to motor, ai and audio on every run)', async () => {
    const r = await addMissingProjectImports(all());
    expect(r.added).toEqual([]);
  });

  it('a member\'s own name is not a use — but a real bare use still is', async () => {
    const files = {
      'src/core/state.ts': 'export const state = { score: 0 };\n',
      'src/a.ts': 'interface M { state: number }\nclass A { load(): void {} state = 1 }\nexport const x = { state: 1 };\n',
      'src/b.ts': 'export function f() { return state.score; }\n',
    };
    const r = await addMissingProjectImports(files);
    expect(r.added.map((a) => a.file)).toEqual(['src/b.ts']);
  });
});

describe('the dispatcher', () => {
  class Act implements ActuatorPort {
    files = new Map<string, string>();
    async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
    async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
    async listFiles() { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
  }
  const make = () => { const act = new Act(); const stream = new AgentEventStream(); return { act, d: new ToolDispatcher(act, 'ws-recipe', new WorkspaceState(stream), stream) }; };

  it('generate_game_shell on a project without the 3D layer writes it and says so', async () => {
    const { act, d } = make();
    const res = await d.dispatch({ id: 't1', name: 'generate_game_shell', input: {} }, 'architect');
    expect(act.files.has('src/game/three/renderer.ts')).toBe(true);
    expect(String(res.content)).toContain('LAYERS ADDED');
  });

  it('running a recipe again reports its files unchanged instead of "Updated"', async () => {
    const { d } = make();
    await d.dispatch({ id: 't1', name: 'generate_game_runtime', input: {} }, 'architect');
    const again = String((await d.dispatch({ id: 't2', name: 'generate_game_runtime', input: {} }, 'architect')).content);
    expect(again).toContain('Unchanged src/game/core/loop.ts');
    expect(again).not.toMatch(/Updated src\/game\/core/);
  });
});

function read(p: string): string { return readFileSync(p, 'utf8'); }
