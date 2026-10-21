// AgentV3 — deterministic CSS-Module stub generator.
//
// WHY (Kanban build autopsy 2026-07-13): the single biggest struggle in the report was 12+ `*.module.css`
// files that components imported but were never written. The missing-files gate handed ALL of them to an
// LLM repair pass, which ran out of steps (the step-limit-80 exhaustion) — so the app shipped broken (an
// unresolved CSS-module import fails the build for the WHOLE app). But a CSS-module stub is 100%
// DETERMINISTIC: importing files expose static class reads (`styles.foo`, `styles['bar']`),
// so we can write a valid stylesheet with exactly those classes WITHOUT an LLM call. That unblocks the
// build (the import resolves; the default CSS-module compiler preserves the class hooks) and — crucially
// — frees the bounded repair budget for the genuinely-hard missing files (barrels/components the LLM must
// actually author). An unstyled-but-rendering app beats a crashed one (the one absolute rule), and the
// stub is honestly marked as auto-generated so styling stays the user's/LLM's to fill in.
//
// PURE + deterministic + never throws. Only creates a file that is imported-but-absent, never overwrites.

import * as ts from 'typescript';
import { EXPORT_CODE_FILE } from './exportCapabilities';

export interface CssModuleStub {
  /** Project path of the stylesheet to create (e.g. 'src/components/ui/Select.module.css'). */
  path: string;
  /** The generated stylesheet content. */
  content: string;
  /** The class names extracted from the importing file(s), for honest diagnostics. */
  classes: string[];
}

const CLASS_NAME_RE = /^[A-Za-z_][\w-]*$/;

/** Parse syntax only, without a Program, type checker, filesystem or package resolution. */
function parseSource(content: string, path = 'source.tsx'): ts.SourceFile | null {
  if (typeof content !== 'string') return null;
  try {
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, false, /x$/i.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if ((source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) return null;
    return source;
  } catch { return null; }
}

/** Direct identifier reads only. This deliberately does not infer lexical aliases or dynamic keys. */
function classesByBinding(source: ts.SourceFile): Map<string, Set<string>> {
  const bindings = new Map<string, Set<string>>();
  const pending: ts.Node[] = [source];
  while (pending.length) {
    const node = pending.pop()!;
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression)) {
      const name = ts.isPropertyAccessExpression(node) ? node.name.text
        : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
      if (name && CLASS_NAME_RE.test(name)) {
        const binding = node.expression.text;
        const classes = bindings.get(binding) ?? new Set<string>();
        classes.add(name);
        bindings.set(binding, classes);
      }
    }
    ts.forEachChild(node, child => { pending.push(child); });
  }
  return bindings;
}

/** Normalize a/b/../c → a/c (no filesystem). */
function normalizeRelPath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
}

/** Resolve a relative CSS import from an importer file to a project path. Returns null for non-relative. */
function resolveCssTarget(importer: string, spec: string): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null; // only relative CSS-module imports
  const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
  return normalizeRelPath(`${dir}/${spec}`);
}

/**
 * Extract the class names a file references off a CSS-module binding: `binding.foo`, `binding['bar']`,
 * `binding["baz"]`. Returns a stable, de-duplicated, sorted list. A valid CSS identifier only.
 */
export function extractCssModuleClasses(content: string, binding: string): string[] {
  const source = parseSource(content);
  return source ? [...(classesByBinding(source).get(binding) ?? [])].sort() : [];
}

/** Render a valid CSS-module stylesheet from the referenced class names. */
function renderCssModule(path: string, classes: string[]): string {
  const header = `/* Auto-generated so the build compiles — '${path}'.\n` +
    `   These class hooks were derived from the component's usage; add real styles as needed. */\n`;
  if (classes.length === 0) return `${header}\n/* (no class references were found in the importing file) */\n`;
  // Empty hooks intentionally add no styling. Compiler export behavior is documented in
  // docs/MISSING_MODULE_REPAIR_SAFETY.md; Lightning CSS may discard empty rules and their exports.
  return `${header}\n${classes.map((c) => `.${c} {\n}`).join('\n\n')}\n`;
}

/**
 * For every `*.module.css` that is IMPORTED by a source file but does NOT exist in the file set, generate a
 * deterministic stub stylesheet containing the static classes across all importing files. Pure; never throws.
 */
export function generateMissingCssModules(files: Record<string, string>, existingPaths: readonly string[] = []): CssModuleStub[] {
  if (!files || typeof files !== 'object') return [];
  // Presence metadata protects unread scaffold files without pretending their source is empty.
  const existing = new Set([...Object.keys(files), ...existingPaths]);
  const targets = new Map<string, Set<string>>();
  for (const [path, content] of Object.entries(files)) {
    if (!EXPORT_CODE_FILE.test(path) || typeof content !== 'string') continue;
    const source = parseSource(content, path);
    if (!source) continue; // Invalid syntax is not evidence for a repair.
    const bindings = classesByBinding(source);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      if (!clause?.name || clause.isTypeOnly || !statement.moduleSpecifier.text.endsWith('.module.css')) continue;
      const target = resolveCssTarget(path, statement.moduleSpecifier.text);
      if (!target || existing.has(target)) continue;
      const classes = targets.get(target) ?? new Set<string>();
      for (const name of bindings.get(clause.name.text) ?? []) classes.add(name);
      targets.set(target, classes);
    }
  }
  // Render only after every consumer has contributed, including multiple aliases in the same file.
  return [...targets].map(([path, names]) => {
    const classes = [...names].sort();
    return { path, content: renderCssModule(path, classes), classes };
  });
}
