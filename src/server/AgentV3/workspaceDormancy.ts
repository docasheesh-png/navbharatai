// AgentV3 — what to tell a user about a workspace whose file count we could not take.
//
// ⚠️ THE BUG THIS EXISTS FOR (found 2026-08-24 while sweeping for one repeated pattern). Five call
// sites did the same thing:
//
//     const fileCount = await countWorkspaceFiles(workspaceId).catch(() => 0);
//     res.json({ reason: fileCount > 0 ? 'dormant' : 'not_started', savedFileCount: fileCount });
//
// A count that FAILED — a store hiccup, a timeout — became the number ZERO, and zero means
// `not_started`, and the client renders that as "Nothing has been built yet — build an app and its
// logs appear here." So a transient failure told a user their project does not exist, on a workspace
// they had built. That is the most alarming sentence this product can show, produced by an error
// nobody saw.
//
// It is the same substitution found five other times this month — an artifact standing in for the
// thing it was meant to prove — and here the artifact is a fallback value that is indistinguishable
// from a real measurement. `0` is a perfectly good count. That is exactly what makes it dangerous as a
// failure value.
//
// PURE. The I/O stays at the call site; only the decision lives here, so all five sites give one
// answer instead of five copies that can drift.

/** What we know about a dormant workspace's saved project. */
export type DormancyReason = 'dormant' | 'not_started' | 'unknown';

/**
 * Turn a file count into what we may honestly say — where `null` means the count could not be taken.
 *
 * The three answers are genuinely different facts and the user acts on them differently: `dormant`
 * says their work is safe and a message will wake it, `not_started` says there is nothing here yet,
 * and `unknown` says to try again. Collapsing the third into the second is what made a hiccup look
 * like data loss.
 */
export function dormancyReason(count: number | null | undefined): DormancyReason {
  if (count === null || count === undefined || !Number.isFinite(count)) return 'unknown';
  return count > 0 ? 'dormant' : 'not_started';
}

/**
 * The count to report alongside it — null rather than 0 when we do not know.
 *
 * Reporting `savedFileCount: 0` on an unknown is the same lie in numeric form, and the terminal pane
 * renders that number to the user ("your 0 saved files are safe").
 */
export function reportableFileCount(count: number | null | undefined): number | null {
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
}
