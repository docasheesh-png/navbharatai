// WHEN DOES `npm install` NEED `--legacy-peer-deps`? — and the framework that could never install
// because the answer was too narrow.
//
// 🔒 ROOT CAUSE (found by really building all 24 framework scaffolds, 2026-08-24). The E2B installer
// already had the right idea: try `npm ci`, then `npm install`, then retry with `--legacy-peer-deps`
// when the failure is a peer-dependency conflict. The retry was gated on the log matching
// `/ERESOLVE|peer dep(endenc)?/i`.
//
// **Nuxt fails with neither of those words.** Its real output is:
//
//     npm error Cannot read properties of null (reading 'edgesOut')
//
// That is npm's dependency resolver (arborist) CRASHING while walking the peer graph — the same class
// of failure as ERESOLVE, reported as an internal TypeError instead of a diagnosis. So the retry never
// fired, and `nuxt` — one of the 24 frameworks offered in the picker — could not install AT ALL. Not
// "sometimes flaky": every single Nuxt app, every time. Verified both ways in this repo's sandbox:
// plain `npm install` crashes, and `npm install --legacy-peer-deps` finishes in 20 seconds.
//
// 🔑 THE LESSON, WHICH IS THE FIFTH INSTANCE OF ONE PATTERN THIS MONTH: the capability existed and its
// TRIGGER did not match reality. `serverListenPort`, `isAgentV3FreeUser`, `detectBackendPresence`,
// `startNewChat`, and now this. When a fallback is written against the error text of the one failure
// that prompted it, the next dialect of the same failure walks straight past it.
//
// So the matcher is a named, tested function rather than a regex inline in a 600-line method — the
// next dialect gets added here, with a test, instead of being discovered by another user.

/**
 * Known npm resolver-crash signatures. These are npm bugs surfacing as TypeErrors while it walks the
 * peer-dependency graph, and `--legacy-peer-deps` (which skips that walk) is the documented way past
 * every one of them.
 */
const RESOLVER_CRASH = [
  'edgesout',            // Cannot read properties of null (reading 'edgesOut') — the Nuxt case
  'edgesin',             // its sibling, same walk, other direction
  'cannot read properties of null (reading \'name\')',
  'maximum call stack size exceeded',   // a cycle in the peer graph
];

/**
 * Should this failed install be retried with `--legacy-peer-deps`?
 *
 * 🔒 IT ANSWERS ONLY FOR PEER-RESOLUTION FAILURES, and that restraint matters: `--legacy-peer-deps`
 * makes npm stop enforcing peer ranges, which is exactly right for a conflict it cannot solve and
 * exactly WRONG as a blanket retry. A 404 on a misspelled package, an EINTEGRITY, a network drop or a
 * disk-full will fail identically the second time — retrying them costs the user a minute of build
 * time and then reports the same error, having taught them nothing. Those keep falling through to the
 * honest failure they already produce.
 *
 * PURE.
 */
export function needsLegacyPeerDeps(installLog: string): boolean {
  const log = String(installLog ?? '').toLowerCase();
  if (!log) return false;
  // npm's own diagnosis, when it manages to make one.
  if (/eresolve|peer dep(endenc)?/.test(log)) return true;
  // …and when it crashes instead of diagnosing.
  return RESOLVER_CRASH.some((sig) => log.includes(sig));
}
