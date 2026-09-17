// AgentV3 — WHO WROTE THIS FILE? The readiness gate's missing question.
//
// 🔴 ROOT CAUSE (autopsy, build e4ebcb5f, 2026-09-17). A user with a 516-file GitHub project typed
// "Fix this error and continue building the app: network error". The engine read six files, ran a
// clean `tsc --noEmit`, started the dev server, published a preview, screenshotted it, and wrote
// ZERO files — its own last line was "♻️ Incremental: 518/518 file(s) unchanged (0 changed, 0 new)".
// The production build succeeded, the live preview was opened in a real browser and rendered, and
// RENDER_RESCUE upgraded the verdict to success "so health, billing and the verdict are honest".
//
// Twenty-seven seconds later the release gate went RED on "1 build-breaking blocker(s)", the verdict
// was flipped back to NOT ok, and the user was told their app "is NOT ready to use yet" and charged
// ₹0 under "working app or free".
//
// The blocker was `3 fake/incomplete code issue(s) (placeholder / not-implemented / fake data)` —
// found by scanning the user's OWN pre-existing repository. The build never touched those files.
// It could not have: it wrote nothing at all.
//
// 🔑 THE CLASS, and it is a generalisation nobody made rather than a bug anybody introduced.
// `importTurnObservation` already states the rule verbatim, for the import case:
//
//     "A build's unresolved/rootCause must describe what OUR engine failed to do, not tidiness
//      hints about code we were asked only to read."
//
// That guard keys on `isImportTurn` — a boolean about the TURN. But `isImportTurn` was only ever a
// proxy for the real predicate, which is per FILE: *did this build write this file?* An import turn
// is simply the case where the answer is "no" for every file in the project. An edit of an existing
// app is the case where it is "no" for most of them — and that case was never considered, because
// the readiness gate was written for fresh builds, where the answer is "yes" for everything and the
// distinction cannot be observed.
//
// So the gate is unchanged where it was designed to work (a fresh build still blocks on every
// placeholder it generates) and stops condemning builds for code they never wrote.
//
// 🔒 THE SAFE DIRECTION IS "OURS", ALWAYS. An UNSET authored set means today's behaviour exactly —
// every finding counts — because a caller that has not told us what it wrote must never silently
// disarm a correctness gate. Same reason a path that does not match is treated as ours-unless-proven:
// the failure mode of over-blocking is a caveat, and of under-blocking is shipping fake code as done.
//
// ⚠️ SCAFFOLD FILES ARE NOT IN THE AUTHORED SET, and that is stated rather than hidden: the
// actuator seeds `index.html`/`vite.config.ts`/`package.json` from NavBharatAI's own template
// without going through a write tool. A placeholder in one of those would be our TEMPLATE's defect,
// not this build's, so reading them as pre-existing is the honest answer there too.
//
// Pure + dependency-free. Never throws.

/**
 * One spelling for a path, so the set the build wrote and the paths the scanner reports can be
 * compared at all. Strips a leading `./` or `/`, normalises Windows separators, and collapses
 * repeated slashes. Case is PRESERVED — the sandbox is Linux, and folding case here would make
 * `src/app.tsx` match `src/App.tsx` and quietly clear a real finding.
 */
export function normalizeAuthoredPath(path: string | null | undefined): string {
  if (typeof path !== 'string') return '';
  return path
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .trim();
}

/** Build the comparable set once, from whatever iterable of paths the caller holds. */
export function authoredPathSet(paths: Iterable<string> | null | undefined): Set<string> {
  const set = new Set<string>();
  if (!paths) return set;
  try {
    for (const p of paths) {
      const n = normalizeAuthoredPath(p);
      if (n) set.add(n);
    }
  } catch {
    /* a hostile iterable must never break a gate */
  }
  return set;
}

/**
 * Split per-file findings into the ones THIS BUILD is answerable for and the ones that describe the
 * user's pre-existing code.
 *
 * `authored === undefined` means "the caller did not say", and every finding is returned as ours —
 * byte-identical to the behaviour before this module existed. An EMPTY set is a different statement:
 * the caller tracked writes and there were none (the zombie case above), so every finding is
 * pre-existing.
 */
export function splitByAuthorship<T extends { file?: string | null }>(
  findings: ReadonlyArray<T> | null | undefined,
  authored: ReadonlySet<string> | undefined,
): { ours: T[]; preExisting: T[] } {
  const all = Array.isArray(findings) ? findings.filter(Boolean) : [];
  if (!authored) return { ours: [...all], preExisting: [] };
  const ours: T[] = [];
  const preExisting: T[] = [];
  for (const f of all) {
    const path = normalizeAuthoredPath(f?.file);
    // A finding with no file at all cannot be attributed, so it stays ours — see the safe-direction
    // note in this file's header.
    if (!path || authored.has(path)) ours.push(f);
    else preExisting.push(f);
  }
  return { ours, preExisting };
}

/**
 * The wording for a finding about code the build did not write. Mirrors `importTurnObservation`'s
 * phrasing on purpose — it is the same statement, reached through the per-file predicate instead of
 * the per-turn one, and a reader should recognise it as the same kind of claim.
 */
export function preExistingCodeObservation(label: string): string {
  return `[observation about your existing code — this build did not change these files] ${label}`;
}
