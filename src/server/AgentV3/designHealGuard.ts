// A design repair may not leave the app worse than it found it.
//
// WHERE THIS SITS, AND WHY IT IS NOT verifyAfterFix. The two other post-build write passes — the
// runtime-error auto-fix and the feature-presence heal — run AFTER the app has been proven to render,
// so they can be wrapped in `verifyAfterFix`: snapshot the green app, apply, RE-RENDER, revert if it
// broke. The design heal runs much earlier, inside the post-answer integrity pass, before the preview
// has ever been browsed. There is no green snapshot to fall back to and no URL to re-render, so that
// net simply cannot be strung here.
//
// What IS available at that point is the file content itself. The most common way an LLM edit breaks an
// app is that it no longer parses, and parsing is free, deterministic and needs no sandbox. So the net
// here is narrower than verifyAfterFix and honest about it: a page the design heal rewrote into
// something that cannot parse is put back exactly as it was, and the rest of the heal stands.
//
// PARTIAL BY CONSTRUCTION — say so rather than imply more. A heal can still introduce a runtime or
// import break that parses perfectly, and this will not catch it. That case is caught later by the
// preview verification and reported honestly; it is simply not reverted. Claiming a complete net here
// would be the kind of half-true guarantee the honesty rules exist to prevent.
//
// Pure — no I/O, no parsing of its own. The caller supplies before, after, and the parse verdict.

export interface DesignHealDecision {
  /** Paths to restore to their pre-heal content, because the heal left them unparseable. */
  revert: string[];
  /** Paths whose rewrite parsed and may stand. */
  keep: string[];
}

/**
 * Which of the heal's rewrites may stand, and which must be put back.
 *
 * `brokenPaths` is the set the caller found unparseable AFTER the heal. A file that was ALREADY
 * unparseable before the heal is NOT reverted: restoring it would hand back an equally broken file and
 * throw away a repair that may well have improved it. Only a file the heal itself broke is undone —
 * "leave it no worse" is the promise, not "leave it perfect".
 */
export function designHealDecision(input: {
  before: Record<string, string>;
  after: Record<string, string>;
  brokenAfter: readonly string[];
  brokenBefore?: readonly string[];
}): DesignHealDecision {
  const before = input.before ?? {};
  const after = input.after ?? {};
  const brokenBefore = new Set((input.brokenBefore ?? []).map(String));
  const brokenAfter = new Set((input.brokenAfter ?? []).map(String));

  const revert: string[] = [];
  const keep: string[] = [];
  for (const path of Object.keys(after)) {
    const changed = before[path] !== undefined && before[path] !== after[path];
    if (!changed) continue;                       // untouched by the heal — not ours to judge
    if (brokenAfter.has(path) && !brokenBefore.has(path)) revert.push(path);
    else keep.push(path);
  }
  return { revert: revert.sort(), keep: keep.sort() };
}

/** The honest diagnostics line. '' when the heal broke nothing, which is the normal case. */
export function designHealGuardNote(decision: DesignHealDecision): string {
  if (!decision.revert.length) return '';
  return (
    `The design repair left ${decision.revert.length} file(s) unparseable and they were restored to their `
    + `pre-repair content (${decision.revert.slice(0, 5).join(', ')}${decision.revert.length > 5 ? ', …' : ''}). `
    + `${decision.keep.length} other repaired file(s) parsed and were kept. This guard catches a repair that `
    + 'stops the code parsing; a repair that parses but breaks the app at runtime is caught later by the '
    + 'preview check and reported, not reverted.'
  );
}
