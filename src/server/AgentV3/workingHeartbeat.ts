// "IS IT STUCK, OR IS IT WORKING?" — the question a build gave a user no way to answer.
//
// 🔴 ROOT CAUSE (autopsy 2b0a3ed5, 2026-09-17). A calculator build ran 66 seconds and the user pressed
// Stop. Of those 66 seconds, **63 showed them nothing at all**: the scaffold narration fired at 6.7 s
// and the next line arrived at 62.7 s, because the single model call in between took 55.7 seconds. The
// screen was not slow, it was BLANK — and a blank screen and a crashed app look identical.
//
// ⚠️ THE ETA WAS WITHHELD, AND THAT WAS THE RIGHT CALL. The report says so in its own words: *"I don't
// have a reliable time for this one yet"*, because the only estimate available was a prompt-word
// heuristic, and this repo's standing rule is that a heuristic is not evidence. Nothing about that
// changes here.
//
// 🔑 WHAT CHANGED IS THAT AN ELAPSED CLOCK IS NOT AN ESTIMATE. "34 seconds have passed" is a
// measurement — it cannot be wrong, it promises nothing, and it is the one honest thing we could have
// shown that whole minute. The distinction is the same one the whole report discipline rests on: we
// may always say what we have measured, and never what we have guessed.
//
// Pure: no clock of its own, no I/O, no env. The caller supplies elapsed time.

/**
 * The marker every transient status line carries.
 *
 * It exists so two different readers can recognise these lines without pattern-matching their wording:
 * the build report records only the FIRST one (a line that updates every 15 seconds would otherwise
 * bury the timeline it is meant to sit in), and the transcript builder already drops ⏱-prefixed ETA
 * lines from the assistant turn for the same reason.
 */
export const WORKING_MARKER = '⏳';

/** `45s`, `1m 12s`, `12m 03s` — short enough to sit on one line and never rounded up to flatter us. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

/**
 * The line the user reads while a model call is in flight.
 *
 * Deliberately says nothing about how much longer. It reports what has happened and stops — see this
 * file's header for why that boundary is the whole point.
 */
export function workingLine(elapsedMs: number): string {
  return `${WORKING_MARKER} Still working — ${formatElapsed(elapsedMs)} so far`;
}

/** Is this narration one of our transient status lines rather than real build progress? PURE. */
export function isTransientStatusLine(text: string | null | undefined): boolean {
  return String(text ?? '').trimStart().startsWith(WORKING_MARKER);
}

/**
 * When the first heartbeat appears, and how often after that.
 *
 * ⚠️ THE FIRST DELAY IS THE DESIGN DECISION. Most turns answer well inside it, so a line that appeared
 * at once would flicker on and off for every ordinary call and teach the user to ignore it — and the
 * reported build's problem was never the first ten seconds, it was the fifty after them. Twelve
 * seconds is past every healthy turn in the reports to hand and well before a person starts wondering
 * whether the app has died.
 */
export const WORKING_FIRST_MS = 12_000;

/** How often the clock updates once it is showing. */
export const WORKING_INTERVAL_MS = 15_000;

/**
 * Start a heartbeat that calls `emit(elapsedMs)` on that schedule until it is stopped.
 *
 * Returns the stopper. The timers are `unref`ed where the runtime supports it, so a forgotten
 * heartbeat can never hold the process open — an observation must never outlive the thing it observes.
 */
export function startWorkingHeartbeat(
  emit: (elapsedMs: number) => void,
  opts: { firstMs?: number; intervalMs?: number; now?: () => number } = {},
): () => void {
  const now = opts.now ?? (() => Date.now());
  const firstMs = typeof opts.firstMs === 'number' && opts.firstMs > 0 ? opts.firstMs : WORKING_FIRST_MS;
  const intervalMs = typeof opts.intervalMs === 'number' && opts.intervalMs > 0 ? opts.intervalMs : WORKING_INTERVAL_MS;
  const startedAt = now();
  let interval: ReturnType<typeof setInterval> | undefined;
  const unref = (t: { unref?: () => void } | undefined) => { try { t?.unref?.(); } catch { /* not every runtime has it */ } };

  const tick = () => { try { emit(Math.max(0, now() - startedAt)); } catch { /* a status line must never break a build */ } };

  const first = setTimeout(() => {
    tick();
    interval = setInterval(tick, intervalMs);
    unref(interval as unknown as { unref?: () => void });
  }, firstMs);
  unref(first as unknown as { unref?: () => void });

  return () => {
    try { clearTimeout(first); } catch { /* best-effort */ }
    if (interval) { try { clearInterval(interval); } catch { /* best-effort */ } }
  };
}
