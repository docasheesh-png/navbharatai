// AgentV3 — is the thing we are about to publish actually the user's app?
//
// ⚠️ THE PUBLISH THIS EXISTS FOR (admin 2026-08-25). A publish reported success, returned a live link,
// and the link opened the SANDBOX SCAFFOLD: "Welcome to Navbharat AI Sandbox — Edit index.html to see
// changes or ask AI to build something!". Five files, no JavaScript bundle, and a green result.
//
// Every gate on that path had passed, and each was individually correct:
//   • `npm run build` exited 0                 — it did; it built the placeholder
//   • an output directory existed              — it did
//   • `files.size === 0` was false             — five files is not zero
//
// Which is the pattern this repo has now found ten times in a week: "the dist is not empty" standing
// in for "the app was built". Emptiness was the only thing anyone checked, and a placeholder is not
// empty.
//
// DELIBERATELY NARROW — one signal, and it cannot be wrong. A page that still carries the scaffold's
// own "ask AI to build something" sentence is BY DEFINITION not the user's app: that sentence exists
// only to tell someone their workspace is still blank. It is our string, in our template, and no real
// app contains it.
//
// WHAT THIS MUST NOT DO is guess. "No JS bundle" would be a tempting second signal and it is WRONG —
// a plain HTML/CSS site is a first-class thing this platform builds on purpose, and refusing to
// publish one would break a working feature to catch a rarer bug. Same for file counts, page length,
// or "looks too simple". A publish is a user's own work; the bar for refusing one is proof, not
// suspicion.
//
// PURE — no I/O.

/**
 * The scaffold's own placeholder copy. Matched loosely on the distinctive half so that wrapping,
 * minification, or the badge/PWA injection the publish pipeline adds cannot make it slip past.
 */
const SCAFFOLD_MARKERS = [
  /ask\s+AI\s+to\s+build\s+something/i,
  /Welcome\s+to\s+Navbharat\s+AI\s+Sandbox/i,
];

/** Which entry files can carry the placeholder. */
const ENTRY = /(^|\/)index\.html$/i;

export interface PublishableVerdict {
  /** May this be published as the user's app? */
  ok: boolean;
  /** The honest sentence to show, when it may not. Empty when ok. */
  reason: string;
}

/**
 * Decide whether a collected dist is publishable.
 *
 * Takes the entry pages' TEXT rather than the whole map, so the caller decodes once and this stays
 * pure and cheap. An empty map is left to the caller's own emptiness check — two errors for one
 * condition would be worse than one.
 */
export function publishableVerdict(entryPages: string[]): PublishableVerdict {
  for (const page of entryPages) {
    const text = String(page ?? '');
    if (SCAFFOLD_MARKERS.some((re) => re.test(text))) {
      return {
        ok: false,
        // Says what we saw and what to do, in the user's terms. "Publish failed" alone is what made
        // the last version of this button feel dead.
        reason:
          'This would publish the empty starter page, not your app — the page still says "ask AI to '
          + 'build something", which is what a blank workspace shows. Your app has not been built into '
          + 'the folder that gets published. Ask the AI to build the app first, then publish again.',
      };
    }
  }
  return { ok: true, reason: '' };
}

/** The entry pages inside a collected dist, as text. Pure; skips anything undecodable. */
export function entryPagesOf(files: Map<string, Buffer>): string[] {
  const out: string[] = [];
  for (const [path, bytes] of files) {
    if (!ENTRY.test(path)) continue;
    try { out.push(bytes.toString('utf8')); } catch { /* unreadable bytes are not a placeholder */ }
  }
  return out;
}
