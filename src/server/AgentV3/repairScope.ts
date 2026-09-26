// AgentV3 — A REPAIR MAY ONLY WRITE WHAT IT WAS ASKED TO REPAIR (autopsy 2026-09-26, "4D Future City Drive").
//
// 🔴 WHAT HAPPENED. A finished Three.js driving game reached the post-build typecheck gate, which reported
// "found type errors" and ran one model repair pass. The repair answered with a generic web app: a file
// literally named `relative/path.ext`, plus `App.jsx`, `Navbar`, `Sidebar`, `Footer`, `Button`, `Input`,
// `useAuth`, `AuthContext`, Login / Dashboard / Profile / NotFound pages, `AppRoutes`, `constants.js`,
// `src/styles/globals.css` and `theme.css` — none of which the game had, imported or needed. Every block
// was written. The integrity pass then found the stray stylesheets "imported by nothing" and WIRED them
// into `src/main.tsx`, so the invented CSS reached the user's game.
//
// `relative/path.ext` is not a guess: it is the example path in the repair prompt's own OUTPUT FORMAT
// (`repairSystemPrompt`, SimpleBuilder.ts). A model that is handed errors it cannot act on — here the
// sandbox's node_modules was being rewritten underneath the build — falls back on the template.
//
// 🔑 THE CLASS: five passes ask a model to repair files and then write EVERY `<<<FILE …>>>` block it
// returns, whatever the path. Each prompt says "output ONLY the files you change" and none of them
// enforced it. A prompt is a request; the writer is where the rule has to hold. So the scope is decided
// here, once, and every repair site asks it before a single write:
//   • a path the pass was given to repair (the files shown, the files the errors name) — kept;
//   • a NEW path — kept only when something points at it: the compiler's errors name it, or an existing
//     file imports it. A missing module is a real reason to create a file; a Navbar nobody imports is not;
//   • a template path (`relative/path.ext`, `path/to/…`, `<…>`) — refused always.
//
// 🔒 WHAT THIS CANNOT MAKE WORSE: a refused block is simply not written, so the file on disk stays as it
// was before the repair — exactly the state the pass started from. The honest report line says what was
// refused and why. A legitimate repair (editing the named files, creating an imported-but-missing
// module) is unaffected.

export interface RepairFile { path: string; content: string }

export interface RepairScopeInput {
  /** Paths this pass was asked to repair — the files shown to the model and/or named as broken. */
  allowed: Iterable<string>;
  /** The compiler/checker output the repair was given, if any. A path it names may be created. */
  errors?: string;
  /** The app's current files (path → content). A new path one of them imports may be created. */
  existing?: Record<string, string> | Map<string, string>;
  /** Whether this pass may create files at all (a syntax fix never should). Default true. */
  allowCreate?: boolean;
}

export type RefusalReason = 'template-path' | 'outside-scope';

export interface RepairScopeResult {
  kept: RepairFile[];
  refused: Array<{ path: string; reason: RefusalReason }>;
}

/**
 * Is this a template / placeholder path rather than a real file? Pure.
 *
 * Matches only what a real project never contains: the literal example from our own prompt, the
 * `path/to/` idiom, angle-bracket or brace placeholders, an ellipsis segment, and the literal
 * extension `.ext`. Precision-first — `src/relative.ts` or `src/paths.ts` are real files.
 */
export function isPlaceholderPath(path: string): boolean {
  const p = String(path ?? '').trim().replace(/^\.\//, '');
  if (!p) return true;
  if (/(^|\/)relative\/path\.ext$/i.test(p)) return true;
  if (/(^|\/)path\/to\//i.test(p)) return true;
  if (/[<>{}]/.test(p)) return true;
  if (/(^|\/)\.\.\.(\/|$)|…/.test(p)) return true;
  if (/\.ext$/i.test(p)) return true;
  return false;
}

function normalize(p: string): string {
  return String(p ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function stemOf(p: string): string {
  const base = normalize(p).split('/').pop() || '';
  return base.replace(/\.[^.]+$/, '');
}

/** Resolve a relative import specifier from `fromPath` to a normalized path without extension. */
function resolveSpecifier(fromPath: string, spec: string): string | null {
  // `@/x` is this platform's scaffold alias for `src/x` (the same mapping findUnresolvedLocalImports uses).
  if (spec.startsWith('@/')) return normalize(`src/${spec.slice(2)}`);
  if (!spec.startsWith('.')) return null;
  const dir = normalize(fromPath).split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') { if (dir.length === 0) return null; dir.pop(); continue; }
    dir.push(seg);
  }
  return dir.join('/');
}

/**
 * Does something already point at this NEW path? Pure.
 *
 * Either the errors name it (by path or by the module it would provide), or an existing file imports it
 * by a relative specifier that resolves to it (with or without an extension, or as a directory index).
 */
export function newPathIsReferenced(
  path: string,
  errors: string | undefined,
  existing: Record<string, string> | Map<string, string> | undefined,
): boolean {
  const target = normalize(path);
  const noExt = target.replace(/\.[^./]+$/, '');
  const stem = stemOf(target);
  if (errors) {
    if (errors.includes(target)) return true;
    // TS2307 "Cannot find module './foo'" and friends name the specifier, not the file.
    const re = /(?:Cannot find module|Could not resolve|Failed to resolve import)\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(errors)) !== null) {
      const spec = m[1];
      if (spec.startsWith('.') && stemOf(spec) === stem) return true;
    }
  }
  const entries = existing instanceof Map ? [...existing.entries()] : Object.entries(existing ?? {});
  // An import that ALREADY resolves to an existing file is satisfied, and is no reason to create a
  // sibling: `./App` → `src/App.tsx` does not license `src/App.jsx` (the 2026-09-26 report did exactly that).
  const existingNoExt = new Set(entries.map(([p]) => normalize(p).replace(/\.[^./]+$/, '')));
  const satisfied = (r: string) => existingNoExt.has(r) || existingNoExt.has(`${r}/index`);
  const importRe = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+|require\s*\(\s*|@import\s+(?:url\()?\s*)['"]([^'"]+)['"]/g;
  for (const [from, content] of entries) {
    if (typeof content !== 'string' || !content) continue;
    let m: RegExpExecArray | null;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(content)) !== null) {
      const resolved = resolveSpecifier(from, m[1]);
      if (!resolved) continue;
      const r = resolved.replace(/\.[^./]+$/, '');
      if (satisfied(resolved) || satisfied(r)) continue;
      if (resolved === target || r === noExt || `${resolved}/index` === noExt) return true;
    }
  }
  return false;
}

/**
 * Decide which of a repair's file blocks may be written. Pure.
 *
 * Order matters only for honesty: a template path is reported as such even when it would also have
 * been outside the scope, because that is the more specific and more useful fact.
 */
export function scopeRepairFiles(files: RepairFile[], scope: RepairScopeInput): RepairScopeResult {
  const allowed = new Set([...scope.allowed].map(normalize));
  const existing: Record<string, string> = scope.existing instanceof Map
    ? Object.fromEntries(scope.existing)
    : { ...(scope.existing ?? {}) };
  const kept: RepairFile[] = [];
  const refused: RepairScopeResult['refused'] = [];
  const candidates: RepairFile[] = [];
  // Phase 1 — the files the pass was asked to repair. Their NEW content counts for phase 2: a repair
  // that splits a component rewrites `App.tsx` to import `./Brand` AND creates `Brand.tsx`, in one answer.
  for (const f of files) {
    if (!f || typeof f.path !== 'string') continue;
    if (isPlaceholderPath(f.path)) { refused.push({ path: f.path, reason: 'template-path' }); continue; }
    if (allowed.has(normalize(f.path))) { kept.push(f); continue; }
    candidates.push(f);
  }
  // Phase 2 — a new file, only when an error or an in-scope file (as it will be after this repair) points
  // at it. A block refused here cannot vouch for another: only phase-1 content is read.
  const after: Record<string, string> = { ...existing };
  for (const f of kept) after[normalize(f.path)] = f.content;
  for (const f of candidates) {
    const p = normalize(f.path);
    const isNew = !(p in existing);
    if (scope.allowCreate !== false && isNew && newPathIsReferenced(p, scope.errors, after)) {
      kept.push(f);
      continue;
    }
    refused.push({ path: f.path, reason: 'outside-scope' });
  }
  return { kept, refused };
}

/** One admin-facing sentence for the report. No vendor names — nothing here mentions a model. */
export function repairScopeNote(pass: string, refused: RepairScopeResult['refused']): string {
  const tmpl = refused.filter((r) => r.reason === 'template-path').map((r) => r.path);
  const out = refused.filter((r) => r.reason === 'outside-scope').map((r) => r.path);
  const parts: string[] = [];
  if (tmpl.length) parts.push(`${tmpl.length} template path(s) (${tmpl.slice(0, 5).join(', ')})`);
  if (out.length) parts.push(`${out.length} file(s) it was not asked to repair and nothing imports (${out.slice(0, 8).join(', ')}${out.length > 8 ? ', …' : ''})`);
  return `The ${pass} repair tried to write ${parts.join(' and ')}. Those writes were refused; the files it was asked to fix were applied.`;
}
