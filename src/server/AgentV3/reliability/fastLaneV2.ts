/**
 * P6 — FAST LANE v2 (fix/build-reliability, AGENTV3_FAST_LANE_V2).
 *
 * The fast lane generates each file in its own call, in tiers decided by a PATH REGEX (types/utils →
 * components → shell), and a consumer sees only its producers' export SIGNATURES. Two failure modes
 * follow: a file is generated before a file it imports (the regex guessed its tier wrong), and a
 * consumer calls a producer the way the signature suggests rather than the way the body works. Large
 * manifests multiply both — and a 20-file app is past what isolated per-file calls do well.
 *
 * v2:
 *   1. The planner states each file's contract on its manifest line:
 *        path :: purpose :: exports: A, B :: imports: src/x.ts, src/y.ts
 *      `validateManifestContract` drops imports of files not in the plan (and self-imports).
 *   2. Generation runs in TOPOLOGICAL WAVES from those imports (Kahn layering); a file always waits
 *      for every file it imports. Cycles are broken deterministically. Stylesheets go last (their
 *      generation reads the components' class names). With no imports declared, the old regex tiers.
 *   3. Each file is handed the FULL code of the files it imports (transitively, nearest first) up to
 *      AGENTV3_FAST_LANE_DEPS_CHARS (default 12,000), and the export surface of everything else.
 *   4. A plan of more than AGENTV3_FAST_LANE_MAX_FILES (default 12) files is handed to the agent loop.
 * PURE.
 */
import { reliabilityFlag, reliabilityInt } from './flags';

export function fastLaneV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return reliabilityFlag('FAST_LANE_V2', env);
}

export function fastLaneMaxFiles(env: NodeJS.ProcessEnv = process.env): number {
  return reliabilityInt('AGENTV3_FAST_LANE_MAX_FILES', 12, 1, env);
}

export function fastLaneDepsChars(env: NodeJS.ProcessEnv = process.env): number {
  return reliabilityInt('AGENTV3_FAST_LANE_DEPS_CHARS', 12_000, 1_000, env);
}

export interface ManifestContract {
  exports: string[];
  imports: string[];
}

/** The extra planner rules for the v2 manifest line format. */
export const MANIFEST_V2_RULES = [
  '- CONTRACT ON EVERY LINE (required): after the purpose, add the file\'s exports and the project files it imports:',
  '    src/components/TaskList.tsx :: renders the task list :: exports: TaskList :: imports: src/types.ts, src/hooks/useTasks.ts',
  '  `exports:` = the exact names other files will import (use `default` for a default export).',
  '  `imports:` = ONLY files from THIS list (exact paths), never npm packages. Write `imports: none` if it imports no project file.',
  '- No import cycles: if A imports B, B must not import A.',
].join('\n');

function splitList(s: string): string[] {
  const t = s.trim();
  if (!t || /^none$/i.test(t) || t === '-') return [];
  return [...new Set(t.split(/[,\s]+/).map((x) => x.trim().replace(/^["'`]|["'`]$/g, '')).filter(Boolean))];
}

/** Read `exports:` / `imports:` segments off the raw manifest text, keyed by path. */
export function parseManifestContract(text: string): Map<string, ManifestContract> {
  const out = new Map<string, ManifestContract>();
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '');
    if (!line.includes('::')) continue;
    const segs = line.split('::').map((x) => x.trim());
    const path = segs[0].replace(/^["'`]|["'`]$/g, '');
    if (!path) continue;
    const c: ManifestContract = { exports: [], imports: [] };
    for (const seg of segs.slice(1)) {
      const m = /^(exports?|imports?)\s*:\s*(.*)$/i.exec(seg);
      if (!m) continue;
      if (/^export/i.test(m[1])) c.exports = splitList(m[2]);
      else c.imports = splitList(m[2]);
    }
    out.set(path, c);
  }
  return out;
}

/** The purpose without any contract segments (parseFileManifest keeps them in `purpose`). */
export function cleanPurpose(purpose: string): string {
  return String(purpose ?? '').split('::').filter((seg) => !/^\s*(exports?|imports?)\s*:/i.test(seg)).join('::').trim();
}

/** Resolve an import written loosely (no extension, ./ prefix) to a manifest path, or null. */
export function resolveManifestImport(imp: string, paths: readonly string[]): string | null {
  const clean = imp.replace(/^\.\//, '').replace(/^@\//, 'src/');
  if (paths.includes(clean)) return clean;
  const noExt = clean.replace(/\.[a-z0-9]+$/i, '');
  const hit = paths.find((p) => p.replace(/\.[a-z0-9]+$/i, '') === noExt || p.replace(/\/index\.[a-z0-9]+$/i, '') === noExt);
  return hit ?? null;
}

export interface ValidatedContract {
  imports: Map<string, string[]>;
  exports: Map<string, string[]>;
  /** "a.ts → missing.ts" for every import that pointed outside the plan (dropped). */
  dropped: string[];
  /** True when at least one file declared imports (otherwise waves fall back to path tiers). */
  declared: boolean;
}

export function validateManifestContract(paths: readonly string[], contract: Map<string, ManifestContract>): ValidatedContract {
  const imports = new Map<string, string[]>();
  const exports = new Map<string, string[]>();
  const dropped: string[] = [];
  let declared = false;
  for (const p of paths) {
    const c = contract.get(p);
    exports.set(p, c?.exports ?? []);
    const resolved: string[] = [];
    for (const imp of c?.imports ?? []) {
      declared = true;
      const r = resolveManifestImport(imp, paths);
      if (!r || r === p) { if (r !== p) dropped.push(`${p} → ${imp}`); continue; }
      if (!resolved.includes(r)) resolved.push(r);
    }
    imports.set(p, resolved);
  }
  return { imports, exports, dropped, declared };
}

/**
 * Kahn layering: wave k holds files whose imports are all in waves < k. Cycles are broken by taking
 * the remaining file with the fewest unmet imports (ties by manifest order). `last` files (stylesheets)
 * always form the final wave. `fallbackTier` orders files when no imports were declared at all.
 */
export function topoWaves(
  paths: readonly string[],
  imports: Map<string, string[]>,
  opts: { last?: (p: string) => boolean; fallbackTier?: (p: string) => number; declared?: boolean } = {},
): string[][] {
  const last = opts.last ?? (() => false);
  const body = paths.filter((p) => !last(p));
  const tail = paths.filter((p) => last(p));
  const waves: string[][] = [];
  if (opts.declared === false && opts.fallbackTier) {
    const byTier = new Map<number, string[]>();
    for (const p of body) {
      const t = opts.fallbackTier(p);
      byTier.set(t, [...(byTier.get(t) ?? []), p]);
    }
    for (const t of [...byTier.keys()].sort((a, b) => a - b)) waves.push(byTier.get(t)!);
  } else {
    const done = new Set<string>();
    const remaining = [...body];
    const bodySet = new Set(body);
    const deps = (p: string) => (imports.get(p) ?? []).filter((d) => bodySet.has(d));
    while (remaining.length) {
      let wave = remaining.filter((p) => deps(p).every((d) => done.has(d)));
      if (!wave.length) {
        // A cycle: release the file with the fewest unmet imports.
        let best = remaining[0];
        let bestUnmet = Number.POSITIVE_INFINITY;
        for (const p of remaining) {
          const unmet = deps(p).filter((d) => !done.has(d)).length;
          if (unmet < bestUnmet) { best = p; bestUnmet = unmet; }
        }
        wave = [best];
      }
      for (const p of wave) { done.add(p); remaining.splice(remaining.indexOf(p), 1); }
      waves.push(wave);
    }
  }
  if (tail.length) waves.push(tail);
  return waves.filter((w) => w.length > 0);
}

/** Transitive imports of `path`, nearest first (BFS). */
export function transitiveImports(path: string, imports: Map<string, string[]>): string[] {
  const out: string[] = [];
  const seen = new Set<string>([path]);
  const queue = [...(imports.get(path) ?? [])];
  while (queue.length) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    queue.push(...(imports.get(p) ?? []));
  }
  return out;
}

export interface DepFile { path: string; content: string }

/**
 * The dependency block for one file: FULL code of its (transitive) imports up to `cap` chars, nearest
 * first; `surface` renders every other produced file (the export-surface registry). PURE.
 */
export function fullDepsContext(path: string, produced: readonly DepFile[], imports: Map<string, string[]>, cap: number, surface: (files: DepFile[]) => string): string {
  const byPath = new Map(produced.map((f) => [f.path, f]));
  const wanted = transitiveImports(path, imports).filter((p) => byPath.has(p));
  const full: DepFile[] = [];
  let used = 0;
  for (const p of wanted) {
    const f = byPath.get(p)!;
    if (used + f.content.length > cap) continue;
    used += f.content.length;
    full.push(f);
  }
  const fullSet = new Set(full.map((f) => f.path));
  const rest = produced.filter((f) => !fullSet.has(f.path));
  const parts: string[] = [];
  if (full.length) {
    parts.push(
      '',
      'FILES THIS FILE IMPORTS — their COMPLETE, REAL source. Import exactly what they export, call their',
      'functions with exactly these parameters, render their components with exactly these props:',
      full.map((f) => `<<<FILE ${f.path}>>>\n${f.content}\n<<<ENDFILE>>>`).join('\n\n'),
    );
  }
  if (rest.length) parts.push(surface(rest));
  return parts.join('\n');
}
