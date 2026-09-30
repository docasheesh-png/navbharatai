// P-CGE.1 — True AST-based partial patching.
//
// Every generation/edit path could only do FULL-FILE rewrites — there was no way to replace a single
// function/class/component by name without regenerating (and risking clobbering) the whole file. This
// replaces exactly one top-level symbol's node, leaving all surrounding code byte-for-byte intact.
//
// Dependency-free: uses the `typescript` compiler API that is ALREADY a project dependency (used by
// tsc) — NOT ts-morph (a heavy extra dep, against the dependency-free policy). Pure → unit-tested.

import * as ts from 'typescript';

export interface PatchResult {
  ok: boolean;
  content?: string;
  error?: string;
}

/** Does this top-level statement declare a symbol called `name`? */
function declares(node: ts.Node, name: string): boolean {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name
  ) {
    return node.name.text === name;
  }
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name);
  }
  return false;
}

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('patch.tsx', String(source ?? ''), ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TSX);
}

/** List the top-level symbol names a file declares (functions, classes, consts, types, enums). Pure. */
export function listSymbols(source: string): string[] {
  const sf = parse(source);
  const out: string[] = [];
  for (const stmt of sf.statements) {
    if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) &&
      stmt.name
    ) {
      out.push(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) out.push(d.name.text);
    }
  }
  return out;
}

/**
 * Replace exactly the top-level symbol `symbolName` with `newCode`, leaving everything else in the
 * file untouched. Returns the new file content, or an honest error if the symbol isn't a top-level
 * declaration. The replacement spans the declaration itself (leading comments above it are preserved).
 * Pure; never throws.
 */
export function replaceSymbol(source: string, symbolName: string, newCode: string): PatchResult {
  const src = String(source ?? '');
  const name = String(symbolName ?? '').trim();
  const code = String(newCode ?? '');
  if (!name) return { ok: false, error: 'replaceSymbol: a symbol name is required.' };
  if (!code.trim()) return { ok: false, error: 'replaceSymbol: newCode is empty.' };
  let sf: ts.SourceFile;
  try {
    sf = parse(src);
  } catch {
    return { ok: false, error: 'replaceSymbol: could not parse the source file.' };
  }
  let target: ts.Statement | undefined;
  for (const stmt of sf.statements) {
    if (declares(stmt, name)) {
      target = stmt;
      break;
    }
  }
  if (!target) {
    const available = listSymbols(src);
    return {
      ok: false,
      error: `replaceSymbol: top-level symbol "${name}" not found.${available.length ? ` Available: ${available.slice(0, 30).join(', ')}.` : ''}`,
    };
  }
  const start = target.getStart(sf); // excludes leading trivia/comments — they stay put
  const end = target.getEnd();
  const content = src.slice(0, start) + code.trim() + src.slice(end);
  const clash = clashesIn(content);
  if (clash) {
    return {
      ok: false,
      error: `replaceSymbol: the new code for "${name}" would leave ${clash} in the file. Pass ONLY the declaration of `
        + `"${name}" (no import lines, no other declarations, no second default export) — or use write_file to replace the whole file.`,
    };
  }
  return { ok: true, content };
}

/**
 * 🔴 A WHOLE FILE PASSED AS ONE SYMBOL (autopsy a9f8d186, 2026-09-30). The builder called replace_symbol on
 * `AIOverview` with the ENTIRE new file — imports, the component and `export default` — and the tool
 * dropped all of it into the component's slot. The file came back with every import twice and two default
 * exports, and the builder spent a turn noticing "the file got duplicated content" and rewriting it.
 * The edit is refused when the result would declare a top-level name or an import binding twice, or carry
 * two default exports — the three shapes that duplication produces. Pure.
 */
function clashesIn(content: string): string | null {
  let sf: ts.SourceFile;
  try { sf = parse(content); } catch { return null; }
  const seen = new Set<string>();
  let defaults = 0;
  for (const stmt of sf.statements) {
    const names: string[] = [];
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      const c = stmt.importClause;
      if (c.name) names.push(c.name.text);
      const b = c.namedBindings;
      if (b && ts.isNamespaceImport(b)) names.push(b.name.text);
      if (b && ts.isNamedImports(b)) for (const e of b.elements) names.push(e.name.text);
    } else if (
      // An overload signature (a function with no body) legitimately repeats its name.
      ((ts.isFunctionDeclaration(stmt) && stmt.body) || ts.isClassDeclaration(stmt)) && stmt.name
    ) {
      names.push(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
    }
    const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) ?? [] : [];
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) defaults++;
    else if (mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) defaults++;
    for (const n of names) {
      if (seen.has(n)) return `"${n}" declared twice`;
      seen.add(n);
    }
  }
  return defaults > 1 ? 'two default exports' : null;
}
