// PREVIEW — WHEN A RUNNING APP MAY BE RELOADED UNDER THE PERSON USING IT.
//
// THE ADMIN'S REPORT (2026-08-23): "app banne ke baad, build hoti hi rahti hai, aur chalti huyi app
// tut jati hai." A finished-looking app coming apart while its user was in the middle of using it.
//
// THE MECHANISM, from our own code. Streaming first paint (live since 2026-08-14) publishes files the
// moment they are written, precisely so the user sees their app 30-155s sooner. Each batch bumps
// `reloadSignal`, and in LIVE mode the handler does `setLiveReloadKey(k => k + 1)` — which changes the
// iframe's React key, so the iframe is DESTROYED AND RE-CREATED. Not a hot reload: a hard remount.
// Anything the person had typed, opened, scrolled to or navigated to is gone.
//
// While the builder is still writing NEW files that is a good trade — the app is visibly growing and
// there is nothing to lose yet. It stops being a good trade the moment the app is complete enough to
// use and the engine moves on to VERIFYING and REPAIRING it, because now every write is mid-surgery:
// a half-applied fix, a file being rewritten for the fourth time, a repair that took the error count
// from 4 to 41 before being reverted. Remounting into that shows the user their working app breaking,
// repeatedly, for as long as the repair phase lasts. In the reported build that was seven minutes.
//
// THE DISCRIMINATOR HAD TO BE THE BUILD'S PHASE, and it is worth saying why nothing simpler works.
// The obvious rule — "stop reloading once the user starts interacting" — cannot be implemented: the
// app runs in a cross-origin iframe, so we cannot see a single click, keystroke or scroll inside it,
// and no amount of cleverness changes that. The phase is a fact we DO own: "am I still writing this
// app, or am I now fixing one that already runs?"
//
// SO: reload freely while the app is being written; once it has rendered and the engine is only
// settling it, hold the reload and OFFER it. The user is told what changed and can take it whenever
// they like; if they do nothing, it lands automatically the moment the build actually finishes.
//
// PURE — no clock, no DOM, no I/O.

/**
 * What the engine is doing to this workspace right now.
 *
 * `settling` is the load-bearing one: the app exists and runs, and everything happening to it now is
 * verification and repair. It is deliberately NOT called "repairing" — a build can be settling because
 * it is type-checking, running the app's tests or healing a gate, and all of those write files.
 */
export type BuildPhase = 'idle' | 'generating' | 'settling';

export interface ReloadDecision {
  /** Reload the preview right now. */
  reload: boolean;
  /** Hold this change back and tell the user it is waiting. */
  defer: boolean;
}

/**
 * May an incoming file change reload the preview right now?
 *
 * IN-BROWSER MODE IS DELIBERATELY UNCHANGED. It is same-origin and cheap, its reload is not a hard
 * remount of a live server-backed app, and it is not where the reported failure happened. Narrowing
 * the blast radius of a change to the preview — the surface that has taken the most repair this week —
 * is worth more than the small extra consistency.
 */
export function decidePreviewReload(o: {
  mode: string;
  phase: BuildPhase;
  /** Has the live preview successfully rendered at least once? */
  everRendered: boolean;
  /**
   * ms since Vite's hot reload last applied an update inside the app, or null if it never has.
   *
   * 🔑 THE PREMISE ABOVE CHANGED (2026-09-10). This module states, correctly for when it was written,
   * that we cannot see inside a cross-origin frame. The preview bridge now runs INSIDE the app and
   * reports both of these, so the decision can use evidence rather than the build phase as a proxy.
   */
  hmrAgeMs?: number | null;
  /** ms since someone last clicked, typed or scrolled inside the app, or null if nobody has. */
  activityAgeMs?: number | null;
}): ReloadDecision {
  if (o.mode !== 'live') return { reload: true, defer: false };
  // Nothing on screen yet — there is no user state to lose and everything to gain by showing it.
  if (!o.everRendered) return { reload: true, defer: false };

  // HOT RELOAD ALREADY DID IT. The change is on screen; the hard remount that used to follow was pure
  // loss — it destroyed whatever the person had typed or opened in order to show them something they
  // could already see. Not a defer: there is nothing left to land, so nothing is held back and no
  // "updates waiting" line is shown for a change that has already arrived.
  if (typeof o.hmrAgeMs === 'number' && o.hmrAgeMs >= 0 && o.hmrAgeMs <= HMR_FRESH_MS) {
    return { reload: false, defer: false };
  }

  // SOMEONE IS USING THE APP RIGHT NOW. This is the rule the module said could not be implemented, and
  // it is strictly better than the phase test that stood in for it: a build that is still 'generating'
  // can perfectly well be one whose app the user has already started filling in.
  if (typeof o.activityAgeMs === 'number' && o.activityAgeMs >= 0 && o.activityAgeMs <= ACTIVITY_FRESH_MS) {
    return { reload: false, defer: true };
  }

  // The app is up and the engine is only settling it. Hold.
  if (o.phase === 'settling') return { reload: false, defer: true };
  return { reload: true, defer: false };
}

/**
 * How recently a hot update must have landed for us to trust that the change is already on screen.
 *
 * The reload signal is debounced by 900ms before this runs, and Vite applies an update within a few
 * hundred ms of the write, so a live HMR client always lands well inside this. Kept SHORT on purpose:
 * if HMR has gone quiet — the socket dropped, the update needed a full reload, the app is not
 * Vite-served at all — the window lapses and the hard reload happens exactly as it does today. A
 * stale preview is a worse failure than a lost scroll position, so the fallback must be the reload.
 */
export const HMR_FRESH_MS = 4_000;

/**
 * How recently someone must have touched the app to count as "using it".
 *
 * Long enough to cover reading a page or thinking mid-form, short enough that an abandoned tab does
 * not hold updates back forever — and it cannot hold them forever in any case, because
 * shouldFlushOnBuildEnd lands everything held the moment the build finishes.
 */
export const ACTIVITY_FRESH_MS = 30_000;

/**
 * The build just ended. Should the held-back changes land now?
 *
 * Yes, and automatically — a user who ignored the offer must still end up looking at the finished app
 * rather than at a stale one they were never told had gone stale. This is the half that keeps the
 * deferral honest: holding a reload forever would be its own version of showing the wrong thing.
 */
export function shouldFlushOnBuildEnd(o: { phase: BuildPhase; pendingChanges: number }): boolean {
  return o.phase === 'idle' && o.pendingChanges > 0;
}

/**
 * The line shown while changes are held. Plain, countable, and honest about WHY — "still finishing"
 * is the true reason, and it is also the thing the user most needs to know before judging the app.
 */
export function deferredReloadNote(pendingChanges: number): string {
  if (pendingChanges <= 0) return '';
  const n = pendingChanges;
  return `Still finishing your app — ${n} update${n === 1 ? '' : 's'} ready. Your current view is kept so nothing you are doing is lost.`;
}
