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
// 🔒 NEVER OVERWRITES ANYBODY'S CODE. A path absent from the workspace is added; a layer the model or the
// user has written (or edited) is left exactly as it is.
//
// 🧬 AND AN OLDER KIT FILE NOBODY TOUCHED IS BROUGHT UP TO DATE (Q-863, found by 46e2d74b). The kit changes:
// since 2026-10-11 `camera.ts` imports `vehicleAt` from `objects.ts`. A game built before that holds the OLD
// objects.ts, so a recipe run on an edit turn that adds the new camera.ts handed over code that could not
// compile — and "never overwrite" kept it that way. `gameKitHistory.ts` holds the hash of every version a
// recipe ever wrote, so a file can be told apart by its bytes: exactly an older kit version ⇒ nobody edited
// it, and it is replaced by the current one (only if that still exports every name the old one did, so no
// caller loses a name); anything else is somebody's code ⇒ kept, and when the new files import names it does
// not export, the tool result says exactly which. Recorded server-side, never as a file in the app: a
// manifest inside the project would be pushed to the user's repo and could be forged by an imported repo
// (engineeringMemoryStore.ts gives the five reasons that rule out in-app ledgers).
//
// PURE — no I/O. The dispatcher supplies the workspace listing and contents, and does the writing.

import { generateGameRuntime } from './GameRuntimeGenerator';
import { generateGame3D } from './Game3DGenerator';
import { generateGameController } from './GameControllerGenerator';
import { generateGameSystems } from './GameSystemsGenerator';
import { generateGameVfxAudio } from './GameVfxAudioGenerator';
import { generateMelody } from './MelodyGenerator';
import { generateGameShell } from './GameShellGenerator';
import { createHash } from 'node:crypto';
import { GAME_KIT_HISTORY } from './gameKitHistory';

export interface RecipeOutput {
  files: Record<string, string>;
  dependencies?: Array<{ name: string; version: string }>;
}

/**
 * Every game recipe, by the tool name the builder calls it with. ⚠️ Changing what one writes? Run
 * `node scripts/gameKitHistory.mjs` so the new version is recorded (Q-863) — the census in
 * `tests/aKitFileFromAnOlderVersionIsRecognised.test.ts` fails until you do.
 */
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
  return planKitLayers(written, workspaceHas, new Map(), pool).add;
}

/** Is this exactly — byte for byte — a version of `path` some game recipe has written? PURE. */
export function isKnownKitVersion(path: string, content: string | null | undefined): boolean {
  const known = GAME_KIT_HISTORY[path];
  if (!known || typeof content !== 'string') return false;
  return known.includes(createHash('sha256').update(content, 'utf8').digest('hex'));
}

const DECL_EXPORT_RE = /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([\w$]+)/g;
const LIST_EXPORT_RE = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;

/** The names a module exports, or null when it re-exports a whole module (`export * from`) and so cannot be listed. PURE. */
export function exportedNames(content: string): Set<string> | null {
  const text = String(content ?? '');
  if (/\bexport\s+\*\s+from\b/.test(text)) return null;
  const out = new Set<string>();
  for (const m of text.matchAll(DECL_EXPORT_RE)) out.add(m[1]);
  for (const m of text.matchAll(LIST_EXPORT_RE)) {
    for (const item of m[1].split(',')) {
      const name = item.replace(/^\s*type\s+/, '').split(/\s+as\s+/).pop()!.trim();
      if (name) out.add(name);
    }
  }
  if (/\bexport\s+default\b/.test(text)) out.add('default');
  for (const m of text.matchAll(/\bexport\s+\*\s+as\s+([\w$]+)/g)) out.add(m[1]);
  return out;
}

/** The names `content` takes from `spec` with a named import or re-export (`import { a, b as c }` → a, b). PURE. */
export function importedNames(content: string, spec: string): string[] {
  const esc = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(?:import|export)\\s+(?:type\\s+)?(?:[\\w$]+\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${esc}['"]`, 'g');
  const out: string[] = [];
  for (const m of String(content ?? '').matchAll(re)) {
    for (const item of m[1].split(',')) {
      const name = item.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/**
 * Why a kit-path file the project holds is NOT the current kit version and will not be replaced, or null when it
 * is current or may be brought up to date: 'edited' — its bytes are no version a recipe ever wrote; 'drops-names'
 * — an older version, but the current one no longer exports a name it did, so a caller could break. PURE.
 */
export function staleKitReason(path: string, current: string, next: string): 'edited' | 'drops-names' | null {
  if (current === next) return null;
  if (!isKnownKitVersion(path, current)) return 'edited';
  const oldNames = exportedNames(current);
  const newNames = exportedNames(next);
  return oldNames && newNames && [...oldNames].every((n) => newNames.has(n)) ? null : 'drops-names';
}

/** May this file be replaced by `next`? Only when it is exactly an older kit version and `next` keeps every name it exported. PURE. */
export function kitRefreshable(path: string, current: string, next: string): boolean {
  return current !== next && staleKitReason(path, current, next) === null;
}

export interface KitPlan {
  /** Absent from the project: written from their recipe (the 6a55d939 fix). */
  add: Map<string, LayerFile>;
  /** Present and byte-exact an OLDER version a recipe wrote — nobody edited it — and the current version still
   *  exports every name that one did: brought up to date, because the code that imports it was written against now. */
  refresh: Map<string, LayerFile>;
  /** Present, NOT bytes any recipe wrote (or an old version the current one would take a name from), and missing
   *  names the new code imports from it. Never overwritten; the tool result names the gap. */
  kept: Array<{ path: string; importer: string; missing: string[]; reason: 'edited' | 'drops-names' }>;
  /** Present kit paths the walk reached whose content it was not given — read them and plan again. */
  unread: string[];
}

/**
 * What the files just written need from the kit layer, and what the project's copy of it is. `existing` holds the
 * content of kit paths the project has: a string is the file, null is "present but unreadable" (left exactly as
 * it is), and a path missing from the map is listed in `unread` for the caller to read and plan again — so a
 * fresh build whose kit was written moments ago reads nothing. Walks the import closure of `written`, following
 * current and brought-up-to-date files, never a file somebody owns. PURE.
 */
export function planKitLayers(
  written: Readonly<Record<string, string>>,
  workspaceHas: ReadonlySet<string>,
  existing: ReadonlyMap<string, string | null>,
  pool: ReadonlyMap<string, LayerFile> = recipeFilePool(),
  reasonOf: (path: string, current: string, next: string) => 'edited' | 'drops-names' | null = staleKitReason,
): KitPlan {
  const plan: KitPlan = { add: new Map(), refresh: new Map(), kept: [], unread: [] };
  const followed = new Set<string>(Object.keys(written));
  const queue: Array<[string, string]> = Object.entries(written);
  while (queue.length > 0) {
    const [from, content] = queue.shift()!;
    for (const spec of relativeImports(content)) {
      const target = resolveInPool(from, spec, pool);
      if (!target || target in written || plan.add.has(target) || plan.refresh.has(target)) continue;
      const kit = pool.get(target)!;
      if (!workspaceHas.has(target)) {
        plan.add.set(target, kit);
        queue.push([target, kit.content]);
        continue;
      }
      if (!existing.has(target)) {
        if (!plan.unread.includes(target)) plan.unread.push(target);
        continue;
      }
      const cur = existing.get(target);
      if (typeof cur !== 'string') continue;
      if (cur === kit.content) {
        if (!followed.has(target)) { followed.add(target); queue.push([target, cur]); }
        continue;
      }
      const reason = reasonOf(target, cur, kit.content);
      if (reason === null) {
        plan.refresh.set(target, kit);
        queue.push([target, kit.content]);
        continue;
      }
      const has = exportedNames(cur);
      const missing = has ? importedNames(content, spec).filter((n) => !has.has(n)) : [];
      if (missing.length > 0 && !plan.kept.some((k) => k.path === target && k.importer === from)) {
        plan.kept.push({ path: target, importer: from, missing, reason });
      }
    }
  }
  return plan;
}

/** The line the tool result carries, so the model knows what was added and why. PURE. */
export function missingLayersNote(added: ReadonlyMap<string, LayerFile>): string {
  if (added.size === 0) return '';
  const byRecipe = new Map<string, string[]>();
  for (const [path, f] of added) byRecipe.set(f.recipe, [...(byRecipe.get(f.recipe) ?? []), path]);
  const lines = [...byRecipe].map(([recipe, paths]) => {
    const deps = (GAME_RECIPES[recipe]?.().dependencies ?? []).map((d) => `${d.name}@${d.version}`);
    return `- ${recipe} (not run yet): ${paths.join(', ')}${deps.length ? ` — needs ${deps.join(', ')}${recipe === 'generate_game_3d' ? ' (and @types/three)' : ''}` : ''}`;
  });
  return `\n\nℹ️ LAYERS ADDED: the files above import layers the project did not have, so they were written from their own recipes — exact recipe content, nothing overwritten:\n${lines.join('\n')}\nUse these files as they are; do NOT write your own versions of them.`;
}

/** What the tool result says about kit files brought up to date, and kit-path files kept that the new code cannot use as they are. PURE. */
export function kitVersionNote(refreshed: readonly string[], kept: KitPlan['kept'], failed: readonly string[] = []): string {
  const parts: string[] = [];
  if (refreshed.length > 0) {
    parts.push(`\n\nℹ️ KIT FILES BROUGHT UP TO DATE: ${refreshed.join(', ')} — each was exactly an older version the kit wrote (nobody had edited it), and the files above were written against the current one, so it was replaced. Every name it exported is still exported; if your own code calls these, re-check it against the current API.`);
  }
  if (kept.length > 0 || failed.length > 0) {
    const lines = kept.map((k) => `- ${k.importer} imports ${k.missing.join(', ')} from ${k.path}, which this project's ${k.path} does not export — ${k.reason === 'edited'
      ? 'it is not a version the kit ever wrote (somebody changed it), so it was NOT replaced'
      : 'it is an older kit version, but replacing it would remove names your code may use, so it was NOT replaced'}.`);
    for (const f of failed) lines.push(`- ${f} could not be written (the write was refused), so it is as it was — the files above may not compile until it is.`);
    parts.push(`\n\n⚠️ KIT VERSION MISMATCH — these will not compile as they are:\n${lines.join('\n')}\nAdd the missing exports to that file (keep its other changes), or adapt the importing file — do NOT delete either.`);
  }
  return parts.join('');
}

/**
 * THE PACKAGES A GAME RECIPE'S CODE IMPORTS ARE INSTALLED BY US, NOT LEFT TO THE MODEL (candy report
 * 7da1cdca, 2026-10-04). The shell imports the 3D layer, the layer imports `three`, and the tool result
 * only SAID "add the dependency: three". The model went on writing for two minutes while every
 * typecheck quoted seven `Cannot find module 'three'` errors, then installed it by hand. A known package
 * at a version the recipe already declares has one right answer, so it is not a model's decision.
 */

/** The versions game recipes declare, plus the type package `three` needs. */
export function recipeDependencyVersions(): Map<string, { version: string; dev: boolean }> {
  const out = new Map<string, { version: string; dev: boolean }>();
  for (const gen of Object.values(GAME_RECIPES)) {
    for (const d of gen().dependencies ?? []) if (!out.has(d.name)) out.set(d.name, { version: d.version, dev: false });
  }
  const three = out.get('three');
  if (three && !out.has('@types/three')) out.set('@types/three', { version: three.version, dev: true });
  return out;
}

const BARE_IMPORT_RE = /(?:import|export)\s[^'";]*?from\s*['"]([^'".][^'"]*)['"]|import\s*\(\s*['"]([^'".][^'"]*)['"]\s*\)|import\s*['"]([^'".][^'"]*)['"]/g;

/** The package a bare specifier names (`three/examples/jsm/x` → `three`, `@a/b/c` → `@a/b`). PURE. */
function packageOf(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * The recipe-declared packages these files import that `package.json` does not list yet. Only packages a
 * recipe DECLARES are returned — an unknown import is never guessed at. `@types/three` comes with
 * `three`. PURE.
 */
export function recipeDependenciesNeeded(
  files: Readonly<Record<string, string>>,
  packageJson: string | null,
): Array<{ name: string; version: string; dev: boolean }> {
  const known = recipeDependencyVersions();
  const imported = new Set<string>();
  for (const content of Object.values(files)) {
    for (const m of String(content ?? '').matchAll(BARE_IMPORT_RE)) imported.add(packageOf(m[1] ?? m[2] ?? m[3]));
  }
  if (imported.has('three')) imported.add('@types/three');
  let listed = new Set<string>();
  try {
    const pkg = JSON.parse(packageJson ?? '{}') as Record<string, Record<string, string> | undefined>;
    listed = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  } catch { return []; } // an unreadable manifest is not ours to rewrite
  return [...imported]
    .filter((n) => known.has(n) && !listed.has(n))
    .sort()
    .map((n) => ({ name: n, ...known.get(n)! }));
}
