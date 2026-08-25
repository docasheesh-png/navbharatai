// AgentV3 — saying so when the safety net caught the work.
//
// ⚠️ THE BUILD THAT TOLD THE USER IT HAD SUCCEEDED WHILE ITS OWN GUARD THREW THE WORK AWAY
// (admin build report 2026-08-25; their words: "baar baar kehne par game me gaadi ki speed kyu nahi
// badhayi ja rahi? pehle game theek chala, baad me speed phir se 0 ho gayi kyu?").
//
// The report's last four seconds:
//
//     GREEN_GUARD_RESTORE   the app was verified working before this turn and is not working after
//                           it — the last known good state was restored
//     GREEN_GUARD_RESTORED  4 file(s) put back, 5 added by the failed attempt removed
//     endedAt               ok: true, summary: "✅ Preview अब काम कर रहा है! … बाइक ऑटोमैटिक आगे बढ़ रही है"
//
// The Green Guard is RIGHT to restore: shipping an app that no longer runs is worse than shipping one
// that does. What was wrong is that it told nobody. It emitted a narration into a stream the user had
// stopped watching and a finding into an admin-only report — and the SUMMARY, the one sentence a user
// actually reads, still described the change as delivered.
//
// So from the user's chair: they ask for more speed, are told it is done, and the speed is unchanged.
// They ask again. Same answer, same result. That is not a game bug and no amount of re-asking could
// ever have fixed it — the change was being made and then deliberately undone every time.
//
// THE CORRECTION LEADS, it does not trail. A note under a green tick is read as a footnote to success;
// this replaces the claim before the user acts on it.
//
// PURE.

export interface GreenGuardRestoreFacts {
  /** Files put back to the last verified-working version. */
  restored: number;
  /** Files the failed attempt had added, and which were removed again. */
  removed: number;
}

/** Did the guard actually undo anything? A restore that changed nothing is not worth saying. */
export function greenGuardUndidWork(f: GreenGuardRestoreFacts | null | undefined): boolean {
  if (!f) return false;
  return (Number(f.restored) || 0) > 0 || (Number(f.removed) || 0) > 0;
}

/**
 * The sentence that goes ABOVE the build's own summary.
 *
 * Three things a person needs, in order: what happened to their request, that their app is safe, and
 * what to do next. It deliberately does NOT apologise or explain the guard — the user asked for a
 * change and did not get it; that is the news.
 */
export function greenGuardSummaryCorrection(f: GreenGuardRestoreFacts): string {
  const parts: string[] = [];
  parts.push('⚠️ **Your change was not kept.**');
  parts.push(
    'The app stopped working with it, so the last version that DID work was put back — '
    + `${f.restored} file(s) restored${f.removed > 0 ? ` and ${f.removed} new one(s) removed` : ''}. `
    + 'Your app is exactly as it was before this request: nothing is broken, and nothing changed.',
  );
  parts.push(
    'Asking again the same way will most likely do the same thing. Tell me what went wrong on screen, '
    + 'or ask for the change in smaller steps, and I will work from there.',
  );
  return parts.join('\n\n');
}

/**
 * Apply the correction to a summary, once.
 *
 * Idempotent by marker: this runs on a path that can be reached twice (the normal settle and the
 * watchdog finalizer), and two copies of "your change was not kept" reads like a malfunction.
 */
export const GREEN_GUARD_MARK = '⚠️ **Your change was not kept.**';

export function withGreenGuardCorrection(summary: string, f: GreenGuardRestoreFacts): string {
  const s = String(summary ?? '');
  if (s.includes(GREEN_GUARD_MARK)) return s;
  return `${greenGuardSummaryCorrection(f)}\n\n---\n\n${s}`;
}
