// C7 (roadmap Tier 2A) — surgical multi-file edit: move/rename a file and rewrite EVERY import that
// points to it, instead of hand-editing each importer (error-prone, the "whole-file rewrite" trap).
//
// This is the canonical "change one thing + fix all its call sites" codemod. It is PURE and fully
// testable: given the file set + a from→to path, it computes the new content for the moved file and
// for every file that imports it. The ToolDispatcher `codemod_move_file` tool applies the result and
// removes the old path. Reuses the same local-import resolution as the A1 code graph (no drift).

import path from 'path';
import { resolveLocalImport } from './ArchitectureAnalysis';

export interface MoveFile {
  path: string;
  content: string;
}

export interface MoveChange {
  path: string;
  before: string;
  after: string;
}

export interface MoveResult {
  ok: boolean;
  /** The moved file (now at the new path) + every importer whose specifier changed. */
  changes: MoveChange[];
  /** Files that import the moved file but use a specifier we won't rewrite (odd/computed) — honest. */
  unresolved: string[];
  summary: string;
  error?: string;
}

// Matches the string specifier of `import ... from 'x'`, `import 'x'`, `export ... from 'x'`,
// `require('x')`, and dynamic `import('x')`. Group 1 = lead, 2 = quote, 3 = specifier text.
const SPEC_RE = /(\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])([^'"]+)\2/g;

const CODE_EXT_RE = /\.(t|j)sx?$/;
const dropExt = (p: string): string => p.replace(CODE_EXT_RE, '');

/** Relative specifier (no extension, leading "./") from an importer file to a target file. */
export function relativeSpecifier(fromFile: string, targetFile: string): string {
  let rel = path.posix.relative(path.posix.dirname(fromFile), dropExt(targetFile));
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

/** Alias specifier ("@/..." or "~/...") for a target file, mirroring the alias char the code uses. */
export function aliasSpecifier(prefixChar: string, targetFile: string): string {
  return `${prefixChar}/` + dropExt(targetFile).replace(/^src\//, '');
}

const norm = (p: string): string => p.trim().replace(/^\.?\//, '');

/**
 * Compute the full change set for moving `fromPath` → `toPath`. Pure.
 * - Every OTHER file that imports fromPath has its specifier rewritten to point at toPath, preserving
 *   the style it used (relative, or "@/"/"~/" alias).
 * - The MOVED file's OWN relative imports are recomputed from its new location (alias imports are
 *   location-independent, so they're left as-is).
 */
export function computeMove(files: MoveFile[], fromPath: string, toPath: string): MoveResult {
  const from = norm(fromPath);
  const to = norm(toPath);
  if (!from || !to) return { ok: false, changes: [], unresolved: [], summary: '', error: 'from and to are required.' };
  if (from === to) return { ok: false, changes: [], unresolved: [], summary: '', error: 'from and to are identical.' };
  const moved = files.find(f => f.path === from);
  if (!moved) return { ok: false, changes: [], unresolved: [], summary: '', error: `Source file "${from}" not found.` };
  if (files.some(f => f.path === to)) return { ok: false, changes: [], unresolved: [], summary: '', error: `Target "${to}" already exists.` };

  // Resolution set reflects the state BEFORE the move (importers still reference `from`).
  const fileSet = new Set(files.map(f => f.path));
  const changes: MoveChange[] = [];
  const unresolved: string[] = [];

  // 1. Importers: rewrite every specifier that resolves to `from`, preserving its style.
  for (const f of files) {
    if (f.path === from) continue;
    let touched = false;
    const after = f.content.replace(SPEC_RE, (whole, lead: string, quote: string, spec: string) => {
      if (resolveLocalImport(f.path, spec, fileSet) !== from) return whole;
      let next: string | null = null;
      if (spec.startsWith('.')) next = relativeSpecifier(f.path, to);
      else if (/^[@~]\//.test(spec)) next = aliasSpecifier(spec[0], to);
      if (!next) { if (!unresolved.includes(f.path)) unresolved.push(f.path); return whole; }
      touched = true;
      return `${lead}${quote}${next}${quote}`;
    });
    if (touched && after !== f.content) changes.push({ path: f.path, before: f.content, after });
  }

  // 2. The moved file's OWN relative imports, recomputed from the new location (alias untouched).
  let movedTouched = false;
  const movedContent = moved.content.replace(SPEC_RE, (whole, lead: string, quote: string, spec: string) => {
    if (!spec.startsWith('.')) return whole;
    const resolved = resolveLocalImport(from, spec, fileSet);
    if (!resolved) return whole;
    const next = relativeSpecifier(to, resolved);
    if (next === spec) return whole;
    movedTouched = true;
    return `${lead}${quote}${next}${quote}`;
  });
  changes.push({ path: to, before: moved.content, after: movedTouched ? movedContent : moved.content });

  const importerCount = changes.length - 1;
  const summary =
    `Moved ${from} → ${to} and rewrote ${importerCount} importer(s)` +
    (unresolved.length
      ? `; ${unresolved.length} file(s) import it with a specifier that could not be rewritten (${unresolved.join(', ')}) — fix those manually.`
      : '.');
  return { ok: true, changes, unresolved, summary };
}
