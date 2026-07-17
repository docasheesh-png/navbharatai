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
  /** True when there is no integrity defect (≤1 focus owner; no duplicate/orphan stylesheet; ≤1 entry). */
  ok: boolean;
}

const isSourceFile = (path: string): boolean => /\.(t|j)sx?$/.test(path) && !/\.d\.ts$/.test(path);

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
  for (const [file, raw] of Object.entries(files)) {
    if (typeof raw !== 'string') continue;
    if (isSourceFile(file)) {
      const src = stripComments(raw);
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src)) !== null) referencedKeys.add(stylesheetKey(m[1]));
    } else if (/\.html?$/i.test(file)) {
      let m: RegExpExecArray | null;
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

/** Run every project-integrity check over the written file set. Pure + deterministic. */
export function analyzeProjectIntegrity(files: Record<string, string>): ProjectIntegrityReport {
  const focusOwners = findFocusOwners(files);
  const duplicateStylesheets = findDuplicateStylesheets(files);
  const orphanStylesheets = findOrphanStylesheets(files);
  const duplicateEntryPoints = findDuplicateEntryPoints(files);
  const ok = focusOwners.length <= 1 && duplicateStylesheets.length === 0
    && orphanStylesheets.length === 0 && duplicateEntryPoints.length === 0;
  return { focusOwners, duplicateStylesheets, orphanStylesheets, duplicateEntryPoints, ok };
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
 * DETERMINISTIC FIX: rewrite every import of a mixed-specifier module to the canonical relative form,
 * so every bundler (including the in-browser preview) sees ONE module instance. Pure.
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
        const re = new RegExp(`(['"])${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'g');
        const replaced = next.replace(re, `'${canonical}'`);
        if (replaced !== next) { next = replaced; rewrites.push({ file, from: spec, to: canonical }); }
      }
    }
    if (next !== raw) out[file] = next;
  }
  return { files: out, rewrites };
}
