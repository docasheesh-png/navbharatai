// AgentV3 — path-miss recovery, PURE.
//
// A real build report (SaaS admin dashboard, 2026-08-01) showed the builder burn 12 `read_file` turns
// on "does not exist": it created components under `src/components/ui/X.tsx` (the shadcn convention) but
// then read/imported them from `src/components/X.tsx`. The bare "does not exist" gave the model nothing to
// correct with, so it guessed the same wrong root again and again.
//
// The class fix is not a hardcoded `ui/` special-case — it is: when a path misses, look up the real file
// by BASENAME across everything the workspace already knows about, and hand the agent the actual path(s).
// So ANY path drift (ui/, a case difference, a .ts↔.tsx mixup, a missing folder segment) self-corrects on
// the first miss instead of looping. This module is pure + fully unit-testable; the dispatcher just wires it.

/** Strip directories → the filename. */
function basename(p: string): string {
  return p.split('/').pop() ?? p;
}
/** Filename without its final extension (Button.tsx → Button; index.d.ts → index.d). */
function stem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Given a missing path and every path the workspace knows about, return the most likely REAL locations,
 * best match first, de-duplicated and capped. Matching is by filename:
 *   1. exact basename, case-sensitive   (src/a/Button.tsx  ~  src/b/Button.tsx)   — strongest
 *   2. exact basename, case-insensitive (Button.tsx        ~  button.tsx)
 *   3. same stem, any extension, case-insensitive (Button.tsx ~ button.ts / button.jsx)
 * A candidate equal to the missing path itself is never suggested. Empty `known` → [].
 */
export function suggestPathsByBasename(missing: string, known: string[], limit = 4): string[] {
  const missBase = basename(missing.trim());
  if (!missBase) return [];
  const missBaseLower = missBase.toLowerCase();
  const missStemLower = stem(missBase).toLowerCase();

  const exact: string[] = [];
  const ci: string[] = [];
  const stemMatch: string[] = [];

  for (const k of known) {
    if (k === missing) continue;
    const kBase = basename(k);
    if (kBase === missBase) exact.push(k);
    else if (kBase.toLowerCase() === missBaseLower) ci.push(k);
    else if (stem(kBase).toLowerCase() === missStemLower && missStemLower.length > 0) stemMatch.push(k);
  }

  const ordered: string[] = [];
  for (const bucket of [exact, ci, stemMatch]) {
    for (const p of bucket) if (!ordered.includes(p)) ordered.push(p);
  }
  return ordered.slice(0, limit);
}

/**
 * Build the honest, actionable tail appended to a "file does not exist" error. Returns '' when there is
 * no plausible match (so the caller adds nothing misleading). Never invents a path — only surfaces paths
 * that genuinely exist in `known`.
 */
export function pathMissHint(missing: string, known: string[]): string {
  const hits = suggestPathsByBasename(missing, known);
  if (hits.length === 0) return '';
  if (hits.length === 1) {
    return ` A file with that name exists at \`${hits[0]}\` — did you mean that path? (Check for a missing/extra folder segment such as \`ui/\`, a case difference, or a .ts vs .tsx mismatch.)`;
  }
  return ` Files with that name exist at: ${hits.map((h) => `\`${h}\``).join(', ')} — use the correct full path (watch for a missing/extra folder segment, a case difference, or a .ts vs .tsx mismatch).`;
}
