// T3 Phase 1 (roadmap 2026-07-19) — symbol scoping for repo-wide codemods.
//
// The codemod tools (codemod_rename, codemod_add_prop) used to read a BLIND first-50 files
// (`.slice(0, 50)`), so on any real 200/1000/5000-file app the refactor was INCOMPLETE — some call
// sites changed, the rest kept the old name → a broken build, reported as a fake success.
//
// The right bound is not a count but RELEVANCE: a symbol can only appear in a file whose text contains
// that identifier as a whole token. This module is the cheap pre-filter — a pure, memory-light scan that
// reduces a huge repo to the handful of files that actually reference the symbol, which the precise AST
// codemod then processes. Strictly more correct than the old cap (which ran the AST on an arbitrary 50).
// Pure + unit-tested.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `symbol` appears in `content` as a WHOLE identifier token (not as a substring of a larger
 * identifier — renaming `User` must not be triggered by `UserProfile`). The AST pass still decides
 * precisely; this only widens/narrows which files are worth parsing. Pure. Never throws.
 */
export function containsSymbol(content: string, symbol: string): boolean {
  const s = String(symbol || '');
  if (!s || typeof content !== 'string') return false;
  try {
    return new RegExp(`(?<![\\w$])${escapeRegExp(s)}(?![\\w$])`).test(content);
  } catch {
    // A symbol that can't form a valid regex (shouldn't happen for identifiers) → fall back to a plain
    // substring check so we never wrongly EXCLUDE a file.
    return content.includes(s);
  }
}

/**
 * Filter a set of read files to those that reference `symbol` as a whole token. A superset gate: it only
 * ever excludes files that cannot reference the symbol directly, so it never drops a real usage the AST
 * would have changed. Pure. Never throws.
 */
export function scopeFilesForSymbol<T extends { content: string }>(files: T[], symbol: string): T[] {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => f && containsSymbol(f.content, symbol));
}
