// AgentV3 — ONE "Wake up" press really brings the live preview back (admin 2026-11-21).
//
// ROOT CAUSE. The Preview tab showed "Preview is in sleep mode … [Wake up]". The wake itself worked —
// the server rebooted the sandbox and saw the port answer — but three things then undid it:
//   1. the live frame's src was `idleSnapshotUrl || door || url`, and a successful wake never cleared
//      the saved-copy url, so the copy kept winning the frame;
//   2. the next health check skipped the port on purpose (a current copy exists, so the idle sweep may
//      pause the machine) and then reported that unchecked port as "sleeping" — banner back, copy back;
//   3. nothing told the server the person had asked for the live app, so every later check repeated it.
//
// This module holds the client half of the fix as PURE rules (the server half is
// planPreviewHealthProbe in src/server/AgentV3/PreviewHealth.ts): once a person's wake succeeds, the
// surface remembers that they want live (per workspace, until a new build starts), sends `wantLive` on
// every health check, and frames the live address instead of the copy.

/** What the live iframe should load, and whether that is the saved copy (it gets a stricter sandbox). */
export interface LiveFrameChoice {
  src: string;
  isSnapshot: boolean;
}

/**
 * Choose the live iframe's src. PURE.
 *
 * Normally the saved copy leads (a finished app is shown from it so no machine is held open). Once the
 * person has asked for the live app, the live address leads — the door first (it resolves the machine
 * on the server), then the raw url — and the copy is only a last resort when no live address exists.
 */
export function chooseLiveFrameSrc(i: {
  snapshotUrl: string;
  /** The door url already resolved against the API base, or '' when the server offers none. */
  doorHref: string;
  effectiveUrl: string;
  liveWanted: boolean;
}): LiveFrameChoice {
  const live = i.doorHref || i.effectiveUrl;
  if (i.liveWanted && live) return { src: live, isSnapshot: false };
  if (i.snapshotUrl) return { src: i.snapshotUrl, isSnapshot: true };
  return { src: live, isSnapshot: false };
}

/** The saved copy the surface may frame right now: none while the person has asked for the live app. */
export function framedSnapshotUrl(snapshotUrl: string, liveWanted: boolean): string {
  return liveWanted ? '' : snapshotUrl;
}

/** After this many failed wakes in a row, stop promising the live version "takes over by itself". */
export const WAKE_FAILURES_BEFORE_PLAIN_NOTE = 2;

/** Said plainly once waking has failed repeatedly — never "it takes over by itself" when it has not. */
export const WAKE_GAVE_UP_NOTE = 'The live preview could not start — showing your saved copy.';

/**
 * The saved-copy note to show, given how many wakes have failed in a row. PURE.
 *
 * The server's stand-in note promises "the live version takes over by itself the moment it is ready".
 * That is true while a machine is starting; after repeated failed wakes it is a promise nobody is
 * keeping, so it is replaced with the plain fact.
 */
export function snapshotNoteAfterWakeFailures(note: string, failures: number): string {
  if (!note) return note;
  return failures >= WAKE_FAILURES_BEFORE_PLAIN_NOTE ? WAKE_GAVE_UP_NOTE : note;
}

/** The sleep/rest banner's wording for a health status, or null when no banner should show. PURE. */
export function wakeBannerCopy(health: string | null, failures: number): { title: string; body: string } | null {
  if (failures >= WAKE_FAILURES_BEFORE_PLAIN_NOTE && (health === 'sleeping' || health === 'crashed' || health === 'idle_snapshot')) {
    return {
      title: WAKE_GAVE_UP_NOTE,
      body: 'The reason is shown above. Your app and its files are safe — you can try waking it again.',
    };
  }
  if (health === 'sleeping') {
    return {
      title: 'Preview is in sleep mode.',
      body: 'It pauses after a while of no activity so it is not billed while nobody is looking. Your app and its files are safe — waking it up brings back exactly what you had.',
    };
  }
  if (health === 'crashed') {
    return {
      title: 'Your preview stopped.',
      body: 'The app stopped running. Your files are safe — waking it up usually brings it straight back.',
    };
  }
  if (health === 'idle_snapshot') {
    return {
      title: 'Showing your saved copy.',
      body: 'The live server is resting so it is not billed while you look at your finished app. Wake it up to see the live version.',
    };
  }
  return null;
}
