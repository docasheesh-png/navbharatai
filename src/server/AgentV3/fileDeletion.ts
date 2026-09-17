// AgentV3 — THE ENGINE HAD NO WAY TO LEARN THAT A FILE WAS DELETED.
//
// 🔴 ROOT CAUSE (autopsy, build 8b3dca5c, 2026-09-17 — a JEE mock-test app on the free Weak engine).
//
// The agent tidied up after itself. From the build's own command log:
//
//     t+788s   $ rm src/components/Counter.tsx   →  exit 0
//
// One hundred and twenty-one seconds later, the readiness gate:
//
//     t+909s   READINESS_BLOCKER — readiness score 38/100 is below the 50/100 bar
//              (9 component(s) created but never used: src/components/Counter.tsx (Counter), …)
//
// The first name in the list is the file the build had already deleted. The app itself was fine:
// five clean `tsc --noEmit` runs, the dev server up, the preview published and rendered in a real
// browser, `PROD_BUILD_OK`, accessibility 100/100. It was failed, and made free, over a file that
// was not there.
//
// 🔑 THE CLASS: nothing in AgentV3 deletes. Files are only ever added. `WorkspaceMemory` has carried
// a `removeFile(file)` method — with the doc comment "Drop a deleted file from the graph" — and it
// has never had a single caller. The project graph therefore describes the union of everything the
// build has ever touched, which is not the app, and every gate reading that graph judges a tree that
// does not exist. The same stale entry is persisted, restored into the next sandbox, and counted
// again: debris the engine removed is immortal.
//
// 🔒 THE SAFE DIRECTION HERE IS THE OPPOSITE OF `buildAuthorship`'s, deliberately.
// There, an unknown answer means "ours", because under-blocking would ship fake code as done. Here,
// an unknown answer means KEEP: a file wrongly dropped from the graph makes the analysers blind to
// it — an unresolved import into it would stop being seen — and a silently narrowed gate is worse
// than a stale entry. So a path leaves the graph only when THREE things hold:
//
//   1. the delete-governance parser already extracted it as a source-file target of this command
//      (`singleSourceDeleteTargets`), and the still-imported-file guard ALLOWED it;
//   2. the command exited 0;
//   3. the sandbox confirms, by a direct read, that the file is genuinely gone.
//
// (3) is what makes (2) safe: `rm x || true` exits 0 having deleted nothing, and `rm a && failing`
// exits non-zero having deleted `a`. Neither can mislead this — the first is refused by the probe,
// and the second simply keeps a stale entry, which is today's behaviour.
//
// PURE — no I/O, no clock. Never throws. The sandbox probe lives at the call site, where the
// actuator is.

/**
 * The paths a finished `bash` command may have removed from the project, given the targets the
 * governance parser extracted before it ran and the exit code it returned.
 *
 * Returns EMPTY for any non-zero or unknown exit code. A command that did not succeed has proven
 * nothing about what is on disk, and this is the first of the three conditions above.
 *
 * ⚠️ The caller passes the targets the DELETE GUARD allowed — never a fresh parse of the raw string.
 * Re-parsing here would silently include a target the guard refused (a file other modules still
 * import), and dropping THAT from the graph would hide the very breakage the guard exists to prevent.
 */
export function deletionCandidates(
  allowedTargets: readonly string[] | null | undefined,
  exitCode: number | null | undefined,
): string[] {
  if (exitCode !== 0) return [];
  const out: string[] = [];
  for (const raw of allowedTargets ?? []) {
    if (typeof raw !== 'string') continue;
    const p = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '').replace(/^\//, '').trim();
    // A bare `.`/`..`, an empty string or a directory-shaped target is never a single source file.
    if (!p || p === '.' || p === '..' || p.endsWith('/')) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * The one line the build report carries when the graph is brought back in line with the sandbox.
 * Names the files, because a silent reconciliation is indistinguishable from a broken one — the same
 * reasoning `createLaneWriteFence`'s `onRefused` is built on.
 */
export function deletionReconciledMessage(paths: readonly string[]): string {
  const shown = paths.slice(0, 5).join(', ');
  const more = paths.length - Math.min(paths.length, 5);
  return `${paths.length} file(s) deleted during this build were dropped from the project map, so the `
    + `quality gates judge the app as it actually is: ${shown}${more > 0 ? `, +${more} more` : ''}.`;
}
