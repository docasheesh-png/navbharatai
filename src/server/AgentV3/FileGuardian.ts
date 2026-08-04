// AgentV3 — File Guardian (R-guardian).
//
// Goal (admin ask): the files v5.0 created must STAY. If a file is lost — the ephemeral sandbox was
// recycled, or a file went missing — the next build/edit turn auto-recovers it from history (the
// durable WorkspaceFileStore) WITHOUT the user asking. No fake: it actually writes the files back.
//
// This module is the PURE decision: given the durably-saved project (history) and what is currently
// in the sandbox, decide WHICH files to restore and in what mode. The route does the real I/O.
//
// Safety: the guardian runs at the START of a turn, BEFORE the agent makes any new edits — so the
// sandbox should already reflect the last completed build. Any divergence is LOSS (recycle / a
// deletion), never legitimate newer work, which is why restoring the saved state here is safe.

export type GuardianMode = 'none' | 'missing' | 'full';

export interface GuardianPlan {
  /** path → content to write back into the sandbox (empty when nothing needs restoring). */
  restore: Record<string, string>;
  /** 'none' = nothing to do; 'missing' = re-add individually-missing files; 'full' = sandbox was
   *  lost/recycled, restore the whole project (overwriting any bare scaffold placeholders). */
  mode: GuardianMode;
  /** Count of files that will be written back (for honest user-facing messaging). */
  count: number;
}

/**
 * Fraction of the saved project that must be missing before we treat the sandbox as
 * lost/recycled (restore the WHOLE project) rather than a one-off deletion (restore just the gaps).
 * A warm sandbox is never missing half its files, so this reliably distinguishes the two cases.
 */
const RECYCLE_FRACTION = 0.5;

/**
 * Decide what the guardian should restore. `saved` is the durable history (path→content); `existing`
 * is what the sandbox scan READ (path→content); `skipped` is what that same scan SAW BUT DID NOT READ.
 * Returns the files to write back + the mode. Never throws.
 *
 * WHY `skipped` IS NOT OPTIONAL IN SPIRIT (mitrify autopsy 2026-08-04). `collectWorkspaceFiles`
 * returns `{ files, skipped }`, and the caller passed only `files`. But a path lands in `skipped`
 * precisely because the scan SAW it in the sandbox listing and then declined to read it — it was
 * excluded by pattern, too large, binary-looking, unreadable, or past a cap. The file is THERE. Judged
 * only against `files`, every such path looked MISSING, and the guardian:
 *   1. reported a data-loss event that never happened (the report claimed "9 file(s) missing from the
 *      sandbox" on a healthy workspace — 608 stored vs 599 read is exactly the scan's own skip gap), and
 *   2. OVERWROTE those files with the older durable snapshot. If one of them had newer content — say a
 *      file that grew past the read cap during the build — the loss-prevention system was itself the
 *      thing destroying work.
 * A file the scanner refused to read is not evidence of absence. Same discipline as `scanned:false`
 * in the UI scan and `captured` in the console-error reader: unknown is never reported as empty.
 */
export function planFileGuardian(
  saved: Record<string, string>,
  existing: Record<string, string>,
  skipped: readonly string[] = [],
): GuardianPlan {
  const savedPaths = Object.keys(saved ?? {});
  if (savedPaths.length === 0) return { restore: {}, mode: 'none', count: 0 };

  const have = existing ?? {};
  // Present = read OR seen-but-skipped. Both mean "the sandbox has this file".
  const seen = new Set<string>(Array.isArray(skipped) ? skipped.filter((p): p is string => typeof p === 'string') : []);
  const missing = savedPaths.filter((p) => !(p in have) && !seen.has(p));
  if (missing.length === 0) return { restore: {}, mode: 'none', count: 0 };

  // Most of the project is gone → the sandbox was recycled and any files present are just a bare
  // scaffold. Restore the WHOLE saved project so the user's real files (incl. scaffold-named ones
  // like src/App.tsx) come back, not the placeholder versions.
  if (missing.length >= Math.ceil(savedPaths.length * RECYCLE_FRACTION)) {
    return { restore: { ...saved }, mode: 'full', count: savedPaths.length };
  }

  // A few files went missing → re-add exactly those, never touching the files that are still present
  // (they may carry edits the durable snapshot predates).
  const restore: Record<string, string> = {};
  for (const p of missing) restore[p] = saved[p];
  return { restore, mode: 'missing', count: missing.length };
}
