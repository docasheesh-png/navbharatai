// AgentV3 — ContractMap (LENS C: deterministic cross-file drift backstop for the repair pass).
//
// LENS A (shared contract) + LENS B (dependency-ordered, real-source generation) prevent most cross-file
// contract drift at GENERATION time. This is the safety net for the residue: a PURE, deterministic check
// that scans the generated files and reports, in ONE compact line per mismatch, the two highest-signal
// drift classes the build report hit:
//   1. a named import that the target module does NOT actually export
//      (e.g. `import { extractVimeoEmbedUrl }` from a util that only exports `extractEmbedUrl`), and
//   2. an `Enum.Member` reference whose member the enum does NOT declare
//      (e.g. `MediaType.YouTube` when the enum is `{ YOUTUBE, VIMEO }`).
//
// tsc already FLAGS these, but its output is verbose and the repair prompt truncates errors to ~6k chars,
// so on a many-file build the real mismatches can get cut off. This report is COMPACT (one line each,
// naming exactly what IS available), so it is prepended to the repair input and survives the slice — the
// repair model sees the full, precise mismatch set and can reconcile it in one pass.
//
// Conservative by design (advisory only — tsc stays the hard gate): it resolves only in-app relative
// imports against the generated file set, skips modules that use `export *` (their export set is unknown),
// skips default imports and computed/namespace access, and returns null on no drift. A miss just degrades
// to today's behaviour; a false positive at worst wastes part of one repair pass. PURE + unit-testable.

import * as ts from 'typescript';

export interface ModuleContract {
  /** Named exports of the module (function/class/const/let/var/interface/type/enum names + export lists + 'default'). */
  exports: Set<string>;
  /** enum name -> its declared member identifiers. */
  enums: Map<string, Set<string>>;
  /** True when the module uses `export *` (so its export set is incomplete — skip import checks against it). */
  hasWildcard: boolean;
}

export type ContractMap = Map<string, ModuleContract>;

const SOURCE_EXT = ['.tsx', '.ts', '.jsx', '.js', '.mjs'];

/** A path's module key = path without a source extension (so importers' `./foo` lines up). */
function moduleKey(path: string): string {
  for (const e of SOURCE_EXT) if (path.endsWith(e)) return path.slice(0, -e.length);
  return path;
}

/** Extract a module's exported symbols + enum members from its source. PURE. */
export function extractModuleContract(content: string): ModuleContract {
  const exports = new Set<string>();
  const enums = new Map<string, Set<string>>();
  const src = content || '';

  const declRe = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (let m = declRe.exec(src); m; m = declRe.exec(src)) exports.add(m[1]);

  // DESTRUCTURED exports — `export const { a, b: c } = …` and `export const [ x ] = …`. The `declRe`
  // above requires an identifier after `const`, so it misses these entirely — and then a valid
  // consumer `import { a } from …` was reported as drift. This is a COMMON generated-React pattern
  // (Zustand `export const { useStore } = create(...)`, Context `export const { Provider, useX } =
  // createContext(...)`). Each bound local name is what consumers import.
  const destructRe = /export\s+(?:const|let|var)\s*(\{[^}]*\}|\[[^\]]*\])\s*=/g;
  for (let m = destructRe.exec(src); m; m = destructRe.exec(src)) {
    for (const raw of m[1].slice(1, -1).split(',')) {
      let seg = raw.trim();
      if (!seg) continue;
      seg = seg.replace(/=.*$/, '').trim();               // drop a default value
      const local = seg.includes(':') ? seg.slice(seg.indexOf(':') + 1) : seg; // `key: local` → local
      const id = local.replace(/^\.\.\./, '').trim();     // rest element `...rest`
      if (/^[A-Za-z_$][\w$]*$/.test(id)) exports.add(id);
    }
  }

  // `export { a, b as c }` — the OUTER name (after `as`) is what consumers import.
  const listRe = /export\s*\{([^}]*)\}/g;
  for (let m = listRe.exec(src); m; m = listRe.exec(src)) {
    for (const part of m[1].split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      const name = (seg.split(/\s+as\s+/).pop() || '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) exports.add(name);
    }
  }

  if (/export\s+default\b/.test(src)) exports.add('default');
  const hasWildcard = /export\s*\*/.test(src);

  // enums: capture name + member identifiers (first identifier of each comma-separated entry).
  const enumRe = /(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)\s*\{([^}]*)\}/g;
  for (let m = enumRe.exec(src); m; m = enumRe.exec(src)) {
    const members = new Set<string>();
    for (const part of m[2].split(',')) {
      const id = (part.trim().split('=')[0] || '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(id)) members.add(id);
    }
    if (members.size > 0) enums.set(m[1], members);
  }

  // …and the enum written as DATA — `export const X = { A: 'a', B: 'b' } as const` PLUS its value-union type
  // `export type X = (typeof X)[keyof typeof X]` — the form every shared contract enum takes since build
  // 9c612cdb (contractEnums.ts). Without this, normalising the contract's enums would silently retire the
  // `X.Membr` drift line for exactly the enums the contract shares.
  // ⚠️ A drift line is an ORDER to the repair model ("fix these exact mismatches"), so a member set that is
  // not complete invents a defect in correct code. Two gates keep it exact: the value-union type must be
  // there (without it this is any flat object — `styles`, `ROUTES` — and another file's LOCAL object of the
  // same name would be "checked" against it), and every key must be written out in the literal (a spread,
  // a shorthand or a computed key means the member set is not all here — `objectLiteralKeys` returns null).
  const valueUnions = new Set<string>();
  const unionRe = /type\s+([A-Za-z_$][\w$]*)\s*=\s*\(?\s*typeof\s+\1\s*\)?\s*\[\s*keyof\s+typeof\s+\1\s*\]/g;
  for (let m = unionRe.exec(src); m; m = unionRe.exec(src)) valueUnions.add(m[1]);
  const asConstRe = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*\{([^{}]*)\}\s*as\s+const\b/g;
  for (let m = asConstRe.exec(src); m; m = asConstRe.exec(src)) {
    if (enums.has(m[1]) || !valueUnions.has(m[1])) continue;
    const members = objectLiteralKeys(m[2]);
    if (members && members.size > 0) enums.set(m[1], members);
  }

  return { exports, enums, hasWildcard };
}

/**
 * Every key of the object literal `{ <body> }`, or null when the key set is not fully written out (a spread,
 * a shorthand property, a method, a computed key, or text that does not parse). Quoted keys count by their
 * text, so `{ 'Active': 'a' }` declares `Active`. PURE.
 */
function objectLiteralKeys(body: string): Set<string> | null {
  try {
    const sf = ts.createSourceFile('as-const.ts', `({${body}})`, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    if (((sf as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? []).length > 0) return null;
    const st = sf.statements.length === 1 ? sf.statements[0] : undefined;
    let e: ts.Expression | undefined = st && ts.isExpressionStatement(st) ? st.expression : undefined;
    while (e && ts.isParenthesizedExpression(e)) e = e.expression;
    if (!e || !ts.isObjectLiteralExpression(e)) return null;
    const keys = new Set<string>();
    for (const p of e.properties) {
      if (!ts.isPropertyAssignment(p)) return null;
      if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)) keys.add(p.name.text);
      else return null;
    }
    return keys;
  } catch {
    return null;
  }
}

/** Build the contract for every generated module. PURE. */
export function extractContract(files: Record<string, string>): ContractMap {
  const map: ContractMap = new Map();
  for (const [path, content] of Object.entries(files || {})) {
    if (!SOURCE_EXT.some((e) => path.endsWith(e))) continue; // only TS/JS modules carry exports
    map.set(moduleKey(path), extractModuleContract(content));
  }
  return map;
}

/** Resolve a relative specifier against the importer path to a module key, or null if not in-app/relative. */
function resolveRelative(fromPath: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;       // external (e.g. 'react') — not our concern
  if (/\.css$/.test(spec)) return null;          // stylesheet, no TS exports
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const parts = dir ? dir.split('/') : [];
  for (const seg of spec.replace(/\.[a-z0-9]+$/i, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** A module key matched against the contract, trying `key` then `key/index`. */
function lookup(map: ContractMap, key: string): ModuleContract | null {
  return map.get(key) ?? map.get(`${key}/index`) ?? null;
}

/**
 * Scan the generated files for the two high-signal drift classes and return a COMPACT one-line-per-mismatch
 * report (capped), or null when there is no detectable drift. PURE & deterministic — advisory input to repair.
 */
export function contractDriftReport(files: Record<string, string>): string | null {
  const map = extractContract(files);
  // Aggregate enums by name — but if the SAME name is declared in multiple files with DIFFERENT
  // members (generic names like Status/Type/Role/Size recur per-feature in larger apps), we cannot
  // tell by name alone which enum a given file's `Status.X` refers to. The old "first-wins" map
  // checked every file's reference against ONE arbitrary definition → a file with its OWN `Status`
  // enum got its valid members falsely reported as drift (and that false line was fed to the repair
  // model). Mark such names ambiguous and SKIP them rather than emit an untrustworthy drift line.
  const enumNames = new Map<string, Set<string>>();
  const ambiguousEnums = new Set<string>();
  const sameMembers = (a: Set<string>, b: Set<string>): boolean =>
    a.size === b.size && [...a].every((x) => b.has(x));
  for (const c of map.values()) for (const [n, mem] of c.enums) {
    const existing = enumNames.get(n);
    if (!existing) enumNames.set(n, mem);
    else if (!sameMembers(existing, mem)) ambiguousEnums.add(n);
  }

  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (line: string) => { if (!seen.has(line)) { seen.add(line); lines.push(line); } };

  for (const [path, content] of Object.entries(files || {})) {
    if (!SOURCE_EXT.some((e) => path.endsWith(e))) continue;
    const src = content || '';

    // (1) named imports that the resolved in-app target does NOT export.
    const impRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
    for (let m = impRe.exec(src); m; m = impRe.exec(src)) {
      const key = resolveRelative(path, m[2]);
      if (!key) continue;
      const target = lookup(map, key);
      if (!target || target.hasWildcard) continue;   // unknown/wildcard target → conservative skip
      for (const part of m[1].split(',')) {
        const seg = part.trim();
        if (!seg) continue;
        const name = (seg.split(/\s+as\s+/)[0] || '').trim(); // the name that must be EXPORTED by target
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
        if (!target.exports.has(name)) {
          const avail = [...target.exports].filter((e) => e !== 'default').slice(0, 12).join(', ') || '(none)';
          push(`${path}: imports { ${name} } from '${m[2]}' but it exports: ${avail}`);
        }
      }
    }

    // (2) Enum.Member references whose member the enum does not declare.
    for (const [enumName, members] of enumNames) {
      if (ambiguousEnums.has(enumName)) continue; // same name, conflicting members across files → can't resolve
      const refRe = new RegExp(`\\b${enumName}\\.([A-Za-z_$][\\w$]*)`, 'g');
      for (let m = refRe.exec(src); m; m = refRe.exec(src)) {
        const member = m[1];
        if (!members.has(member)) {
          push(`${path}: uses ${enumName}.${member} but ${enumName} members are: ${[...members].slice(0, 12).join(', ')}`);
        }
      }
    }
  }

  if (lines.length === 0) return null;
  const head = 'CONTRACT DRIFT (fix these exact mismatches — make the consumer match the producer, or vice-versa):';
  return [head, ...lines.slice(0, 30)].join('\n');
}
