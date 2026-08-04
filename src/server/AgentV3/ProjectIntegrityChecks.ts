// AgentV3 — deterministic project-integrity checks for two real defect classes the existing analyzer
// suite (ArchitectureAnalysis / WorkspaceHealth / deadCode / Readiness) does NOT cover, surfaced by two
// real v5.0 build reports (Todo + Notes, 2026-07-11):
//
//  1. FOCUS CONFLICT — more than one component grabs the INITIAL page focus at mount. In the Notes
//     build both NoteEditor and SearchBar called `.focus()` in a mount effect, so SearchBar (rendered
//     later) stole focus from NoteEditor and the required "auto-focus the note input" silently broke.
//     Only one component may own initial focus; 2+ owners is a guaranteed UX defect no compiler catches.
//
//  2. DUPLICATE STYLESHEET IMPORT — the same stylesheet side-effect-imported from more than one module
//     (the Notes build imported `global.css` from BOTH main.tsx and App.tsx). It compiles, but doubles
//     the rules — the class behind duplicated/compounded spacing and specificity surprises.
//
// PURE & deterministic (files in → findings out), so it is fully unit-testable and free (no LLM, no
// sandbox). Designed to feed the existing fast-lane repair gate: each finding carries a precise,
// actionable instruction the repair pass can act on, so these defects self-heal before a build ships.

import { isNonAppPath } from '../lib/nonAppPaths';

export interface FocusOwner {
  /** The component file that grabs initial focus. */
  file: string;
  /** How it grabs focus — a JSX `autoFocus` attribute or a mount-effect `.focus()` call. */
  mechanism: 'autoFocus' | 'mount-focus';
}

export interface DuplicateStylesheet {
  /** The stylesheet import specifier that appears in more than one module (as written). */
  stylesheet: string;
  /** The modules that each side-effect-import it. */
  importers: string[];
}

export interface OrphanStylesheet {
  /** The stylesheet file that exists in the project but is wired into NOTHING. */
  stylesheet: string;
}

export interface DuplicateEntryPoint {
  /** The source files that each mount a React root (createRoot().render / ReactDOM.render). */
  entries: string[];
}

export interface DuplicateComponentModule {
  /** The convention-root-relative module path shared by the copies, e.g. "components/IssueBoard/Column.tsx". */
  module: string;
  /** The 2+ concrete file paths that are copies of this module across different roots (sorted). */
  copies: string[];
}

export interface ProjectIntegrityReport {
  /** Components that own initial focus. A conflict exists when this has 2+ entries. */
  focusOwners: FocusOwner[];
  /** Stylesheets imported by 2+ modules. */
  duplicateStylesheets: DuplicateStylesheet[];
  /**
   * GLOBAL stylesheets imported by ZERO modules and linked from no HTML (NotesNest autopsy
   * 2026-07-16): the app compiled and "worked" but rendered as RAW unstyled HTML because
   * src/index.css was never imported anywhere — the exact inverse of duplicateStylesheets.
   */
  orphanStylesheets: OrphanStylesheet[];
  /**
   * DUPLICATE ENTRY POINTS (ShopKhata autopsy 2026-07-17): a full-stack build wrote its OWN React
   * entry (frontend/src/main.jsx: createRoot().render) while the scaffold's own src/main.tsx still
   * mounted a root too — INTEGRITY_DUPLICATE_STYLESHEET even caught "./index.css" imported by BOTH
   * mains. The preview boots exactly ONE root app; a second root is dead code and can make the WRONG
   * app serve. A well-formed app has exactly ONE root mount; 2+ is a guaranteed defect no compiler
   * catches. Present when this has 2+ entries.
   */
  duplicateEntryPoints: DuplicateEntryPoint[];
  /**
   * DUPLICATE COMPONENT MODULES (TaskForge autopsy 2026-07-18): the SAME module exists under two or more
   * convention roots — e.g. `IssueBoard/Column.tsx` present at BOTH `app/components/…` (Next.js `app/`
   * convention) and `src/components/…` (Vite convention). This happens when the app is driven with the
   * wrong framework (a Next.js-shaped app built as vite-react), so the builder writes parallel trees whose
   * interfaces then drift and produce compile errors the agent CANNOT clean up (the self-destruct guard
   * blocks deleting a directory of its own source) — the exact loop that burned 2 hours. Present when any
   * module has 2+ copies across different roots.
   */
  duplicateComponentModules: DuplicateComponentModule[];
  /** True when there is no integrity defect (≤1 focus owner; no duplicate/orphan stylesheet; ≤1 entry; no duplicate module). */
  ok: boolean;
}

// isNonAppPath: a tool/assistant scratch directory is not the user's source. Excluded HERE — the one
// predicate every analyzer below runs through — so a single edit keeps `.local/skills/**` scaffold
// templates out of ALL of them (duplicate entry points, duplicate stylesheets, focus owners, …), and
// out of the repairs those findings trigger. Mitrify autopsy 2026-08-04: four such templates were
// reported as duplicate React roots and then actually EDITED by the integrity repair, in an app they
// have no part in. See lib/nonAppPaths.ts.
const isSourceFile = (path: string): boolean =>
  /\.(t|j)sx?$/.test(path) && !/\.d\.ts$/.test(path) && !isNonAppPath(path);

/** Strip line and block comments so a commented-out `.focus()` / import never counts. Best-effort. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The last path segment, without a query/hash — so "../styles/global.css" and "./global.css" match. */
function stylesheetKey(spec: string): string {
  const clean = spec.split(/[?#]/)[0];
  const seg = clean.split('/').filter(Boolean).pop() ?? clean;
  return seg.toLowerCase();
}

/**
 * A build/framework config file (nuxt.config.ts, vite.config.ts, tailwind.config.js, app.config.ts, …).
 * These wire stylesheets by DECLARATION, not by `import`: Nuxt's `css: ['~/assets/css/main.css']` array,
 * a Vite `css` option, etc. A sheet named there is genuinely wired even though no module imports it, so
 * the orphan check must treat a config reference as a real reference (ShopSphere/Nuxt autopsy 2026-07-19:
 * `assets/css/main.css` wired in `nuxt.config.ts` was falsely reported "imported by nothing").
 */
const isConfigFile = (path: string): boolean => /(^|\/)[\w.-]*\.config\.[cm]?[jt]s$/i.test(path);

/**
 * Find every component that grabs INITIAL focus at mount. A component is a focus owner when it either
 * renders a JSX element with a bare `autoFocus` attribute, or calls `.focus()` inside a mount effect
 * (`useEffect(() => { … }, [])` with EMPTY deps — a focus call in a keyed/handler effect is deliberate
 * and NOT initial-focus ownership). Only ONE component should own initial focus.
 */
export function findFocusOwners(files: Record<string, string>): FocusOwner[] {
  const owners: FocusOwner[] = [];
  for (const [file, raw] of Object.entries(files)) {
    if (!isSourceFile(file) || typeof raw !== 'string') continue;
    const src = stripComments(raw);
    // (a) JSX autoFocus — `autoFocus` or `autoFocus={true}` (NOT autoFocus={false}).
    if (/\bautoFocus\b(?!\s*=\s*\{?\s*false)/.test(src)) {
      owners.push({ file, mechanism: 'autoFocus' });
      continue;
    }
    // (b) A `.focus()` call inside a mount effect with EMPTY deps. Scan each empty-deps useEffect body.
    const effectRe = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[\s*\]\s*\)/g;
    let m: RegExpExecArray | null;
    let found = false;
    while ((m = effectRe.exec(src)) !== null) {
      if (/\.focus\s*\(\s*\)/.test(m[1])) { found = true; break; }
    }
    if (found) owners.push({ file, mechanism: 'mount-focus' });
  }
  return owners;
}

/**
 * Find stylesheets side-effect-imported (`import "x.css"` — no bindings) from MORE THAN ONE module.
 * Keyed by filename so "../styles/global.css" and "./global.css" are recognised as the same sheet.
 */
export function findDuplicateStylesheets(files: Record<string, string>): DuplicateStylesheet[] {
  // key -> { spec (first-seen, as written), importers }
  const byKey = new Map<string, { spec: string; importers: Set<string> }>();
  const importRe = /import\s+['"]([^'"]+\.css)['"]/g;
  for (const [file, raw] of Object.entries(files)) {
    if (!isSourceFile(file) || typeof raw !== 'string') continue;
    const src = stripComments(raw);
    let m: RegExpExecArray | null;
    const seenInThisFile = new Set<string>();
    while ((m = importRe.exec(src)) !== null) {
      const spec = m[1];
      const key = stylesheetKey(spec);
      if (seenInThisFile.has(key)) continue; // a file importing the same sheet twice is one importer
      seenInThisFile.add(key);
      const entry = byKey.get(key) ?? { spec, importers: new Set<string>() };
      entry.importers.add(file);
      byKey.set(key, entry);
    }
  }
  const dups: DuplicateStylesheet[] = [];
  for (const { spec, importers } of byKey.values()) {
    if (importers.size >= 2) dups.push({ stylesheet: spec, importers: [...importers].sort() });
  }
  return dups.sort((a, b) => a.stylesheet.localeCompare(b.stylesheet));
}

/**
 * Find GLOBAL stylesheets that exist in the project but are wired into NOTHING — no side-effect
 * `import "….css"` from any module AND no `<link …href="….css">` in any HTML file. Such an app ships
 * as raw unstyled HTML (real case: NotesNest 2026-07-16 — the fast lane generated a full src/index.css,
 * the fallback full builder hand-wrote main.tsx WITHOUT the import, and nothing anywhere checked).
 * CSS Modules (`*.module.css`) are excluded — an unused module sheet is dead code, not an unstyled app.
 */
export function findOrphanStylesheets(files: Record<string, string>): OrphanStylesheet[] {
  const cssFiles = Object.keys(files).filter((p) => /\.css$/i.test(p) && !/\.module\.css$/i.test(p));
  if (cssFiles.length === 0) return [];
  // Collect every stylesheet reference: JS/TS side-effect imports + HTML <link href>.
  const referencedKeys = new Set<string>();
  const importRe = /import\s+['"]([^'"]+\.css)['"]/g;
  const linkRe = /<link\b[^>]*href\s*=\s*['"]([^'"]+\.css)['"]/gi;
  // In a config file a stylesheet is wired by DECLARATION (Nuxt `css: ['~/assets/css/main.css']`), not
  // an `import` statement, so match every quoted `.css` string literal there — not only imports.
  const anyCssRe = /['"]([^'"]+\.css)['"]/g;
  for (const [file, raw] of Object.entries(files)) {
    if (typeof raw !== 'string') continue;
    if (isConfigFile(file)) {
      const src = stripComments(raw);
      let m: RegExpExecArray | null;
      anyCssRe.lastIndex = 0;
      while ((m = anyCssRe.exec(src)) !== null) referencedKeys.add(stylesheetKey(m[1]));
    } else if (isSourceFile(file)) {
      const src = stripComments(raw);
      let m: RegExpExecArray | null;
      importRe.lastIndex = 0;
      while ((m = importRe.exec(src)) !== null) referencedKeys.add(stylesheetKey(m[1]));
    } else if (/\.html?$/i.test(file)) {
      let m: RegExpExecArray | null;
      linkRe.lastIndex = 0;
      while ((m = linkRe.exec(raw)) !== null) referencedKeys.add(stylesheetKey(m[1]));
    }
  }
  return cssFiles
    .filter((p) => !referencedKeys.has(stylesheetKey(p)))
    .sort()
    .map((stylesheet) => ({ stylesheet }));
}

/**
 * DETERMINISTIC FIX for an orphan GLOBAL stylesheet: inject its side-effect import at the top of the
 * app's entry module (src/main.tsx / main.jsx / main.ts / index.tsx …) so the app is actually styled.
 * Returns the updated files plus what was injected (empty = nothing to do / no entry to inject into).
 * Only fires for an orphan named like a global sheet living beside the entry (index/main/app/global/
 * style[s].css) — an unreferenced feature-level sheet stays a report finding for the LLM repair pass,
 * because guessing its importer would be wrong more often than right. Pure.
 */
export function injectGlobalStylesheetImport(
  files: Record<string, string>,
): { files: Record<string, string>; injected: Array<{ stylesheet: string; entry: string }> } {
  const orphans = findOrphanStylesheets(files);
  if (orphans.length === 0) return { files, injected: [] };
  const entry = ['src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/index.tsx', 'src/index.jsx', 'main.tsx']
    .find((p) => typeof files[p] === 'string');
  if (!entry) return { files, injected: [] };
  const entryDir = entry.slice(0, entry.lastIndexOf('/') + 1); // '' when the entry sits at the root
  const globalName = /^(index|main|app|global|globals|style|styles)\.css$/i;
  const out = { ...files };
  const injected: Array<{ stylesheet: string; entry: string }> = [];
  for (const { stylesheet } of orphans) {
    const base = stylesheet.split('/').pop() ?? stylesheet;
    if (!globalName.test(base)) continue; // feature-level sheet — leave to the repair pass
    // Import specifier relative to the entry: same dir → './x.css'; otherwise from the project root.
    const spec = stylesheet.startsWith(entryDir) && entryDir
      ? `./${stylesheet.slice(entryDir.length)}`
      : `/${stylesheet}`.replace('//', '/');
    out[entry] = `import '${spec}';\n${out[entry]}`;
    injected.push({ stylesheet, entry });
  }
  return { files: out, injected };
}

/** True when a source file mounts a React root — createRoot(x).render(…) or ReactDOM.render(…). Pure. */
function mountsReactRoot(raw: string): boolean {
  const src = stripComments(raw);
  // createRoot(…).render(  — the container arg + an optional line break before .render (react-dom/client).
  if (/\bcreateRoot\s*\([\s\S]{0,200}?\)\s*(?:\r?\n\s*)?\.\s*render\s*\(/.test(src)) return true;
  // Legacy ReactDOM.render(  /  ReactDom.render(  (react-dom).
  if (/\bReactDOM\s*\.\s*render\s*\(/i.test(src)) return true;
  return false;
}

/**
 * Find DUPLICATE React ENTRY POINTS — 2+ source files that each mount a root. The preview boots exactly
 * one root; a second is dead code and can make the WRONG app serve (ShopKhata: the scaffold's
 * src/main.tsx + a generated frontend/src/main.jsx). Zero or one entry = fine. Pure & deterministic.
 */
export function findDuplicateEntryPoints(files: Record<string, string>): DuplicateEntryPoint[] {
  const entries: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!isSourceFile(path) || typeof content !== 'string') continue;
    if (mountsReactRoot(content)) entries.push(path);
  }
  return entries.length >= 2 ? [{ entries: entries.sort() }] : [];
}

// Convention roots a front-end app may put source under. Checked LONGEST-FIRST so `src/app/x` strips
// `src/app/` (not `src/`) — otherwise a `src/app/` file and an `app/` file wouldn't share a key.
const CONVENTION_ROOTS = ['src/app/', 'src/', 'app/'];

/** The path with its leading convention root removed, or null when the file isn't under one. */
export function conventionRelative(path: string): string | null {
  for (const root of CONVENTION_ROOTS) {
    if (path.startsWith(root)) return path.slice(root.length);
  }
  return null;
}

/**
 * The same module's paths under the OTHER convention roots — e.g. for `app/components/X.tsx` returns
 * `['src/app/components/X.tsx', 'src/components/X.tsx']`. Empty when the path isn't under a convention
 * root. Used at write time to refuse creating a parallel copy of a module that already exists. Pure.
 */
export function conventionRootAlternatives(path: string): string[] {
  const rel = conventionRelative(path);
  if (rel === null) return [];
  const out: string[] = [];
  for (const root of CONVENTION_ROOTS) {
    const alt = root + rel;
    if (alt !== path) out.push(alt);
  }
  return out;
}

/**
 * Given a path being written and the set of paths that ALREADY exist, return the existing copy of the
 * same module under a DIFFERENT convention root (the write would duplicate it), or null. Pure & testable.
 */
export function duplicateModuleTarget(path: string, existingPaths: Iterable<string>): string | null {
  if (!isSourceFile(path)) return null;
  const alts = new Set(conventionRootAlternatives(path));
  if (alts.size === 0) return null;
  for (const p of existingPaths) {
    if (p !== path && alts.has(p)) return p;
  }
  return null;
}

/**
 * Find modules that exist under 2+ convention roots (TaskForge autopsy). Keys each source file by its
 * convention-root-relative path (`app/components/IssueBoard/Column.tsx` and `src/components/IssueBoard/
 * Column.tsx` both key to `components/IssueBoard/Column.tsx`); any key with 2+ concrete files is a
 * cross-root duplicate. Precise by construction — two files only collide when they share the SAME
 * sub-path under DIFFERENT roots, so unrelated `feature-a/utils/index.ts` vs `feature-b/utils/index.ts`
 * never match. Pure & deterministic.
 */
export function findDuplicateComponentModules(files: Record<string, string>): DuplicateComponentModule[] {
  const groups = new Map<string, string[]>();
  for (const path of Object.keys(files)) {
    if (!isSourceFile(path) || typeof files[path] !== 'string') continue;
    const rel = conventionRelative(path);
    if (!rel) continue;
    const bucket = groups.get(rel);
    if (bucket) bucket.push(path); else groups.set(rel, [path]);
  }
  const out: DuplicateComponentModule[] = [];
  for (const [module, copies] of groups) {
    if (copies.length >= 2) out.push({ module, copies: copies.sort() });
  }
  return out.sort((a, b) => a.module.localeCompare(b.module));
}

/** Run every project-integrity check over the written file set. Pure + deterministic. */
export function analyzeProjectIntegrity(files: Record<string, string>): ProjectIntegrityReport {
  const focusOwners = findFocusOwners(files);
  const duplicateStylesheets = findDuplicateStylesheets(files);
  const orphanStylesheets = findOrphanStylesheets(files);
  const duplicateEntryPoints = findDuplicateEntryPoints(files);
  const duplicateComponentModules = findDuplicateComponentModules(files);
  const ok = focusOwners.length <= 1 && duplicateStylesheets.length === 0
    && orphanStylesheets.length === 0 && duplicateEntryPoints.length === 0
    && duplicateComponentModules.length === 0;
  return { focusOwners, duplicateStylesheets, orphanStylesheets, duplicateEntryPoints, duplicateComponentModules, ok };
}

/**
 * Render the integrity findings as a precise, actionable repair instruction for the existing fast-lane
 * repair pass — or '' when there is nothing to fix. Names the exact files so the repair edits them
 * surgically (keep ONE focus owner; import a shared stylesheet from exactly one module).
 */
export function integrityRepairInstruction(report: ProjectIntegrityReport): string {
  const parts: string[] = [];
  if (report.focusOwners.length >= 2) {
    const list = report.focusOwners.map((o) => `${o.file} (${o.mechanism})`).join(', ');
    parts.push(
      `FOCUS CONFLICT — ${report.focusOwners.length} components grab initial focus at mount: ${list}. ` +
      `Only ONE component may own the initial page focus. Keep the primary input's focus (the one the ` +
      `app's requirement asks to auto-focus) and REMOVE the mount-time focus (autoFocus attribute or the ` +
      `\`.focus()\` mount effect) from the other component(s).`,
    );
  }
  for (const d of report.duplicateStylesheets) {
    parts.push(
      `DUPLICATE STYLESHEET — "${d.stylesheet}" is imported by ${d.importers.length} modules ` +
      `(${d.importers.join(', ')}). Import a shared/global stylesheet from EXACTLY ONE module (the entry, ` +
      `e.g. main.tsx) and remove the duplicate import from the other(s).`,
    );
  }
  for (const o of report.orphanStylesheets) {
    parts.push(
      `ORPHAN STYLESHEET — "${o.stylesheet}" exists but is imported by NOTHING (no module imports it and ` +
      `no HTML links it), so the app renders as raw unstyled HTML. Add a side-effect import for it in the ` +
      `entry module (e.g. \`import './index.css'\` in src/main.tsx), or in the one component it belongs to.`,
    );
  }
  for (const d of report.duplicateEntryPoints) {
    parts.push(
      `DUPLICATE ENTRY POINTS — ${d.entries.length} files each mount a React root: ${d.entries.join(', ')}. ` +
      `The preview boots exactly ONE root app, so the others are dead code (and can make the wrong app ` +
      `serve). Keep the SINGLE entry the app is served from (the root src/main.tsx / src/index.tsx) and ` +
      `remove the root mount (createRoot().render / ReactDOM.render) from the other file(s).`,
    );
  }
  for (const d of report.duplicateComponentModules) {
    parts.push(
      `DUPLICATE MODULE — "${d.module}" exists in ${d.copies.length} places: ${d.copies.join(', ')}. ` +
      `These are copies of the same component under different convention roots (a Next.js \`app/\` tree ` +
      `and a Vite \`src/\` tree), and their interfaces drift and break the build. Keep the ONE copy the ` +
      `app's entry actually imports (the canonical file) and, for each OTHER copy, replace its whole ` +
      `contents with a re-export from the canonical one (e.g. \`export * from '<relative path to canonical>';\`) ` +
      `— a valid, guard-safe edit that removes the drift. Do NOT try to delete the directory (governance ` +
      `refuses a source-dir delete); a re-export stub is the correct fix.`,
    );
  }
  return parts.join('\n');
}

// === MIXED IMPORT SPECIFIERS (FitPulse autopsy 2026-07-17) =========================================
// The SAME project module imported via DIFFERENT specifier styles (relative './context/ThemeContext'
// vs baseUrl 'context/ThemeContext' vs alias '@/context/ThemeContext'). tsc + Vite dev (with
// vite-tsconfig-paths) resolve all forms to ONE module — but the IN-BROWSER preview bundler treats
// them as TWO modules, so a React context created in that file exists TWICE: the provider sets one
// instance, the hook reads the other → "useX must be used within a XProvider" crash that only the
// user's preview shows. Deterministic fix: normalize every project-module import to the relative form.

export interface MixedSpecifierModule {
  /** The resolved project module (a real file key, e.g. src/context/ThemeContext.tsx). */
  module: string;
  /** The distinct raw specifier strings used for it. */
  specifiers: string[];
}

const CODE_RESOLVE_SUFFIXES = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];

/** Join + normalize a POSIX-ish path (handles ./ and ../ segments). Returns null if it escapes root. */
function joinPath(baseDir: string, rel: string): string | null {
  const parts = (baseDir ? baseDir.split('/') : []).filter(Boolean);
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

/** Resolve an import specifier to a project file key, or null when it's a package/unknown. */
export function resolveProjectSpecifier(
  files: Record<string, string>, importer: string, spec: string,
): string | null {
  const clean = spec.split(/[?#]/)[0];
  let base: string | null = null;
  if (clean.startsWith('./') || clean.startsWith('../')) {
    base = joinPath(importer.slice(0, importer.lastIndexOf('/')), clean);
  } else if (clean.startsWith('@/')) {
    base = `src/${clean.slice(2)}`;
  } else if (!clean.startsWith('/')) {
    base = `src/${clean}`; // tsconfig baseUrl:"src" bare form — only counts if it actually resolves
  }
  if (!base) return null;
  if (files[base] !== undefined) return base;
  for (const suf of CODE_RESOLVE_SUFFIXES) if (files[base + suf] !== undefined) return base + suf;
  return null;
}

const ANY_IMPORT_RE = /(\bimport\s+(?:[\w*{},\s$]+\s+from\s+)?|\bexport\s+[\w*{},\s$]+\s+from\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

/** The RESOLUTION KIND of a specifier. Two relative spellings resolve identically in every bundler;
 *  the duplicate-module risk exists only when KINDS mix (relative vs baseUrl-bare vs @/alias) —
 *  a naive string-keyed bundler then instantiates the same file under two module keys. */
function specifierKind(spec: string): 'relative' | 'alias' | 'bare' {
  if (spec.startsWith('./') || spec.startsWith('../')) return 'relative';
  if (spec.startsWith('@/')) return 'alias';
  return 'bare';
}

/** Find project modules imported via 2+ DISTINCT specifier KINDS (the duplicate-module crash class). */
export function findMixedImportSpecifiers(files: Record<string, string>): MixedSpecifierModule[] {
  const byModule = new Map<string, { specs: Set<string>; kinds: Set<string> }>();
  for (const [file, raw] of Object.entries(files)) {
    if (!isSourceFile(file) || typeof raw !== 'string') continue;
    const src = stripComments(raw);
    let m: RegExpExecArray | null;
    while ((m = ANY_IMPORT_RE.exec(src)) !== null) {
      const spec = m[2];
      if (spec.endsWith('.css')) continue; // stylesheets have their own checks
      const resolved = resolveProjectSpecifier(files, file, spec);
      if (!resolved) continue;
      const entry = byModule.get(resolved) ?? { specs: new Set<string>(), kinds: new Set<string>() };
      entry.specs.add(spec);
      entry.kinds.add(specifierKind(spec));
      byModule.set(resolved, entry);
    }
  }
  const out: MixedSpecifierModule[] = [];
  for (const [module, { specs, kinds }] of byModule) {
    if (kinds.size >= 2) out.push({ module, specifiers: [...specs].sort() });
  }
  return out.sort((a, b) => a.module.localeCompare(b.module));
}

/** The canonical RELATIVE specifier from an importer to a module file (extensionless for code). */
export function relativeSpecifier(importer: string, module: string): string {
  const from = importer.split('/').slice(0, -1);
  const to = module.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = from.length - i;
  const down = to.slice(i).join('/');
  let rel = (up === 0 ? './' : '../'.repeat(up)) + down;
  rel = rel.replace(/\/index\.(t|j)sx?$/, '').replace(/\.(t|j)sx?$/, '');
  return rel;
}

/**
 * Positions in `src` that are REAL CODE — i.e. not inside a string, template literal, or comment.
 *
 * ROOT CAUSE (navbharatai self-import autopsy 2026-07-27, buildId d1623410): `normalizeImportSpecifiers`
 * rewrote specifiers with a blind regex over raw file text, so it also matched quoted text inside
 * ordinary string literals, comments, and the template literals of this repo's many CODE GENERATORS.
 * It corrupted `src/server/lib/DbConfigGenerator.ts` line 125 — a single-quoted *documentation* string
 * that happens to contain `import { db } from "@/lib/firebase"` — producing
 * `'… from '../../lib/firebase'. …'`, which terminates the enclosing string early and yields exactly
 * the reported `Expected identifier but found "."`. It also silently rewrote test fixtures
 * (ViteReactProvider.test.ts, previewBundle.test.ts, reactPreview.test.ts).
 *
 * Deliberately CONSERVATIVE — the only failure mode we accept is "declined a legitimate rewrite",
 * never "corrupted a file". Handles line/block comments, both quote styles with escapes, template
 * literals (with `${…}` returning to code), and uses the standard prev-significant-char heuristic to
 * tell a regex literal from division. Anything it cannot classify stays marked NOT-code, so no rewrite
 * happens there. PURE + tested.
 */
export function codePositions(src: string): Uint8Array {
  const n = src.length;
  const mask = new Uint8Array(n); // 1 = real code position
  // Template-literal nesting: each entry is the brace depth at which the current `${` began.
  const tmplStack: number[] = [];
  let braceDepth = 0;
  let i = 0;
  let prevSignificant = '';
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    // ── comments ──────────────────────────────────────────────────────────────
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // ── regex literal (heuristic: a `/` right after an operator/keyword position) ──
    if (c === '/' && /[=([,;:!&|?{}+\-*%~^<>]|^$/.test(prevSignificant)) {
      i++;
      let closed = false;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '\n') break;              // unterminated → bail out safely
        if (src[i] === '[') { while (i < n && src[i] !== ']' && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } }
        if (src[i] === '/') { i++; closed = true; break; }
        i++;
      }
      if (!closed) { /* not a regex after all — keep scanning from here */ }
      prevSignificant = '/';
      continue;
    }
    // ── strings ───────────────────────────────────────────────────────────────
    if (c === '\'' || c === '"') {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '\n') break;              // unterminated string → stop, stay safe
        if (src[i] === quote) { i++; break; }
        i++;
      }
      prevSignificant = quote;
      continue;
    }
    // ── template literals (code resumes inside `${ … }`) ──────────────────────
    if (c === '`') {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          tmplStack.push(braceDepth);
          braceDepth++;
          i += 2;
          // Inside ${…} we are back in code: mark it and let the outer loop handle it.
          const start = i;
          let d = 1;
          while (i < n && d > 0) {
            if (src[i] === '{') d++;
            else if (src[i] === '}') d--;
            if (d > 0) i++;
          }
          for (let k = start; k < i && k < n; k++) mask[k] = 1;
          braceDepth--;
          tmplStack.pop();
          if (i < n) i++; // consume '}'
          continue;
        }
        i++;
      }
      prevSignificant = '`';
      continue;
    }
    // ── ordinary code ─────────────────────────────────────────────────────────
    mask[i] = 1;
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return mask;
}

/**
 * DETERMINISTIC FIX: rewrite every import of a mixed-specifier module to the canonical relative form,
 * so every bundler (including the in-browser preview) sees ONE module instance. Pure.
 *
 * SAFETY (autopsy 2026-07-27 — see codePositions): a rewrite happens ONLY when the specifier sits in a
 * genuine module-specifier position (`from "X"`, bare `import "X"`, `require("X")`, `import("X")`) at a
 * REAL CODE offset — never inside a string, comment, or generator template — and the ORIGINAL QUOTE
 * CHARACTER is preserved, so a replacement can never terminate an enclosing string.
 */
export function normalizeImportSpecifiers(
  files: Record<string, string>,
): { files: Record<string, string>; rewrites: Array<{ file: string; from: string; to: string }> } {
  const mixed = findMixedImportSpecifiers(files);
  if (mixed.length === 0) return { files, rewrites: [] };
  const targets = new Map(mixed.map((m) => [m.module, new Set(m.specifiers)] as const));
  const out = { ...files };
  const rewrites: Array<{ file: string; from: string; to: string }> = [];
  for (const [file, raw] of Object.entries(files)) {
    if (!isSourceFile(file) || typeof raw !== 'string') continue;
    let next = raw;
    for (const [module, specs] of targets) {
      const canonical = relativeSpecifier(file, module);
      for (const spec of specs) {
        if (spec === canonical) continue;
        if (resolveProjectSpecifier(files, file, spec) !== module) continue; // this file's spec resolves elsewhere
        const esc = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Genuine module-specifier positions only: `… from "X"`, bare `import "X"`,
        // `require("X")`, `import("X")`. The leading group is preserved verbatim.
        const re = new RegExp(
          `(\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s+)(['"])${esc}\\2`,
          'g',
        );
        // Recomputed per pass: an earlier rewrite shifts offsets, and the mask must match `next`.
        const mask = codePositions(next);
        let changed = false;
        const replaced = next.replace(re, (match, lead: string, quote: string, offset: number) => {
          // Test the LEADING KEYWORD's offset, not the quote's: a string's opening quote is never
          // itself a "code" position, so checking it would reject every genuine import too.
          if (!mask[offset]) return match; // keyword sits inside a string/comment/template → leave it
          changed = true;
          return `${lead}${quote}${canonical}${quote}`;       // preserve the ORIGINAL quote character
        });
        if (changed) { next = replaced; rewrites.push({ file, from: spec, to: canonical }); }
      }
    }
    if (next !== raw) out[file] = next;
  }
  return { files: out, rewrites };
}
