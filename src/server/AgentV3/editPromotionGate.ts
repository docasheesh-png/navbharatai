// THE EDIT PROMOTION GATE — an edit may change the project; it may not become a different project.
//
// 🔴 WHY THIS EXISTS (incident: a complex 3D game was built, then an edit replaced its files with another game).
//
// The turn-end guard (`GreenGuard`) asks one question of a finished turn: "does the app render?". A candidate
// that is a DIFFERENT app renders too, so it passed — and was saved as the project AND as the new
// last-known-good, which is the copy every later restore reads. A second writer did the same earlier: the
// in-build proof saves the rendered tree as last-known-good the moment it paints, mid-turn. Neither compared
// the candidate with the version it was supposed to be an edit OF. "It renders" says the candidate is an app;
// it says nothing about whether it is THIS app.
//
// This module is the comparison. It is PURE: it is handed the verified base files and the candidate files and
// answers promote / reject with the reasons. A reject never deletes anything — the caller keeps the candidate
// under its own key (the existing "attempt" copy) and the project continues to serve the base.
//
// What it refuses, and why each is evidence of replacement rather than editing:
//   • a base file that held the app's identity was removed (entry point, scene/level/player/camera/physics
//     code, a model or texture asset) and nothing at another path carries the same bytes (a MOVE is fine);
//   • most of the project is gone, or none of it survived untouched;
//   • the project's engine was dropped (three / react-three-fiber / phaser / babylon … in package.json);
//   • a surviving file imports a file this edit removed (a deletion nobody followed through).
// What it allows, on the user's explicit word: a named deletion, and a broad rewrite ("refactor", "migrate"),
// and a full replacement (fresh start / approved rebuild — the caller passes `allowReplace`).

import { createHash } from 'node:crypto';

export type GateRule =
  | 'identity-file-removed'
  | 'most-of-project-removed'
  | 'most-of-project-rewritten'
  | 'engine-dropped'
  | 'dangling-import';

export interface GateReason {
  rule: GateRule;
  detail: string;
  paths: string[];
}

export interface GateStats {
  baseFiles: number;
  candidateFiles: number;
  unchanged: number;
  changed: number;
  added: number;
  removed: number;
  moved: number;
}

export interface GateVerdict {
  verdict: 'promote' | 'reject';
  /** Why a `promote` did not need a comparison, or why a replacement was allowed. Empty on a plain promote. */
  note: string;
  reasons: GateReason[];
  stats: GateStats;
}

export interface GateInput {
  /** The verified base the edit started from: path → content. */
  base: Readonly<Record<string, string>>;
  /** The candidate the turn produced: path → content. */
  candidate: Readonly<Record<string, string>>;
  /** Explicit fresh start / user-approved rebuild. The candidate may replace the project. */
  allowReplace?: boolean;
  /** The user's own message — the only source of permission for a named deletion or a broad rewrite. */
  userMessage?: string;
}

/** Below this many source files a project is a starter, not something to protect from replacement. */
export const MIN_PROTECTED_FILES = 4;
export const REMOVED_FRACTION_LIMIT = 0.4;
export const UNCHANGED_FRACTION_FLOOR = 0.3;
export const REWRITTEN_FRACTION_LIMIT = 0.7;

const ENGINES = [
  'three', '@react-three/fiber', '@react-three/drei', '@react-three/rapier', '@react-three/cannon', 'cannon-es',
  'babylonjs', '@babylonjs/core', 'phaser', 'playcanvas', 'pixi.js', 'matter-js', 'kaboom', 'excalibur',
];

/** Files the platform writes or rewrites itself — never evidence about what the user's app is. */
const PLATFORM_FILE =
  /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|e2e|docs\/decisions)\//i;
const PLATFORM_NAME =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.gitignore|\.env[^/]*|playwright\.config\.[tj]s|public\/(manifest\.webmanifest|robots\.txt|sw\.js|icon\.svg|nbai-native\.css)|README(\.md)?|vite-env\.d\.ts)$/i;

const CODE_EXT = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html|css|scss|json)$/i;
const ASSET_EXT = /\.(?:glb|gltf|obj|fbx|bin|png|jpe?g|webp|gif|svg|ktx2|hdr|exr|mp3|ogg|wav|m4a|ttf|woff2?|mp4|webm)$/i;
const ENTRY_PATH = /^(?:index\.html|src\/main\.[cm]?[jt]sx?|src\/index\.[cm]?[jt]sx?|src\/App\.[cm]?[jt]sx?|app\/(?:layout|page)\.[tj]sx?|pages\/(?:_app|index)\.[tj]sx?)$/i;
const IDENTITY_NAME = /(scene|level|world|map|city|terrain|game|player|character|vehicle|car|camera|physics|collision|controls?|input|enemy|inventory|engine)/i;

export function isPlatformFile(path: string): boolean {
  const p = String(path ?? '').replace(/^\.?\/+/, '');
  return PLATFORM_FILE.test(p) || PLATFORM_NAME.test(p);
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Is this base file part of what makes the app THIS app? PURE. */
export function isIdentityFile(path: string): boolean {
  const p = String(path ?? '').replace(/^\.?\/+/, '');
  if (ENTRY_PATH.test(p)) return true;
  if (ASSET_EXT.test(p) && !/\.(?:svg|png|jpe?g|webp|gif)$/i.test(p)) return true; // models, audio, fonts, binaries
  if (/(^|\/)(public|assets|models|textures|sounds|audio)\//i.test(p) && ASSET_EXT.test(p)) return true;
  return CODE_EXT.test(p) && /\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(p) && IDENTITY_NAME.test(p.split('/').pop() ?? '');
}

/** "Delete the old menu screen", "remove src/Menu.tsx": the paths whose names the user gave. PURE. */
export function pathsTheUserNamedForRemoval(message: string, candidatePaths: readonly string[]): Set<string> {
  const m = String(message ?? '').toLowerCase();
  const out = new Set<string>();
  if (!/\b(?:delete|remove|drop|get\s+rid\s+of|hata|hatao|hata\s+do|delete\s+kar|nikal|nikaal)\b/.test(m)) return out;
  for (const p of candidatePaths) {
    const file = (p.split('/').pop() ?? '').toLowerCase();
    const stem = file.replace(/\.[^.]+$/, '');
    if (stem.length >= 4 && (m.includes(file) || new RegExp(`\\b${stem.replace(/[^a-z0-9]/g, '.?')}\\b`).test(m))) out.add(p);
  }
  return out;
}

/** The user asked for a broad restructuring, so a large diff is what was asked for. PURE. */
export function userAskedForBroadRewrite(message: string): boolean {
  return /\b(?:refactor|rewrite|re-?architect|restructure|migrate|convert\s+(?:it\s+)?to|port\s+(?:it\s+)?to|overhaul|redo\s+everything|from\s+scratch)\b/i.test(String(message ?? ''));
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.vue', '.svelte', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

function resolveRelative(fromPath: string, spec: string, has: (p: string) => boolean): { found: boolean; target: string } {
  const parts = fromPath.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const stem = parts.join('/');
  for (const ext of RESOLVE_EXT) if (has(stem + ext)) return { found: true, target: stem + ext };
  return { found: false, target: stem };
}

/** The declared dependencies, or null when package.json is absent or unreadable (no evidence either way). */
function depsOf(files: Readonly<Record<string, string>>): Set<string> | null {
  const raw = files['package.json'];
  if (typeof raw !== 'string') return null;
  try {
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return new Set(Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }));
  } catch { return null; }
}

/**
 * Compare a candidate with the verified base it was supposed to be an edit of. PURE. Never throws.
 */
export function assessEditCandidate(input: GateInput): GateVerdict {
  const base = input.base ?? {};
  const candidate = input.candidate ?? {};
  const baseSource = Object.keys(base).filter((p) => !isPlatformFile(p));
  const candSource = new Set(Object.keys(candidate).filter((p) => !isPlatformFile(p)));

  // Content hashes: a file that moved carries the same bytes at a new path.
  const candidateByHash = new Map<string, string>();
  for (const p of candSource) candidateByHash.set(sha256(candidate[p] ?? ''), p);

  let unchanged = 0, changed = 0, removed = 0, moved = 0;
  const removedPaths: string[] = [];
  const changedPaths: string[] = [];
  for (const p of baseSource) {
    if (candSource.has(p)) {
      if (candidate[p] === base[p]) unchanged++;
      else { changed++; changedPaths.push(p); }
    } else if (candidateByHash.has(sha256(base[p] ?? ''))) {
      moved++;
    } else {
      removed++;
      removedPaths.push(p);
    }
  }
  const baseSet = new Set(baseSource);
  const added = [...candSource].filter((p) => !baseSet.has(p)).length;
  const stats: GateStats = { baseFiles: baseSource.length, candidateFiles: candSource.size, unchanged, changed, added, removed, moved };

  if (input.allowReplace) return { verdict: 'promote', note: 'The user explicitly asked for a fresh start or approved a rebuild, so replacement is allowed.', reasons: [], stats };
  if (baseSource.length < MIN_PROTECTED_FILES) return { verdict: 'promote', note: 'The base is starter-sized, so there is no project to protect from replacement.', reasons: [], stats };

  const reasons: GateReason[] = [];
  const named = pathsTheUserNamedForRemoval(input.userMessage ?? '', removedPaths);
  const unnamedRemoved = removedPaths.filter((p) => !named.has(p));

  const identityRemoved = unnamedRemoved.filter(isIdentityFile);
  if (identityRemoved.length > 0) {
    reasons.push({ rule: 'identity-file-removed', detail: `${identityRemoved.length} file(s) that define the app were removed and not moved: ${identityRemoved.slice(0, 6).join(', ')}${identityRemoved.length > 6 ? ', …' : ''}.`, paths: identityRemoved });
  }
  if (unnamedRemoved.length / baseSource.length >= REMOVED_FRACTION_LIMIT) {
    reasons.push({ rule: 'most-of-project-removed', detail: `${unnamedRemoved.length} of ${baseSource.length} project files were removed.`, paths: unnamedRemoved });
  }
  if (!userAskedForBroadRewrite(input.userMessage ?? '') && baseSource.length >= 6
    && unchanged / baseSource.length < UNCHANGED_FRACTION_FLOOR
    && (changed + removed) / baseSource.length >= REWRITTEN_FRACTION_LIMIT) {
    reasons.push({ rule: 'most-of-project-rewritten', detail: `Only ${unchanged} of ${baseSource.length} project files survived untouched; ${changed} were rewritten and ${removed} removed.`, paths: [...changedPaths, ...removedPaths].slice(0, 12) });
  }
  const baseDeps = depsOf(base);
  const candDeps = depsOf(candidate);
  if (baseDeps && candDeps) {
    const dropped = ENGINES.filter((e) => baseDeps.has(e) && !candDeps.has(e));
    if (dropped.length > 0) reasons.push({ rule: 'engine-dropped', detail: `The project's engine was dropped: ${dropped.join(', ')}.`, paths: ['package.json'] });
  }
  // A deletion has to be followed through: nothing that survived may still import what was removed.
  const gone = new Set([...removedPaths, ...baseSource.filter((p) => !candSource.has(p))]);
  const has = (p: string) => candSource.has(p) || p in candidate;
  const dangling: string[] = [];
  for (const p of candSource) {
    if (!/\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(p)) continue;
    const src = candidate[p] ?? '';
    for (const m of src.matchAll(IMPORT_RE)) {
      const r = resolveRelative(p, m[1], has);
      if (!r.found && [...gone].some((g) => g === r.target || g.startsWith(`${r.target}.`) || g.startsWith(`${r.target}/`))) {
        dangling.push(`${p} → ${m[1]}`);
        break;
      }
    }
  }
  if (dangling.length > 0) reasons.push({ rule: 'dangling-import', detail: `${dangling.length} file(s) still import something this edit removed: ${dangling.slice(0, 4).join('; ')}.`, paths: dangling });

  return reasons.length > 0
    ? { verdict: 'reject', note: '', reasons, stats }
    : { verdict: 'promote', note: '', reasons: [], stats };
}

/** One honest sentence for the user, in plain words. PURE. */
export function rejectionMessage(v: GateVerdict): string {
  const why = v.reasons.map((r) => r.detail).join(' ');
  return `I did not apply this change, because it would have replaced your existing app instead of editing it. ${why} Your app is exactly as it was before this request. If you really want to start over, say "start fresh" and I will ask you to confirm.`;
}
