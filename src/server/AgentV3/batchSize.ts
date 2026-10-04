/**
 * 🔴 SEVEN FILES IN ONE CALL IS SEVEN FILES NOBODY SEES FOR THREE MINUTES (Q-065, autopsy de3bb2bb, 2026-10-01).
 *
 * The architect wrote seven screens with one `write_files_batch`: one model call, 16,702 output tokens,
 * 189 seconds. Nothing reaches the sandbox, the live preview or the user's strip until the whole call
 * completes, and the whole call has to fit inside the streaming hard cap (300 s,
 * `AGENTV3_STREAM_HARD_CAP_MS`). The prompt told it to do exactly that: "pass all files in one call … 3×
 * faster than calling write_file one-by-one". That claim was never measured, and the opposite is true for
 * the cost that matters — the call's length is the SUM of the files' output, whichever tool carries them.
 * A batch saves turns, not tokens; a large batch buys that by holding the user's preview hostage and by
 * risking the whole set on one cut-off stream.
 *
 * The admin asked for the best choice for NavBharatAI. It is a SMALL batch: at most three new files per
 * call. That keeps the saving where it is real (small sibling files written together), puts a visible step
 * in front of the user every minute or so, and means a stream cut off at the cap loses three files, not
 * seven. ONE number, read by the prompt, the tool description and the dispatcher, so they cannot drift.
 *
 * 🔒 An oversized batch is still WRITTEN in full — the tokens are already spent, and refusing them would
 * throw away finished work. The model is told, in the tool result, to keep the next batch smaller.
 */

/** The most NEW files one `write_files_batch` call should carry. */
export const MAX_FILES_PER_BATCH = 3;

/** The note appended to a batch result that carried more than `MAX_FILES_PER_BATCH` files. '' otherwise. PURE. */
export function batchSizeNote(fileCount: number): string {
  if (!Number.isFinite(fileCount) || fileCount <= MAX_FILES_PER_BATCH) return '';
  return `\n⚠️ This batch carried ${fileCount} files in one call. All of them were written, but nothing reached `
    + 'the live preview until the whole call finished, and a call that long can be cut off at the stream limit. '
    + `Write at most ${MAX_FILES_PER_BATCH} new files per write_files_batch from now on, entry and shared files first.`;
}
