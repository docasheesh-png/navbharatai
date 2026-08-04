// AgentV3 — codemod truncation math (T3.9 follow-up).
//
// The repo-wide codemods (codemod_rename / codemod_add_prop) are relevance-scoped and process up to a
// per-pass safety cap of files that actually contain the target symbol (ts-morph parses each in memory,
// so the cap bounds AST cost). When MORE than the cap match, the extra files are HONESTLY reported and
// skipped — never silently dropped. This tiny pure module upgrades that honest message from a vague
// "re-run to finish" to a concrete "re-run ~N more time(s)", so a very large refactor has a clear,
// bounded path to completion.
//
// Why re-running converges: each pass renames the next `cap` matching files; once renamed they no longer
// contain the OLD symbol, so they drop out of the match set on the next scan. So the remaining count
// strictly shrinks by (up to) `cap` per pass → ceil(skipped / cap) more passes finish the job.

/** Per-pass file cap the codemod handlers enforce (mirrors ToolDispatcher's 2000 in-memory AST bound). */
export const CODEMOD_CAP_PER_PASS = 2000;

/** How many more passes are needed to finish `skipped` still-matching files, `cap` per pass. Pure. */
export function codemodPassesRemaining(skipped: number, cap: number = CODEMOD_CAP_PER_PASS): number {
  if (!(skipped > 0) || !(cap > 0)) return 0;
  return Math.ceil(skipped / cap);
}

/**
 * The honest truncation note appended to a codemod result when `skipped > 0`. Returns '' when nothing was
 * skipped (the caller then shows only the base summary). `tool` is the tool name to re-run
 * (e.g. 'codemod_rename'). Pure + deterministic.
 */
export function codemodTruncationNote(tool: string, skipped: number, cap: number = CODEMOD_CAP_PER_PASS): string {
  const passes = codemodPassesRemaining(skipped, cap);
  if (passes <= 0) return '';
  return `⚠️ ${skipped} more matching file(s) exceeded the per-pass safety cap of ${cap}. Re-run ${tool} ~${passes} more time(s) to finish — each pass transforms the next ${cap} and the done files drop out of the match set, so it converges.`;
}
