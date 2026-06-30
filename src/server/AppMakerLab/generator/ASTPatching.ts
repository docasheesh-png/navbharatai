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
  return { ok: true, content };
}
