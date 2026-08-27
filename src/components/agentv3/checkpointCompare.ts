// Checkpoint COMPARE — the pure selection rules behind History's "Compare two versions" (ROADMAP B6).
//
// Extracted from the panel for the same reason every pure helper beside it is: the selection rules
// (max two, toggle off, which of the two is "older") are exactly the kind of logic that silently
// inverts during a refactor — and an inverted diff shows every change backwards, additions as
// deletions, which is worse than no diff because it reads as "the restore will delete my work".

export interface DiffFileRow {
  path: string;
  added: number | null;
  removed: number | null;
  renamedFrom?: string;
}

export interface CheckpointDiffResponse {
  ok: boolean;
  reason: string;
  files: DiffFileRow[];
  added: number;
  removed: number;
  message: string;
  truncated: boolean;
}

/** Toggle a sha in the selection. Never more than two; picking a third replaces the OLDEST pick. */
export function toggleCompareSelection(sel: readonly string[], sha: string): string[] {
  if (sel.includes(sha)) return sel.filter((s) => s !== sha);
  if (sel.length >= 2) return [sel[1], sha];
  return [...sel, sha];
}

/**
 * Decide which selected sha is `from` (older) and which is `to` (newer), from the checkpoint list's
 * own order — NEWEST FIRST, which is how the History tab renders (`allCheckpoints`). The one that
 * appears LATER in that list is older, so it is the diff's base. Getting this backwards shows the
 * user their own additions as deletions.
 */
export function compareOrder(allShasNewestFirst: readonly string[], sel: readonly string[]): { from: string; to: string } | null {
  if (sel.length !== 2) return null;
  const ia = allShasNewestFirst.indexOf(sel[0]);
  const ib = allShasNewestFirst.indexOf(sel[1]);
  if (ia < 0 || ib < 0) return null;
  // Larger index = further down the newest-first list = older = the base.
  return ia > ib ? { from: sel[0], to: sel[1] } : { from: sel[1], to: sel[0] };
}
