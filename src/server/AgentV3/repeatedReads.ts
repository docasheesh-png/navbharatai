// AgentV3 — the same file, read again, unchanged.
//
// ⚠️ MEASURED, NOT GUESSED (admin's live build report, 2026-08-25 — the first one carrying the tool
// targets that #2672 added, which existed precisely so this question could be asked):
//
//     55 read_file calls · 9 distinct files · 46 wasted re-reads (84%)
//         12x  server/backupJob.ts
//         12x  client/src/pages/provider-dashboard.tsx
//          9x  server/storage.ts
//          5x  client/src/pages/provider-edit-profile.tsx   ← five times in fourteen seconds
//
// The day before, the report recorded `▶ read_file` with no target, and I declined to build a cache on
// a hunch. This is what the evidence turned out to be.
//
// 🔑 WHY THIS IS A NUDGE AND NOT A CACHE, which is the whole design decision:
//
// A content cache would save the sandbox round-trip — about 200ms. It would save NOTHING that actually
// costs: the model has already spent the TURN deciding to call the tool, and the file body is already
// on its way into the context window either way. On a weak tier the turn and the tokens ARE the budget.
// A cache optimises the one number nobody was paying.
//
// So the intervention is aimed at the model's own choice: tell it, in the tool result it is already
// reading, that it has this file and the file has not moved. That is what a colleague would say.
//
// 🔒 THE CONTENT IS ALWAYS RETURNED IN FULL. Suppressing it would save real tokens and is exactly the
// wrong trade: if the model's context has been trimmed, an answer of "you already have this" leaves it
// genuinely unable to proceed, and a builder that cannot re-read a file is a worse product than one
// that reads it twice. The notice costs a line; being wrong about what the model remembers costs a build.
//
// PURE — the caller owns the ledger and the I/O.

/** What we remember about one file, per build. */
export interface ReadRecord {
  /** How many times it has been read so far, including this one. */
  count: number;
  /** Hash-free: the content itself is the comparison, and the caller holds it. */
  unchanged: boolean;
}

/**
 * The line to put in front of a re-read of an unchanged file, or '' when there is nothing to say.
 *
 * Silent on the first read and on a file that genuinely changed — a re-read after an edit is correct
 * behaviour and must never be discouraged, which is the difference between this and a nag.
 */
export function repeatedReadNotice(path: string, count: number, unchanged: boolean): string {
  if (!unchanged || count < 2) return '';
  const times = count === 2 ? 'the second time' : `the ${count}${ordinalSuffix(count)} time`;
  return (
    `[NOTE — you have now read ${path} ${times} in this build, and it has NOT changed since your `
    + 'first read. The full content follows, but you already have it. Re-reading a file you have not '
    + 'edited costs a step and buys nothing — work from what you have, and read again only after you '
    + 'change it.]\n'
  );
}

function ordinalSuffix(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/**
 * The build-report finding, when a build ends up doing enough of this to be worth naming.
 *
 * Reported rather than merely nudged, so the NEXT report says whether the nudge worked. A behavioural
 * fix nobody measures is a hope, and this file exists because the previous version of that hope could
 * not be checked against anything.
 */
export function repeatedReadSummary(reads: Map<string, number>): string {
  const total = [...reads.values()].reduce((a, b) => a + b, 0);
  const distinct = reads.size;
  const wasted = total - distinct;
  if (distinct === 0 || wasted < 5) return '';   // a couple of re-reads is ordinary work, not a finding
  const worst = [...reads.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([p, n]) => `${n}× ${p}`)
    .join(', ');
  const pct = Math.round((wasted / total) * 100);
  return (
    `${total} file reads covered only ${distinct} distinct file(s) — ${wasted} of them (${pct}%) re-read `
    + `a file that had not changed. Worst: ${worst}. Each one costs a step of the build's budget.`
  );
}
