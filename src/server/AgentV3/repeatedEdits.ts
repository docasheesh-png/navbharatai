// ONE FILE, EDITED A PIECE AT A TIME, TWENTY TIMES (autopsy ce115e1f, 2026-09-30). A designer sub-agent
// styled `src/index.css` through ~20 serial `edit_file` calls — each a full model round trip — for about
// eleven minutes of a 27.8-minute build. Every edit succeeded, so nothing on the error paths saw it, and
// the read-loop breaker (repeatedReads.ts) watches READS, not writes.
//
// The remedy is not a refusal: small edits are the right tool for a small change. It is one sentence,
// said at the moment a file has plainly become a rewrite being done by instalments: read it once, write
// it whole. PURE.

/** The edit count, on one file in one agent's run, at which the note first appears. */
export const EDIT_LOOP_NOTE_AT = 6;
/** After the first note, how many further edits before it is said again. */
export const EDIT_LOOP_REPEAT_EVERY = 5;

/** '' unless `count` (edits to `path` so far, this one included) has reached a note point. */
export function repeatedEditNotice(path: string, count: number): string {
  const n = Math.floor(Number(count) || 0);
  if (n < EDIT_LOOP_NOTE_AT) return '';
  if ((n - EDIT_LOOP_NOTE_AT) % EDIT_LOOP_REPEAT_EVERY !== 0) return '';
  return `\n\n⚠️ This is edit #${n} to ${path} in this run, one small piece at a time — each edit is a full round `
    + `trip. If more changes to ${path} remain, make them ALL in ONE write_file call with the complete file, `
    + `instead of more single edits.`;
}
