// AgentV3 — the one decision that keeps a vendor's error page off the user's screen.
//
// ADMIN REPORT 2026-09-03, with a screenshot: an app that had built fine was closed and reopened. The
// sandbox resumed, our own "Waking your preview — Preparing your app's environment" bar was counting
// 25s at the top of the panel — and directly beneath it the frame showed E2B's "Closed Port Error",
// naming the sandbox id and the refused port. The admin's words: "hamesha aise hi hota hai."
//
// TWO RULES THIS FILE EXISTS TO KEEP, both already stated elsewhere in the codebase and both broken by
// the same expression:
//   1. Never frame a host we have not seen serving — what it returns is not the user's app.
//   2. Never put a third-party vendor's name on a user's screen (the white-label law).
//
// It is a PURE function on purpose. The condition it replaces lived inline in a 1,700-line component
// where it could not be exercised by a test, and it had already been patched three separate times for
// three different reports of the same symptom.

export interface FramingState {
  /** The URL did not answer at all — connection refused rather than a bad response. */
  unreachable: boolean;
  /** The machine answers, but nothing is serving on the app's port. */
  portDown: boolean;
  /** A wake / diagnose / restart is running right now. */
  diagnosing: boolean;
  /** We hold a link to OUR OWN preview door, which resolves the machine server-side. */
  hasDoorUrl: boolean;
  /** We are serving the VM-free saved copy of the app instead of a machine. */
  hasSnapshotUrl: boolean;
  /**
   * Would framing right now mean pointing at a raw machine address nobody has checked?
   * (Computed by the caller — it depends on the watchdog's own eligibility rules.)
   */
  framingUnchecked: boolean;
}

/**
 * Should the panel show OUR OWN "not serving yet" surface instead of framing the URL?
 *
 * ROOT CAUSE OF THE 2026-09-03 REPORT — the guard was written as `portDown && !diagnosing`.
 *
 * The `!diagnosing` was meant to mean "a repair is already running, so do not also show a static
 * problem panel". What it actually did was switch OFF the never-frame-a-dead-machine rule during the
 * one window in which the port is *known* to be down — a wake only runs because something is wrong.
 * So the moment we started fixing the problem, we began showing the vendor's diagnosis of it.
 *
 * The escape was never needed for the case it was written for: a wake that SUCCEEDS clears `portDown`
 * and bumps the frame's remount key in the same breath, so the app appears the instant it is real.
 * Suppressing the panel mid-wake bought nothing and cost the guarantee.
 *
 * ⚠️ A DOOR URL IS NOT A RAW MACHINE. When the server has minted one, the frame holds OUR route, which
 * resolves "which machine, which port" at request time and can only ever return our own page — so a
 * wake in flight is free to keep framing it, and the user watches the app walk back up by itself.
 * That distinction is why this takes `hasDoorUrl` rather than just a URL string: the fix must not
 * downgrade the door path to a static panel, which would undo the better experience it was built for.
 *
 * PURE.
 */
export function shouldShowNotServingSurface(s: FramingState): boolean {
  // A saved snapshot is our own content and always safe to frame.
  if (s.hasSnapshotUrl) return false;
  /**
   * THE DOOR IS THE ONE THING WORTH FRAMING WHILE A WAKE RUNS.
   *
   * This is the `!diagnosing` escape's legitimate half, kept deliberately. Its stated purpose was that
   * pressing "Wake up" must not replace the app with a static panel for the whole reboot — which
   * "reads as *it broke* at exactly the moment it is being fixed". That is true, and it is true ONLY
   * of the door: our own route resolves the machine server-side, shows a NavBharatAI reconnecting page
   * while the port is down, and walks itself back into the app the moment it serves.
   *
   * The escape's other half was never true. Written 2026-08-13, nine days before the door existed, the
   * only thing it could keep on screen was a RAW machine address — and a machine mid-wake is not
   * serving by definition, so what it kept on screen was the vendor's error page. The guarantee this
   * module exists for was created on 2026-08-23 from a screenshot of that page; the escape then let
   * the identical screenshot come back on 2026-09-03, which is how we know the two halves needed
   * separating rather than choosing between.
   */
  if (s.diagnosing && s.hasDoorUrl) return false;
  // Evidence, or a wake in flight with only a raw address to frame: both mean the frame cannot hold
  // the user's app, so it must hold ours.
  return s.unreachable || s.portDown || s.diagnosing || s.framingUnchecked;
}
