// AgentV3 — deterministic project-integrity checks for two real defect classes the existing analyzer
// suite (ArchitectureAnalysis / WorkspaceHealth / deadCode / Readiness) does NOT cover, surfaced by two
// real v3.0 build reports (Todo + Notes, 2026-07-11):
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

export interface ProjectIntegrityReport {
  /** Components that own initial focus. A conflict exists when this has 2+ entries. */
  focusOwners: FocusOwner[];
  /** Stylesheets imported by 2+ modules. */
  duplicateStylesheets: DuplicateStylesheet[];
  /** True when there is no integrity defect (≤1 focus owner AND no duplicate stylesheet). */
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

/** Run every project-integrity check over the written file set. Pure + deterministic. */
export function analyzeProjectIntegrity(files: Record<string, string>): ProjectIntegrityReport {
  const focusOwners = findFocusOwners(files);
  const duplicateStylesheets = findDuplicateStylesheets(files);
  const ok = focusOwners.length <= 1 && duplicateStylesheets.length === 0;
  return { focusOwners, duplicateStylesheets, ok };
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
  return parts.join('\n');
}
