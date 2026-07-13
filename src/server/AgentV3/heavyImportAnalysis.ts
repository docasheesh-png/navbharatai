// GA-16 (roadmap Tier 2C) — source-level bundle-weight analysis. `BundleSize` measures the BUILT dist/
// (post-build, real bytes); this catches bundle bloat at the SOURCE, during `evaluate`, BEFORE a build —
// two well-known, deterministic foot-guns that inflate a generated app's bundle:
//   1. importing a known-heavy library that has a lighter, drop-in-ish alternative (moment → dayjs/date-fns).
//   2. a whole-library default/namespace import of a tree-shakeable package (`import _ from 'lodash'`,
//      `import * as Icons from 'react-icons'`), which pulls the ENTIRE library into the bundle instead of
//      just the used members.
//
// PURE + deterministic (import-statement patterns only) with a curated, conservative catalog → zero false
// positives. Test/spec + type-declaration files and non-source files are skipped. ADVISORY only (surfaced
// in the evaluate report, never fed into the readiness gate) — bundle weight is a quality concern, not a
// correctness failure, so a heavy import never blocks a working build. Exported for unit tests.

export interface HeavyImportIssue {
  kind: 'heavy-dependency' | 'whole-library-import';
  package: string;
  severity: 'medium' | 'low';
  detail: string;
}

const SOURCE_RE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte)$/i;
const EXCLUDE_RE = /(\.test\.|\.spec\.|\.d\.ts$)/i;
const MAX_ISSUES = 20;

/** Known-heavy packages → a lighter, well-established alternative (kb are gzipped, order-of-magnitude). */
const HEAVY_ALTERNATIVES: Array<{ pkg: string; alt: string; note: string }> = [
  { pkg: 'moment', alt: 'dayjs or date-fns', note: '~70KB gzip and in maintenance mode' },
  { pkg: 'moment-timezone', alt: 'dayjs (+ the timezone plugin) or date-fns-tz', note: 'pulls in all tz data' },
  { pkg: 'lodash', alt: 'lodash-es with named imports, or per-method (lodash/debounce)', note: 'the default/namespace import bundles the whole library' },
];

/**
 * Packages that are tree-shakeable ONLY via named/deep imports — a DEFAULT (`import X from 'p'`) or
 * NAMESPACE (`import * as X from 'p'`) import bundles the whole thing. We flag those two import shapes.
 */
const TREE_SHAKE_SENSITIVE: Record<string, string> = {
  lodash: "import the methods you use — `import debounce from 'lodash/debounce'` (or use lodash-es with named imports)",
  'react-icons': "import icons from their specific set — `import { FaHome } from 'react-icons/fa'`",
  '@mui/icons-material': "import each icon directly — `import MenuIcon from '@mui/icons-material/Menu'`",
  'react-bootstrap': "import the components you use by name, not the whole library",
};

/** The module specifier of an import/export/require statement → its bare package name (or null). */
function importedPackage(spec: string): string | null {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/') || spec.startsWith('~')) return null;
  const parts = spec.split('/');
  if (spec.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

/**
 * Scan source files for heavy-dependency + whole-library-import bloat. One issue per (kind, package),
 * deduped across files. Deterministic + conservative. Pure.
 */
export function analyzeHeavyImports(
  sources: ReadonlyArray<{ path: string; content: string }>,
): HeavyImportIssue[] {
  const issues: HeavyImportIssue[] = [];
  const heavySeen = new Set<string>();
  const wholeSeen = new Set<string>();

  // `import <default|namespace> ... from 'pkg'` — capture the clause + the specifier.
  const IMPORT_RE = /import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g;

  for (const src of sources || []) {
    if (!src || typeof src !== 'object') continue;
    const { path, content } = src as { path: unknown; content: unknown };
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    if (!SOURCE_RE.test(path) || EXCLUDE_RE.test(path)) continue;

    for (const m of content.matchAll(IMPORT_RE)) {
      const clause = m[1].trim();
      const pkg = importedPackage(m[2]);
      if (!pkg) continue;

      // 1) Heavy dependency with a lighter alternative (any import of it).
      const heavy = HEAVY_ALTERNATIVES.find((h) => h.pkg === pkg);
      if (heavy && !heavySeen.has(pkg)) {
        heavySeen.add(pkg);
        issues.push({
          kind: 'heavy-dependency',
          package: pkg,
          severity: 'medium',
          detail: `'${pkg}' is heavy (${heavy.note}) — prefer ${heavy.alt} to cut bundle size.`,
        });
      }

      // 2) Whole-library import of a tree-shake-sensitive package: a DEFAULT or NAMESPACE import
      //    (not a `{ named }`-only import, and only the bare package — not a deep `pkg/sub` path).
      if (m[2] === pkg && pkg in TREE_SHAKE_SENSITIVE && !wholeSeen.has(pkg)) {
        const isNamespace = /\*\s+as\s+/.test(clause);
        // A default import is a leading bareword before any `{` or `,` (e.g. `_`, `Icons`).
        const isDefault = /^[A-Za-z_$][\w$]*(\s*,|\s*$)/.test(clause);
        if (isNamespace || isDefault) {
          wholeSeen.add(pkg);
          issues.push({
            kind: 'whole-library-import',
            package: pkg,
            severity: 'medium',
            detail: `'${pkg}' is imported as a whole library, which bundles all of it — ${TREE_SHAKE_SENSITIVE[pkg]}.`,
          });
        }
      }
    }
  }

  // Stable order: heavy-dependency first, then by package name.
  issues.sort((a, b) => (a.kind === b.kind ? a.package.localeCompare(b.package) : a.kind === 'heavy-dependency' ? -1 : 1));
  return issues.slice(0, MAX_ISSUES);
}

/** A concise, honest bundle-weight line for the evaluate report. Pure. */
export function heavyImportSummary(issues: HeavyImportIssue[]): string {
  if (!issues || issues.length === 0) {
    return 'Bundle weight: ✓ No known-heavy imports.';
  }
  const head = `Bundle weight: ${issues.length} heavy import(s) — lighter options exist:`;
  return [head, ...issues.map((i) => `  - [${i.severity}] ${i.detail}`)].join('\n');
}
