// AgentV3 — honest wording for a wall-clock deadline PAUSE (RC-4, admin 2026-07-06).
//
// A deadline closes the response while an unabortable body may still be leaving. It cannot promise
// automatic continuation or confirmed persistence. State the observed file changes and the retry
// boundary, never how close the unfinished build was to success. Pure + unit-tested.

export interface DeadlinePauseMessage {
  /** In-chat narration line shown when the pause fires. */
  narration: string;
  /** Short result summary while actual body exit is still unconfirmed. */
  summary: string;
}

/**
 * Honest deadline-pause wording. `filesChangedSoFar` is the count of files the build wrote before the
 * cap (writtenFiles.size on the route) — the only progress fact we can state without guessing. Never
 * claims the build was "almost done": on a large project a pause can happen with lots left to do.
 */
export function deadlinePauseMessage(filesChangedSoFar: number): DeadlinePauseMessage {
  const count = Number.isFinite(filesChangedSoFar) && filesChangedSoFar > 0 ? Math.floor(filesChangedSoFar) : 0;
  const progress = count ? `${count} file${count === 1 ? '' : 's'} changed so far. ` : '';
  const summary = `Time limit reached — ${progress}The previous work is still stopping. Please retry after it finishes.`;
  return { narration: `⏱️ ${summary}`, summary };
}
