// ONE PREVIEW PANE — which source it shows, decided by one rule (admin 2026-09-11, verbatim:
// "user ko live e2b nahi, bas e2b ka copy in browser preview me dikhna chahiye! … 2 preview wala
// system khatam karo").
//
// THE THREE THINGS THE PANE CAN SHOW, in the order the rule prefers them:
//   • 'snapshot'  — the REAL build output of the last green build (its `dist/`, the same files
//                   Publish ships), served from a permanent host. Faithful, free, and it needs no
//                   machine — which is what lets the sandbox sleep while the user looks at their app.
//   • 'inbrowser' — the instant render: our own bundler compiles the current files in the browser.
//                   Always available, free, a close approximation. It is also the only document the
//                   Visual Editor can edit, because our compiler is what stamps source positions.
//   • 'live'      — the dev server on a rented machine. Full fidelity, needed for an app whose server
//                   runs inside the sandbox, and PAID while it runs. Never chosen on the user's behalf.
//
// WHY THE TWO TABS HAD TO GO. The default tab was the instant render and the saved copy was framed
// only on the Live tab — so a user who never pressed "Live server" (the default, and the free one)
// never saw the real build at all, and one who did paid for a machine to look at a static copy. The
// copy is strictly better than the approximation whenever it exists and is current; the rule says so
// once, here, instead of the surface saying it in six places.
//
// PURE — no I/O, no React, no clock.

/** What the user asked for. `auto` is the default and means "the best free source available". */
export type PreviewChoice = 'auto' | 'live' | 'inbrowser';
export type PreviewSource = 'snapshot' | 'inbrowser' | 'live';

export interface PreviewSourceInput {
  choice: PreviewChoice;
  /** 'idle' | 'generating' | 'settling' — during a build the copy is by definition behind the files. */
  buildPhase: string | null | undefined;
  /** The saved copy the server has confirmed is CURRENT for this workspace, or nothing. */
  snapshotUrl: string | null | undefined;
}

export function choosePreviewSource(i: PreviewSourceInput): PreviewSource {
  if (i?.choice === 'live') return 'live';
  if (i?.choice === 'inbrowser') return 'inbrowser';
  // A build in flight: the instant render follows every written file (streaming first paint); the
  // copy, if any, is of the PREVIOUS build and must not be shown as the one being made.
  if (i?.buildPhase && i.buildPhase !== 'idle') return 'inbrowser';
  if (typeof i?.snapshotUrl === 'string' && /^https?:\/\//i.test(i.snapshotUrl)) return 'snapshot';
  return 'inbrowser';
}

/** The two frames the surface actually owns: the live iframe and the in-browser one. The copy rides the in-browser branch. */
export function modeForSource(source: PreviewSource): 'live' | 'inbrowser' {
  return source === 'live' ? 'live' : 'inbrowser';
}

/**
 * The toolbar label. Names what the user is looking at without a vendor, a machine, or jargon —
 * "in-browser" meant nothing to most users, and "snapshot" sounds like a screenshot.
 */
export function previewSourceLabel(source: PreviewSource, kind?: string): string {
  if (source === 'snapshot') return 'Your app · last build';
  if (source === 'live') return 'Live server';
  return kind ? `Instant preview (${kind})` : 'Instant preview';
}

export function previewSourceTitle(source: PreviewSource): string {
  if (source === 'snapshot') return 'The real build of your app, from the copy saved when it last built successfully. Free — no server is running for it. Send any change and it updates on the next build.';
  if (source === 'live') return 'Your app running on a real cloud machine (full fidelity — real npm/runtime). PAID: it uses your credits while it runs.';
  return 'Rendered instantly in your browser from your current files — free, no server, a close approximation of the real build.';
}

/**
 * Which toolbar tools have a document to act on.
 *
 * The copy is a static page on another origin with none of our bridge in it: nothing to mirror a
 * console from, nothing to pick, nothing to edit in place. Showing those buttons over it would be
 * controls that do nothing — the one thing this surface has been rebuilt three times to avoid.
 */
export function previewToolsFor(source: PreviewSource): { console: boolean; edit: boolean; pick: boolean } {
  if (source === 'snapshot') return { console: false, edit: false, pick: false };
  if (source === 'live') return { console: true, edit: false, pick: true };
  return { console: true, edit: true, pick: false };
}
