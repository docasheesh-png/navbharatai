// AgentV3 — file-reveal pacing for the live build feed (admin directive 2026-07-21).
//
// The engine generates many files in parallel (the fast lane fires bounded-concurrent per-file calls), so
// completion lines like "✓ src/api/orders.js (2/44)" often land in BURSTS — six files flash into the feed
// in one second, then nothing for a minute. The admin's ask: keep the background build exactly as fast as
// it is, but let the USER see files landing one by one — engaging, readable, and honest.
//
// HONESTY BOUNDARY (rule 2 — this is presentation pacing, never fabrication):
//   • Only REAL events are shown, byte-for-byte unmodified, in the EXACT order they arrived — a later
//     event can never overtake an earlier one (once anything is queued, everything queues behind it).
//   • Only the file-completion lines are ever *delayed* (by the min-interval drip); every other event
//     passes through immediately when the queue is empty.
//   • A terminal event (result / done / error) flushes the whole queue INSTANTLY — the user never waits
//     on the drip to learn the build finished, and nothing is ever dropped.
//   • A large backlog drains at 4× speed (the drip must never lag the real build by more than seconds).
// Pure + injectable clock/scheduler → fully unit-testable without timers.

/** A per-file completion line as the engine narrates it: "✓ <path> (n/m)". */
export const FILE_REVEAL_RE = /^✓ \S+ \(\d+\/\d+\)$/;

/**
 * True for a wire event that reveals ONE file to the user — paced so files land in the feed
 * one by one instead of in bursts. Two kinds qualify:
 *   • the narration completion line "✓ <path> (n/m)" (fast-lane per-file tick), and
 *   • the `file_changed` event itself (admin 2026-07-21: bulk writes — e.g. write_files_batch
 *     emitting 10 files in one loop — used to flash all their activity rows at once; pacing the
 *     event spreads the real rows out one per interval, real names, real order).
 */
export function isFileRevealEvent(e: unknown): boolean {
  const ev = e as { type?: string; text?: string } | null;
  if (ev?.type === 'file_changed') return true;
  return ev?.type === 'narration' && typeof ev.text === 'string' && FILE_REVEAL_RE.test(ev.text.trim());
}

/** Wire-event types that must always flush the queue and dispatch immediately: build-terminal
 * events, plus INTERACTIVE prompts (an approval gate / clarify card pauses or addresses the user —
 * it must never sit behind presentation pacing). */
export function isFlushEvent(e: unknown): boolean {
  const t = (e as { type?: string } | null)?.type;
  return t === 'result' || t === 'done' || t === 'error' || t === 'permission_request' || t === 'clarify';
}

export interface RevealPacer<E> {
  /** Enqueue/dispatch one event (order across ALL events is always preserved). */
  push(e: E): void;
  /** Dispatch everything queued immediately (terminal event / stream end). */
  flush(): void;
  /** Drop everything queued without dispatching (a stale stream — a newer turn owns the state). */
  discard(): void;
  /** Events currently waiting (for tests/telemetry). */
  queued(): number;
}

export interface RevealPacerOptions {
  /** Minimum ms between two FILE-completion reveals. <= 0 disables pacing entirely (pass-through). */
  minIntervalMs?: number;
  /** Queue length beyond which the drip drains at 4× speed (never lag the real build). */
  maxQueue?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export function createRevealPacer<E>(dispatch: (e: E) => void, opts: RevealPacerOptions = {}): RevealPacer<E> {
  const minIntervalMs = opts.minIntervalMs ?? 600;
  const maxQueue = opts.maxQueue ?? 20;
  const now = opts.now ?? (() => Date.now());
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const queue: E[] = [];
  let lastFileAt = 0;
  let timer: unknown = null;

  const dispatchNow = (e: E): void => {
    dispatch(e);
    if (isFileRevealEvent(e)) lastFileAt = now();
  };

  const effectiveInterval = (): number => (queue.length > maxQueue ? Math.max(1, minIntervalMs / 4) : minIntervalMs);

  const drain = (): void => {
    timer = null;
    while (queue.length > 0) {
      const head = queue[0];
      if (isFileRevealEvent(head)) {
        const wait = effectiveInterval() - (now() - lastFileAt);
        if (wait > 0) {
          timer = schedule(drain, wait);
          return;
        }
      }
      queue.shift();
      dispatchNow(head);
    }
  };

  return {
    push(e: E): void {
      if (minIntervalMs <= 0) { dispatchNow(e); return; }
      if (isFlushEvent(e)) { this.flush(); dispatchNow(e); return; }
      // Order preservation: once anything is queued, EVERYTHING later queues behind it.
      if (queue.length > 0 || timer !== null) {
        queue.push(e);
        if (timer === null) { drain(); return; }
        // The backlog just crossed the deep threshold — the pending timer was armed at the BASE
        // interval; re-arm it at the faster effective interval so the drip immediately speeds up.
        if (queue.length > maxQueue) {
          cancel(timer);
          timer = schedule(drain, Math.max(1, effectiveInterval() - (now() - lastFileAt)));
        }
        return;
      }
      if (isFileRevealEvent(e)) {
        const wait = minIntervalMs - (now() - lastFileAt);
        if (wait > 0) { queue.push(e); timer = schedule(drain, wait); return; }
      }
      dispatchNow(e);
    },
    flush(): void {
      if (timer !== null) { cancel(timer); timer = null; }
      while (queue.length > 0) dispatchNow(queue.shift() as E);
    },
    discard(): void {
      if (timer !== null) { cancel(timer); timer = null; }
      queue.length = 0;
    },
    queued: () => queue.length,
  };
}
