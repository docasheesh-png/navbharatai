// GA-12 (static-quality engines) — coupling / fan-in hotspot analyzer.
//
// The leading reason a growing app becomes fragile is a few modules that everything else imports. A util or
// type file imported by 20+ modules is a CHANGE-RISK HOTSPOT: touching it risks breaking a wide blast radius,
// and it is usually a sign the module has grown into an unfocused grab-bag. The mirror smell is a single file
// that itself imports from very many internal modules (high fan-out / a "God module" doing too much). Both are
// well-established coupling signals that predict where a big app will struggle.
//
// This builds the app's INTERNAL import graph (relative imports only — external packages are not the app's own
// coupling), then flags: (a) fan-in hotspots (a module imported by many others), and (b) high-fan-out God
// modules. ADVISORY only: surfaced in `evaluate`, NEVER a readiness blocker (coupling is a quality concern,
// not a correctness failure — blocking a working app over it would break the one absolute rule). AST-accurate
// via ts-morph; PURE; never throws (any parse/library problem yields no findings, so it can only add a true
// signal, never a false block).

export interface CouplingIssue {
  kind: 'fan-in-hotspot' | 'god-module';
  /** The module the finding is about. */
  file: string;
  /** Afferent coupling (how many other modules import this) for fan-in; efferent (internal imports) for god-module. */
  degree: number;
  detail: string;
}

const CODE_FILE = /\.(?:m?[jt]sx?)$/i;
const EXCLUDE = /(\.test\.|\.spec\.|\.d\.ts$)/;

// A module imported by at least this many OTHER modules is a fan-in hotspot (wide change blast-radius).
const FAN_IN_HOTSPOT = 8;
// A module that itself pulls in at least this many DISTINCT internal modules is a God module (doing too much).
const GOD_MODULE_FANOUT = 15;
const MAX_ISSUES = 20;

const CANDIDATE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const INDEX_FILES = CANDIDATE_EXTS.map((e) => `/index${e}`);

let TsMorph: any;
async function loadTsMorph(): Promise<any | null> {
  if (TsMorph) return TsMorph;
  try { TsMorph = await import('ts-morph'); return TsMorph; } catch { return null; }
}

/** Directory portion of a POSIX-style path ('' for a root-level file). */
function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/** Resolve a relative specifier against the importer's directory into a canonical dot/dotdot-free base path. */
function resolveRelative(fromDir: string, spec: string): string {
  const segs = (fromDir ? fromDir.split('/') : []).concat(spec.split('/'));
  const out: string[] = [];
  for (const s of segs) {
    if (s === '' || s === '.') continue;
    if (s === '..') { out.pop(); continue; }
    out.push(s);
  }
  return out.join('/');
}

/** Map a resolved base path to a real file in the known set, trying extensions and /index. null if unresolved. */
function matchTarget(base: string, known: Set<string>): string | null {
  if (known.has(base)) return base; // already had an extension in the specifier
  for (const e of CANDIDATE_EXTS) if (known.has(base + e)) return base + e;
  for (const idx of INDEX_FILES) if (known.has(base + idx)) return base + idx;
  return null;
}

/**
 * Build the internal import graph and flag fan-in hotspots + high-fan-out God modules. Deterministic,
 * AST-accurate, advisory. Sorted (worst degree first, then path), capped. Never throws.
 */
export async function analyzeCoupling(
  sources: ReadonlyArray<{ path: string; content: string }>,
): Promise<CouplingIssue[]> {
  const mod = await loadTsMorph();
  if (!mod) return [];
  const { SyntaxKind } = mod;
  let project: any;
  try { project = new mod.Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true, jsx: 2 } }); }
  catch { return []; }

  // Normalize the candidate file set once (strip a leading './').
  const files: Array<{ path: string; content: string }> = [];
  const known = new Set<string>();
  for (const src of sources || []) {
    if (!src || typeof src !== 'object') continue;
    const { path, content } = src as { path: unknown; content: unknown };
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    const norm = path.replace(/^\.\//, '');
    if (!CODE_FILE.test(norm) || EXCLUDE.test(norm)) continue;
    files.push({ path: norm, content });
    known.add(norm);
  }
  if (files.length < 2) return [];

  const fanIn = new Map<string, Set<string>>();   // target file -> set of importer files
  const fanOut = new Map<string, Set<string>>();  // importer file -> set of internal target files

  for (const { path, content } of files) {
    let sf: any;
    try { sf = project.createSourceFile(path, content, { overwrite: true }); } catch { continue; }

    // Collect every module specifier from static imports and re-export-from declarations.
    const specs: string[] = [];
    try {
      for (const imp of sf.getImportDeclarations?.() ?? []) {
        const v = imp.getModuleSpecifierValue?.();
        if (typeof v === 'string') specs.push(v);
      }
      for (const exp of sf.getExportDeclarations?.() ?? []) {
        const v = exp.getModuleSpecifierValue?.();
        if (typeof v === 'string') specs.push(v);
      }
      // Dynamic `import('...')` calls.
      for (const call of sf.getDescendantsOfKind?.(SyntaxKind.CallExpression) ?? []) {
        try {
          if (call.getExpression?.()?.getKind?.() === SyntaxKind.ImportKeyword) {
            const arg = call.getArguments?.()[0];
            if (arg?.getKind?.() === SyntaxKind.StringLiteral) specs.push(arg.getLiteralText?.() ?? '');
          }
        } catch { /* ignore */ }
      }
    } catch { continue; }

    const fromDir = dirOf(path);
    for (const spec of specs) {
      if (!spec || (spec[0] !== '.')) continue; // internal (relative) imports only
      const base = resolveRelative(fromDir, spec);
      const target = matchTarget(base, known);
      if (!target || target === path) continue; // unresolved or self-import
      if (!fanIn.has(target)) fanIn.set(target, new Set());
      fanIn.get(target)!.add(path);
      if (!fanOut.has(path)) fanOut.set(path, new Set());
      fanOut.get(path)!.add(target);
    }
  }

  const issues: CouplingIssue[] = [];
  for (const [target, importers] of fanIn) {
    if (importers.size >= FAN_IN_HOTSPOT) {
      issues.push({
        kind: 'fan-in-hotspot', file: target, degree: importers.size,
        detail: `'${target}' is imported by ${importers.size} other modules — a coupling hotspot with a wide change blast-radius. A change here can break many dependents; consider splitting it into focused modules or stabilizing its public surface (an index barrel with a narrow, versioned API).`,
      });
    }
  }
  for (const [file, targets] of fanOut) {
    if (targets.size >= GOD_MODULE_FANOUT) {
      issues.push({
        kind: 'god-module', file, degree: targets.size,
        detail: `'${file}' imports from ${targets.size} internal modules — a high fan-out "God module" doing too much. Consider extracting cohesive responsibilities into separate units so it is easier to change and test.`,
      });
    }
  }
  return issues.sort((a, b) => b.degree - a.degree || a.file.localeCompare(b.file)).slice(0, MAX_ISSUES);
}

/** Advisory report line(s), or '' when clean. Pure. */
export function couplingSummary(issues: CouplingIssue[]): string {
  if (!issues || issues.length === 0) return '';
  const shown = issues.slice(0, 8).map((i) =>
    i.kind === 'fan-in-hotspot'
      ? `  ⚠️ ${i.file} — imported by ${i.degree} modules (coupling hotspot)`
      : `  ⚠️ ${i.file} — imports ${i.degree} internal modules (God module)`,
  );
  return `Coupling — ${issues.length} architecture hotspot(s) (high fan-in/fan-out; a wide change blast-radius):\n${shown.join('\n')}${issues.length > 8 ? `\n  …and ${issues.length - 8} more` : ''}`;
}
