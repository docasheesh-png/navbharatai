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
// ⏱️ …AND THE NUMBER IS THE USER'S WAIT, NOT THE CALL'S AGE (autopsy 303e8a6f, 2026-10-12). The clock started
// when the MODEL CALL started, so a user who had waited 23 s was told "Still working — 11s so far", and on a
// multi-turn build the clock restarted at "12s" on every slow turn, ten minutes in. A measurement is only
// honest about what it says it measures, and "so far" names the build. WHEN to speak is still the call's
// business (twelve seconds of this call's silence); WHAT number to show is measured from `originMs`, the
// moment the user started waiting — required, so no caller can fall back to the call start.
//
// Pure: no I/O, no env. The caller supplies the origin; the clock is injectable.

/**
 * The marker every transient status line carries.
 *
 * ⚠️ NOT A CLASSIFIER (autopsy 303e8a6f). Other progress lines start with the same emoji (the build-budget
 * steer, the hand-back notice), so readers recognise the heartbeat by its id — `isLiveStatusLine` in
 * src/lib/liveStatusLine.ts — never by this character.
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
 * The schedule is relative to THIS call (first tick after `firstMs` of its silence); the number is measured
 * from `originMs`, the moment the user started waiting (the build's event stream — see AgentEventStream).
 *
 * Returns the stopper. The timers are `unref`ed where the runtime supports it, so a forgotten
 * heartbeat can never hold the process open — an observation must never outlive the thing it observes.
 */
export function startWorkingHeartbeat(
  emit: (elapsedMs: number) => void,
  opts: { originMs: number; firstMs?: number; intervalMs?: number; now?: () => number },
): () => void {
  const now = opts.now ?? (() => Date.now());
  const firstMs = typeof opts.firstMs === 'number' && opts.firstMs > 0 ? opts.firstMs : WORKING_FIRST_MS;
  const intervalMs = typeof opts.intervalMs === 'number' && opts.intervalMs > 0 ? opts.intervalMs : WORKING_INTERVAL_MS;
  // An origin we cannot read is the one case where the call start is all we have — and it is never later
  // than the user's real wait began, so the number can only err short, never invent time.
  const originMs = Number.isFinite(opts.originMs) ? opts.originMs : now();
  let interval: ReturnType<typeof setInterval> | undefined;
  const unref = (t: { unref?: () => void } | undefined) => { try { t?.unref?.(); } catch { /* not every runtime has it */ } };

  const tick = () => { try { emit(Math.max(0, now() - originMs)); } catch { /* a status line must never break a build */ } };

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
