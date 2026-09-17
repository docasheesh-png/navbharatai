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
 *
 * 🔴 SEVEN SUCH GUARDS BROKE ON CORRECT CODE IN ONE DAY (2026-09-17), which is why two more helpers
 * live here now. The window problem above is only half of the class; the other half is subtler and
 * strictly worse:
 *
 *   • A FIXED WINDOW cries wolf — the guard fails while the invariant holds. Noisy, but visible.
 *   • A MISSING ANCHOR goes SILENT — `src.indexOf(needle)` returns `-1`, the slice that follows is
 *     junk (`slice(0, -1)` is the whole file; `slice(-301, 299)` is empty), and the assertion then
 *     passes for reasons unrelated to the claim. THREE guards written in one file that day passed with
 *     the code REVERTED. A guard that cannot fail is not a guard, and unlike the noisy kind it never
 *     tells you.
 *
 * `anchorOf` makes the second kind impossible to write, and `codeOnly` removes the hand-rolled
 * comment stripper that six separate test files grew that day.
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

/**
 * The index of `needle`, or a FAILURE — never `-1`.
 *
 * 🔴 THE CLASS THIS REMOVES (three guards in one file, 2026-09-17). Every one of them was shaped
 * `const at = src.indexOf(x); const window = src.slice(at - 300, at + 300);` and every one passed with
 * the code reverted, because `at` was `-1` and the slice was junk. A `not.toMatch(...)` on an empty
 * slice is the emptiest guard there is, and `slice(0, -1)` is very nearly the whole file — so the
 * assertion answers a question nobody asked.
 *
 * Throwing is the point: a missing anchor means the test's own assumption about the code has stopped
 * holding, which is a real failure and not a case to slice around. The message names the needle, so
 * the fix is obvious from the output alone.
 *
 * ⚠️ USE THIS INSTEAD OF `indexOf` WHENEVER THE RESULT IS USED TO SLICE. `enclosingBlock`,
 * `braceBlock` and `sectionUntil` already return `''` for an absent marker, which an assertion
 * catches; a bare `indexOf` is the one shape that fails open.
 */
export function anchorOf(src: string, needle: string): number {
  const at = String(src ?? '').indexOf(needle);
  if (at < 0) {
    throw new Error(
      `sourceSlice.anchorOf: ${JSON.stringify(needle)} is not in this source. `
      + 'The code this guard was written against has changed — re-anchor the test rather than widening it.',
    );
  }
  return at;
}

/**
 * The source with COMMENTS REMOVED, so prose can neither satisfy nor defeat an assertion about code.
 *
 * 🔴 WHY IT IS SHARED (six files hand-rolled this on 2026-09-17, and one of them got it wrong). This
 * repo's comments quote the very strings their guards forbid — a fix's comment legitimately says *"the
 * old wording was `with NOTHING recorded`"* while the guard asserts that wording is gone. One draft
 * flagged its own explanation as the bug; another passed only because the phrase it looked for
 * happened to sit in a comment.
 *
 * ⚠️ DELIBERATELY CONSERVATIVE, and the restraint is the correctness. Only `/* … *\/` blocks and
 * WHOLE-LINE `//` comments are removed. A trailing `//` is left alone on purpose: stripping from any
 * `//` would eat the tail of every line containing a URL (`https://…`), which this codebase is full
 * of, and silently shorten the very text being asserted on. Under-stripping leaves a guard slightly
 * noisy; over-stripping makes it quietly wrong.
 */
export function codeOnly(src: string): string {
  return String(src ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
