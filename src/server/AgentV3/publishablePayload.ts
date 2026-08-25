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

/**
 * Source files that are UNAMBIGUOUSLY a user interface, and that a build must therefore turn into
 * something shippable.
 *
 * Framework component extensions only, on purpose. A `.ts` file is not evidence — an Express app is
 * full of them and has no browser bundle to produce. `.tsx/.jsx/.vue/.svelte` exist for one reason,
 * and a plain HTML/CSS site (a first-class thing this platform builds) never contains one. That is
 * what keeps the second signal below from ever firing on a working app.
 */
const UI_SOURCE = /\.(tsx|jsx|vue|svelte)$/i;

/** What a build produces when it actually compiled that source: script or stylesheet assets. */
const BUILT_ASSET = /\.(js|mjs|cjs|css)$/i;

/**
 * Files the PLATFORM writes into every app, which are therefore not evidence that anything was built.
 *
 * ⚠️ MY OWN FIRST VERSION OF THIS GUARD MISSED THE VERY PUBLISH IT WAS WRITTEN FOR, and the test above
 * is what caught it. `appDefaults.ts` adds a manifest, a robots.txt, an icon and a service worker to
 * every app — and `sw.js` matches BUILT_ASSET. So the reported payload (index.html + those four)
 * looked like it contained a script, and the check stayed silent on the exact case it exists for.
 *
 * The lesson is the same one this whole week has been about: "a .js file is present" is an artifact,
 * and it was standing in for "the build emitted something". Ours do not count as theirs.
 */
const PLATFORM_INJECTED = /^(sw\.js|manifest\.webmanifest|robots\.txt|icon\.svg)$/i;

export interface PublishableVerdict {
  /** May this be published as the user's app? */
  ok: boolean;
  /** The honest sentence to show, when it may not. Empty when ok. */
  reason: string;
}

/** What the caller knows about the workspace, for the second signal. Both optional — absent means
 *  "not checked", and an unchecked thing never blocks a publish. */
export interface PublishContext {
  /** Every path in the dist we are about to upload. */
  distPaths?: string[];
  /** Every path in the workspace, so we can see whether it holds UI source at all. */
  sourcePaths?: string[];
}

/**
 * Decide whether a collected dist is publishable.
 *
 * Takes the entry pages' TEXT rather than the whole map, so the caller decodes once and this stays
 * pure and cheap. An empty map is left to the caller's own emptiness check — two errors for one
 * condition would be worse than one.
 */
export function publishableVerdict(entryPages: string[], ctx: PublishContext = {}): PublishableVerdict {
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

  /**
   * SECOND SIGNAL — A CONTRADICTION, NOT A SUSPICION (added 2026-08-25 when the admin asked for this
   * to be rock-solid rather than merely closed).
   *
   * The marker above catches the exact page that shipped. It would NOT catch the same failure with a
   * different placeholder, an edited one, or none at all — and the underlying fault is not the text,
   * it is that a build produced nothing from source that plainly needed compiling.
   *
   * So this compares two facts we already hold, and fires only when they cannot both be true: the
   * workspace contains COMPONENT files (.tsx/.jsx/.vue/.svelte — code whose only purpose is a user
   * interface), and the thing we are about to publish contains no script or stylesheet at all. There
   * is no reading of that pair in which the user's app is in the payload.
   *
   * Why it cannot fire on a working app:
   *   • a plain HTML/CSS site has no component files          → first condition fails
   *   • an Express/API project has .ts but no components       → first condition fails
   *   • any app that really built has assets in its output     → second condition fails
   *   • either list missing (the caller could not look)        → skipped entirely, never assumed
   *
   * That last one matters most: this must degrade to today's behaviour when we cannot see, because a
   * publish blocked by our own blindness is the failure mode this whole file exists to prevent.
   */
  const dist = ctx.distPaths;
  const source = ctx.sourcePaths;
  if (Array.isArray(dist) && Array.isArray(source) && dist.length > 0 && source.length > 0) {
    const hasUiSource = source.some((p) => UI_SOURCE.test(String(p ?? '')));
    const hasBuiltAsset = dist.some((p) => {
      const path = String(p ?? '');
      // Root-anchored: a bundler's own `assets/sw.js` is real output, while the platform's is not.
      if (PLATFORM_INJECTED.test(path)) return false;
      return BUILT_ASSET.test(path);
    });
    if (hasUiSource && !hasBuiltAsset) {
      return {
        ok: false,
        reason:
          'Your app\'s code was not included in what would be published. The project has interface '
          + 'files, but the build produced a page with no script or stylesheet — so the published site '
          + 'would be an empty shell. This usually means the build ran somewhere other than where your '
          + 'app lives. Ask the AI to build the app, then publish again.',
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
