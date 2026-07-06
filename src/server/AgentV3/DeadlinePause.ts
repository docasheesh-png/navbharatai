// AgentV3 — honest wording for a wall-clock deadline PAUSE (RC-4, admin 2026-07-06).
//
// When a build hits the wall-clock cap it is paused and auto-continued (bounded, client-side via
// decideAutoContinue). The OLD message claimed "It was likely almost done" — an UNVERIFIED guess that is
// simply false for a big build that timed out EARLY (violates the no-fake-success / honesty rule). This
// module produces an HONEST message from the one reliable progress signal available at the deadline: the
// number of files written so far. It never guesses how close the build was. Pure + unit-tested.

export interface DeadlinePauseMessage {
  /** In-chat narration line shown when the pause fires. */
  narration: string;
  /** Short result summary carried on the resumable result event. */
  summary: string;
}

/**
 * Honest deadline-pause wording. `filesChangedSoFar` is the count of files the build wrote before the
 * cap (writtenFiles.size on the route) — the only progress fact we can state without guessing. Never
 * claims the build was "almost done": on a large project a pause can happen with lots left to do.
 */
export function deadlinePauseMessage(filesChangedSoFar: number): DeadlinePauseMessage {
  const n = Number.isFinite(filesChangedSoFar) && filesChangedSoFar > 0 ? Math.floor(filesChangedSoFar) : 0;
  if (n > 0) {
    const f = `${n} file${n === 1 ? '' : 's'}`;
    return {
      narration: `⏱️ I reached the time limit for this round — ${f} of progress ${n === 1 ? 'is' : 'are'} saved. Continuing automatically from where I left off…`,
      summary: `Time limit reached — ${f} saved so far. Continuing automatically…`,
    };
  }
  return {
    narration: '⏱️ I reached the time limit before any files were written this round — nothing was lost. Continuing automatically from here…',
    summary: 'Time limit reached — continuing automatically…',
  };
}
