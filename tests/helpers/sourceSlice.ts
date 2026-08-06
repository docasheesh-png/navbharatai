/**
 * Slice a source file by STRUCTURE, not by a magic character count.
 *
 * WHY THIS EXISTS. Source-level tests here routinely do `src.slice(at, at + 600)` and then assert on
 * the window. That window is a guess about how long the code happens to be, so it is not testing the
 * invariant it claims to — it is testing that nobody made the code longer. Two such tests broke in a
 * single change (2026-08-06) purely because a message string grew: the field they assert on was pushed
 * past the window and the test reported the invariant as VIOLATED when it was intact. A test that cries
 * wolf teaches you to widen the number and move on, which is how a real regression eventually slips
 * through one of them.
 *
 * These read the actual block boundaries, so they keep asserting the same thing however the code grows.
 */

/** Find the balanced `{ … }` block that starts at or after `marker`. Returns '' when absent. */
export function braceBlock(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  return src.slice(at); // unbalanced — hand back the rest rather than a misleading empty string
}

/**
 * The whole object literal / call that CONTAINS `marker` — e.g. the `diag.record({ … })` a
 * `code: 'X'` line sits inside. Walks backwards to the opening brace, then forwards to its match, so
 * fields BEFORE the marker (severity, phase) are included as well as those after it.
 */
export function enclosingBlock(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) return '';
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i--) {
    const c = src[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start < 0) return '';
  return braceBlock(src.slice(start), '{');
}

/**
 * Everything between `marker` and the next `stop`, or to the end when `stop` is absent.
 *
 * `braceBlock` matches the FIRST `{` after its marker, which for a function whose return type is an
 * object literal — `async function f(): Promise<{ ok: true } | { ok: false }> { … }` — is the return
 * TYPE, not the body. Rather than teach brace matching to parse TypeScript signatures, name the next
 * thing in the file: it reads better in the test and it fails loudly if that thing is renamed, which is
 * exactly when the test's assumption stopped holding.
 */
export function sectionUntil(src: string, marker: string, stop?: string): string {
  const at = src.indexOf(marker);
  if (at < 0) return '';
  if (!stop) return src.slice(at);
  const end = src.indexOf(stop, at + marker.length);
  return end < 0 ? src.slice(at) : src.slice(at, end);
}
