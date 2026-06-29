// P-CGE.3 — Convention & Naming Engine.
//
// A pure, dependency-free engine that checks (and suggests fixes for) naming + import-order
// conventions in generated code, so output is consistent across LLM calls:
//   • file naming   — PascalCase for React components (.tsx), camelCase for services/hooks (.ts)
//   • identifiers   — camelCase functions, SCREAMING_SNAKE constants, PascalCase components/types
//   • import order  — built-ins → external → internal (@/ , src/) → relative, alphabetised
//
// HONESTY: every result is derived from the input. When a name already matches its expected
// convention the engine reports `ok` and suggests nothing — it never invents a "violation".

export type NameCase = 'PascalCase' | 'camelCase' | 'snake_case' | 'SCREAMING_SNAKE' | 'kebab-case' | 'unknown';

const splitWords = (raw: string): string[] => {
  // Split a name into lowercase word tokens regardless of its original casing.
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')   // camel/Pascal boundaries
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMWord boundary
    .replace(/[_\-.\s]+/g, ' ')                 // snake / kebab / dot / space
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
};

const cap = (w: string): string => (w ? w[0].toUpperCase() + w.slice(1) : w);

/** Detect the casing convention of a bare identifier (no extension). */
export function detectCase(name: string): NameCase {
  if (!name) return 'unknown';
  if (/^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name)) return 'PascalCase';
  if (/^[a-z][A-Za-z0-9]*$/.test(name) && /[A-Z]/.test(name)) return 'camelCase';
  if (/^[a-z][a-z0-9]*$/.test(name)) return 'camelCase'; // all-lowercase single word
  if (/^[A-Z][A-Z0-9_]*$/.test(name) && name.includes('_')) return 'SCREAMING_SNAKE';
  if (/^[A-Z0-9]+$/.test(name)) return 'SCREAMING_SNAKE'; // all-caps single word
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(name)) return 'snake_case';
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(name)) return 'kebab-case';
  return 'unknown';
}

/** Convert a name to a target case. */
export function toCase(name: string, target: NameCase): string {
  const words = splitWords(name);
  if (words.length === 0) return name;
  switch (target) {
    case 'PascalCase': return words.map(cap).join('');
    case 'camelCase': return words[0] + words.slice(1).map(cap).join('');
    case 'snake_case': return words.join('_');
    case 'SCREAMING_SNAKE': return words.join('_').toUpperCase();
    case 'kebab-case': return words.join('-');
    default: return name;
  }
}

export interface FileNameCheck {
  ok: boolean;
  path: string;
  expectedCase: NameCase;
  suggestion: string | null;
  reason: string;
}

/**
 * Check a file's base name against the convention for its kind:
 * `.tsx` (and `.jsx`) components → PascalCase; other `.ts`/`.js` (services/hooks) → camelCase.
 * Dotted infixes (`.test`, `.d`, `.config`, …) and index files are left alone.
 */
export function checkFileName(filePath: string): FileNameCheck {
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const file = filePath.slice(slash + 1);
  const dot = file.indexOf('.');
  const base = dot >= 0 ? file.slice(0, dot) : file;
  const ext = dot >= 0 ? file.slice(dot) : '';
  const isComponent = /\.(tsx|jsx)$/.test(ext);
  const expectedCase: NameCase = isComponent ? 'PascalCase' : 'camelCase';

  // Leave index files and dotted multi-part names (e.g. foo.test, vite.config) untouched.
  if (base.toLowerCase() === 'index' || ext.split('.').filter(Boolean).length > 1) {
    return { ok: true, path: filePath, expectedCase, suggestion: null, reason: 'index/dotted file — convention not enforced' };
  }
  const current = detectCase(base);
  if (current === expectedCase) {
    return { ok: true, path: filePath, expectedCase, suggestion: null, reason: 'matches convention' };
  }
  const fixedBase = toCase(base, expectedCase);
  const suggestion = filePath.slice(0, slash + 1) + fixedBase + ext;
  return {
    ok: false,
    path: filePath,
    expectedCase,
    suggestion,
    reason: `${isComponent ? 'component' : 'service/hook'} file should be ${expectedCase}`,
  };
}

export type IdentifierKind = 'function' | 'variable' | 'constant' | 'component' | 'type';

export interface IdentifierCheck {
  ok: boolean;
  name: string;
  kind: IdentifierKind;
  expectedCase: NameCase;
  suggestion: string | null;
}

const KIND_CASE: Record<IdentifierKind, NameCase> = {
  function: 'camelCase',
  variable: 'camelCase',
  constant: 'SCREAMING_SNAKE',
  component: 'PascalCase',
  type: 'PascalCase',
};

/** Check an identifier against the convention for its kind. */
export function checkIdentifier(name: string, kind: IdentifierKind): IdentifierCheck {
  const expectedCase = KIND_CASE[kind];
  const current = detectCase(name);
  const ok = current === expectedCase;
  return { ok, name, kind, expectedCase, suggestion: ok ? null : toCase(name, expectedCase) };
}

export type ImportGroup = 'builtin' | 'external' | 'internal' | 'relative';

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dns', 'events', 'fs', 'http', 'http2',
  'https', 'net', 'os', 'path', 'process', 'querystring', 'readline', 'stream', 'string_decoder',
  'tls', 'tty', 'url', 'util', 'v8', 'vm', 'zlib',
]);

/** Classify an import source path into its ordering group. */
export function classifyImport(source: string): ImportGroup {
  if (source.startsWith('node:')) return 'builtin';
  const bare = source.split('/')[0];
  if (NODE_BUILTINS.has(bare)) return 'builtin';
  if (source.startsWith('.')) return 'relative';
  if (source.startsWith('@/') || source.startsWith('src/') || source.startsWith('~/')) return 'internal';
  return 'external';
}

const GROUP_ORDER: ImportGroup[] = ['builtin', 'external', 'internal', 'relative'];

/**
 * Reorder import statements: built-ins → external → internal → relative, alphabetised by source
 * within each group, with a blank line between groups. Lines that aren't parseable imports are
 * preserved at the top in their original order.
 */
export function orderImports(importLines: string[]): string[] {
  const buckets: Record<ImportGroup, Array<{ source: string; line: string }>> = {
    builtin: [], external: [], internal: [], relative: [],
  };
  const passthrough: string[] = [];
  const srcRe = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/;
  for (const line of importLines) {
    const m = line.match(srcRe);
    const source = m ? (m[1] || m[2] || m[3]) : null;
    if (!source) { passthrough.push(line); continue; }
    buckets[classifyImport(source)].push({ source, line: line.trim() });
  }
  const out: string[] = [...passthrough];
  let first = passthrough.length === 0;
  for (const g of GROUP_ORDER) {
    if (buckets[g].length === 0) continue;
    if (!first) out.push('');
    first = false;
    buckets[g].sort((a, b) => a.source.localeCompare(b.source));
    for (const e of buckets[g]) out.push(e.line);
  }
  return out;
}

export interface ConventionReport {
  files: FileNameCheck[];
  identifiers: IdentifierCheck[];
  importOrder: { changed: boolean; ordered: string[] } | null;
  violationCount: number;
}

export interface ConventionInput {
  files?: string[];
  identifiers?: Array<{ name: string; kind: IdentifierKind }>;
  imports?: string[];
}

/** Run all convention checks over a batch of files / identifiers / import lines. Pure. */
export function analyzeConventions(input: ConventionInput): ConventionReport {
  const files = (input.files || []).map(checkFileName);
  const identifiers = (input.identifiers || []).map((i) => checkIdentifier(i.name, i.kind));
  let importOrder: ConventionReport['importOrder'] = null;
  if (input.imports && input.imports.length > 0) {
    const ordered = orderImports(input.imports);
    const changed = JSON.stringify(ordered.filter((l) => l !== '')) !== JSON.stringify(input.imports.map((l) => l.trim()).filter((l) => l !== ''));
    importOrder = { changed, ordered };
  }
  const violationCount = files.filter((f) => !f.ok).length
    + identifiers.filter((i) => !i.ok).length
    + (importOrder?.changed ? 1 : 0);
  return { files, identifiers, importOrder, violationCount };
}
