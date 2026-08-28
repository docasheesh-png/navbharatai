// OFF-TOPIC SUMMARY — the build's last word must be about the app the user asked for.
//
// THE REAL FAILURE THIS CATCHES (admin build report 2026-08-28). The user asked for a "Hospital
// Emergency Management" app; stale workspace memory hijacked the weak builder into resurrecting the
// previous session's Dino Runner game; and the user's final summary read "Aapka **Dino Run** game
// taiyaar hai! 🎮" — a confident celebration of the WRONG APP, delivered as the answer to a medical
// app request. The upstream cause is fixed in ProjectContext.ts (memory is now subordinate to the
// current request), but upstream fixes are probabilistic where a model is involved — this is the
// deterministic net beneath them.
//
// DELIBERATELY NARROW, because a false alarm here would stamp doubt on good builds:
//   • It fires only when the CURRENT prompt names the app in quotes (“X” / "X" / ‘X’) — an explicit,
//     user-chosen name, not something inferred.
//   • Only when that name is distinctive (≥ 2 significant words).
//   • Only when the summary mentions NONE of those words. One mention anywhere = silence.
// A summary that never once utters the name the user themselves gave the app has, at minimum, earned
// a warning — and the warning states facts only: what was asked, what the summary says. PURE.

/** The quoted app name in a prompt, or null. The FIRST quoted run of 2+ words wins. */
export function quotedAppName(prompt: string): string | null {
  const p = String(prompt ?? '');
  const m = p.match(/[“"'‘]([^”"'’]{3,80})[”"'’]/g);
  if (!m) return null;
  for (const raw of m) {
    const inner = raw.slice(1, -1).trim();
    if (significantWords(inner).length >= 2) return inner;
  }
  return null;
}

/** Words worth matching on: 4+ characters, lowercased, articles and glue dropped by the length bar. */
export function significantWords(name: string): string[] {
  return String(name ?? '')
    .toLowerCase()
    .split(/[^a-z0-9ऀ-ॿ]+/i)
    .filter((w) => w.length >= 4);
}

/**
 * The honest notice to prepend when the summary is about some other app — or null when all is well.
 *
 * Null on: no quoted name, a short/indistinct name, an empty summary, or ANY overlap between the
 * name's words and the summary. The notice never guesses what went wrong — it states the mismatch and
 * tells the user to check the preview, which is the one thing that cannot lie to them. PURE.
 */
export function offTopicSummaryNotice(prompt: string, summary: string): string | null {
  const name = quotedAppName(prompt);
  if (!name) return null;
  const words = significantWords(name);
  if (words.length < 2) return null;
  const s = String(summary ?? '').toLowerCase();
  if (!s.trim()) return null;
  if (words.some((w) => s.includes(w))) return null;
  return (
    `⚠️ **Check this before trusting the message below.** You asked for “${name}”, but the summary ` +
    'underneath never mentions it — it may be describing a different app than the one you requested. ' +
    'Open the preview and look at what is actually there; if it is not your app, say so and it will be rebuilt.'
  );
}
