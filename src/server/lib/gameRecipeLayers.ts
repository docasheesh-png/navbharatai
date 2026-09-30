// A GAME RECIPE MAY NOT HAND OVER CODE THAT IMPORTS A LAYER NOBODY WROTE.
//
// 🔴 AUTOPSY 6a55d939 (2026-09-30, "Build a app like god of war", Weak tier). The builder ran the game
// recipes in order — runtime, controller, systems, vfx, melody, shell — and skipped `generate_game_3d`
// (step 2 of the prompt's own list). `generate_game_shell` wrote a `Game.ts` that imports
// `./three/renderer`, `./three/lighting`, `./three/materials` and `./three/camera`, and
// `generate_game_systems` wrote a `spawner.ts` that imports `../three/world` — all files only
// `generate_game_3d` produces. Measured by writing every recipe's output into a real project and running
// `tsc`: with the 3D layer present the set has ONE error (a separate bug, fixed in Game3DGenerator);
// without it, five, all "Cannot find module". The model then wrote the four three/ files by hand with
// different APIs, and the next build spent 11 minutes and ₹402.68 of a free user's balance reconciling
// Game.ts with them.
//
// 🔑 THE CLASS: each recipe knows which files it WRITES and nothing about which files it NEEDS. A layer
// is a precondition of the recipes that import it, and a precondition the model has to remember is one
// it will eventually forget. So the dispatcher now asks, after every recipe: do the files just written
// import a recipe-owned file the project does not have? If so, that layer's own files are written too —
// the exact content its recipe produces, never a guess — and the tool result says so.
//
// 🔒 NEVER OVERWRITES. Only paths ABSENT from the workspace are added, so a layer the model or the user
// has already written (or edited) is left exactly as it is.
//
// PURE — no I/O. The dispatcher supplies the workspace listing and does the writing.

import { generateGameRuntime } from './GameRuntimeGenerator';
import { generateGame3D } from './Game3DGenerator';
import { generateGameController } from './GameControllerGenerator';
import { generateGameSystems } from './GameSystemsGenerator';
import { generateGameVfxAudio } from './GameVfxAudioGenerator';
import { generateMelody } from './MelodyGenerator';
import { generateGameShell } from './GameShellGenerator';

export interface RecipeOutput {
  files: Record<string, string>;
  dependencies?: Array<{ name: string; version: string }>;
}

/** Every game recipe, by the tool name the builder calls it with. */
export const GAME_RECIPES: Readonly<Record<string, (include?: string[]) => RecipeOutput>> = {
  generate_game_runtime: generateGameRuntime,
  generate_game_3d: generateGame3D,
  generate_game_controller: generateGameController,
  generate_game_systems: generateGameSystems,
  generate_game_vfx: generateGameVfxAudio,
  generate_melody: generateMelody,
  generate_game_shell: generateGameShell,
};

export interface LayerFile { recipe: string; content: string }

let poolCache: Map<string, LayerFile> | null = null;

/** Every file any recipe can write, with the recipe that owns it (full default output). Cached. */
export function recipeFilePool(): Map<string, LayerFile> {
  if (poolCache) return poolCache;
  const pool = new Map<string, LayerFile>();
  for (const [recipe, gen] of Object.entries(GAME_RECIPES)) {
    for (const [path, content] of Object.entries(gen().files)) {
      if (!pool.has(path)) pool.set(path, { recipe, content });
    }
  }
  poolCache = pool;
  return pool;
}

const IMPORT_RE = /(?:import|export)\s[^'";]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/** The relative module specifiers a file imports. PURE. */
export function relativeImports(content: string): string[] {
  const out: string[] = [];
  for (const m of String(content ?? '').matchAll(IMPORT_RE)) out.push(m[1] ?? m[2]);
  return out;
}

function joinPath(fromFile: string, spec: string): string {
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** The pool path an import resolves to, or null when it is not a recipe-owned file. PURE. */
export function resolveInPool(fromFile: string, spec: string, pool: ReadonlyMap<string, LayerFile>): string | null {
  const base = joinPath(fromFile, spec);
  for (const ext of EXTENSIONS) if (pool.has(base + ext)) return base + ext;
  return null;
}

/**
 * The recipe-owned files that `written` imports — directly or through each other — and the workspace
 * does not have. Keyed by path, with the owning recipe and its exact content. PURE.
 */
export function missingLayerFiles(
  written: Readonly<Record<string, string>>,
  workspaceHas: ReadonlySet<string>,
  pool: ReadonlyMap<string, LayerFile> = recipeFilePool(),
): Map<string, LayerFile> {
  const missing = new Map<string, LayerFile>();
  const queue: Array<[string, string]> = Object.entries(written);
  while (queue.length > 0) {
    const [from, content] = queue.shift()!;
    for (const spec of relativeImports(content)) {
      const target = resolveInPool(from, spec, pool);
      if (!target || workspaceHas.has(target) || target in written || missing.has(target)) continue;
      const file = pool.get(target)!;
      missing.set(target, file);
      queue.push([target, file.content]);
    }
  }
  return missing;
}

/** The line the tool result carries, so the model knows what was added and why. PURE. */
export function missingLayersNote(added: ReadonlyMap<string, LayerFile>): string {
  if (added.size === 0) return '';
  const byRecipe = new Map<string, string[]>();
  for (const [path, f] of added) byRecipe.set(f.recipe, [...(byRecipe.get(f.recipe) ?? []), path]);
  const lines = [...byRecipe].map(([recipe, paths]) => {
    const deps = (GAME_RECIPES[recipe]?.().dependencies ?? []).map((d) => `${d.name}@${d.version}`);
    return `- ${recipe} (not run yet): ${paths.join(', ')}${deps.length ? ` — add the dependency: ${deps.join(', ')}${recipe === 'generate_game_3d' ? ' (and @types/three)' : ''}` : ''}`;
  });
  return `\n\nℹ️ LAYERS ADDED: the files above import layers the project did not have, so they were written from their own recipes — exact recipe content, nothing overwritten:\n${lines.join('\n')}\nUse these files as they are; do NOT write your own versions of them.`;
}
