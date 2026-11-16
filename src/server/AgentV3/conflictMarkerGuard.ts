// AgentV3 — refuse (or, for a tsconfig, salvage) leftover apply-patch / merge-conflict markup
// that a model sometimes writes as file content.
//
// WHY (BR1982). A generated TypeScript file that began a SEARCH/REPLACE block was correctly
// refused by the write-time syntax gate ("Unexpected <<"). The same build's tsconfig.json was
// not: tsconfig is treated as JSONC, so the syntax gate skips it, and the file landed with a
// valid JSON object followed by leftover SEARCH / REPLACE marker lines. tsc then could not
// use that file cleanly, and the dangling-reference sanitizer could not parse it either.
//
// Markers are detected only at the start of a line (the same rule as tests/noConflictMarkers.test.ts).
// `=======` is deliberately not a signal: it is a common Markdown underline and comment banner.
// Built by concatenation so this file cannot match that repository-wide line-start guard.

/** Opening marker (seven less-than signs). */
const OPEN = '<'.repeat(7);
/** Closing marker (seven greater-than signs). */
const CLOSE = '>'.repeat(7);

export function writeConflictGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_WRITE_CONFLICT_GUARD !== 'off';
}

/**
 * 1-based line number of the first line that starts with an opening or closing conflict /
 * apply-patch marker, or null when none are present. Pure.
 */
export function firstConflictMarkerLine(content: string): number | null {
  if (typeof content !== 'string' || content.length === 0) return null;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(OPEN) || line.startsWith(CLOSE)) return i + 1;
  }
  return null;
}

/**
 * If a conflict / apply-patch marker starts a line after some earlier content, return the
 * prefix before that line (trimmed of trailing whitespace, with a trailing newline).
 * Does not inspect whether the prefix is valid — callers that need a parseable tsconfig
 * must check that themselves. Pure. Never throws.
 */
export function stripTrailingConflictMarkup(content: string): { content: string; stripped: boolean } {
  if (typeof content !== 'string' || content.length === 0) return { content: content ?? '', stripped: false };
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((line) => line.startsWith(OPEN) || line.startsWith(CLOSE));
  if (idx <= 0) return { content, stripped: false };
  const prefix = lines.slice(0, idx).join(nl).replace(/[ \t]+$/g, '').replace(/(\r?\n)+$/g, '');
  if (!prefix) return { content, stripped: false };
  return { content: `${prefix}${nl}`, stripped: true };
}

/**
 * Model-facing refusal, or null to allow the write.
 *   • allow when the guard is off, or the new content has no line-start marker;
 *   • allow when the OLD content already had a marker — a repair-in-progress must not be trapped
 *     (same policy as the syntax parse guard);
 *   • otherwise refuse a clean/new file that would gain markers.
 * Pure.
 */
export function conflictMarkerRefusal(
  path: string,
  newContent: string,
  oldContent = '',
  enabled = true,
): string | null {
  if (!enabled) return null;
  const line = firstConflictMarkerLine(newContent);
  if (line == null) return null;
  if (firstConflictMarkerLine(oldContent) != null) return null;
  const name = path || 'the file';
  return (
    `WRITE REJECTED — ${name} contains leftover apply-patch / merge-conflict markers (line ${line}). ` +
    `It was NOT saved. Write the complete file without those marker lines ` +
    `(lines that start with seven '<' or seven '>' characters).`
  );
}
