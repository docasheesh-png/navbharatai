// AgentV3 — THE PROJECT MAP MUST MATCH THE DISK, HOWEVER A FILE LEFT IT.
//
// 🔴 ROOT CAUSE (autopsy, build c6e4c6ff, 2026-09-17 — "E commerce website" on the free Weak engine).
//
// The agent found a stray file it had orphaned, checked it, and removed it. From the build's own log:
//
//     t+1250s  $ rm src/routes/orders.ts              →  exit 0
//     t+1256s  $ ./node_modules/.bin/tsc --noEmit      →  exit 0        ← clean, the file is gone
//     t+1283s  $ npm run build                         →  exit 0        ← PROD_BUILD_OK
//     t+1430s  preview published, opened in a real browser, RENDERED
//
//     t+1474s  READINESS_BLOCKER — 2 unresolved import(s) — the build will fail:
//              src/routes/orders.ts -> ../db, src/routes/orders.ts -> ../middleware/authenticate
//
// Both imports belong to the file that was deleted 224 seconds earlier. The release gate went RED on
// them, `OUTCOME_RELEASE_GATE_RED` flipped a rendering app's verdict to NOT ok, the user was told
// "2 things are still broken", and the build was made FREE — a working ShopWave that cost $0.93 to
// produce, billed at ₹0, over a file that was not there.
//
// 🔑 THE CLASS — and why closing it needed a different fix from the one that already exists.
// `analyzeArchitecture` judges `WorkspaceMemory.graph()`, never the sandbox. PR #3014 (autopsy
// 8b3dca5c) taught the graph about deletion, but only along ONE road: a `bash` command that
// `singleSourceDeleteTargets` recognises as a single-file delete. Measured against the real parser,
// every other way a file leaves the sandbox still leaves a zombie behind:
//
//     rm src/routes/orders.ts          → ['src/routes/orders.ts']   ✅ covered by #3014
//     rm -rf src/routes                → []                          ← a directory delete
//     mv src/a.ts src/b.ts             → []                          ← a RENAME, and routine
//     npm run clean                    → []
//     git clean -fd  /  git checkout . → []
//     cd src && rm routes/orders.ts    → ['routes/orders.ts']        ← relative to the `cd`, matches no graph key
//
// So the instance was fixed and the class was not — the precise shape the fifth absolute rule's bar
// forbids. The fix therefore belongs where the question is answerable for EVERY road at once:
// `seedGraphFromWorkspace` already lists the real tree and already holds the graph, immediately
// before the gate judges. The set difference between them IS the zombie set, and it was computed
// nowhere. This module computes it.
//
// 🔒 THE SAFE DIRECTION IS `fileDeletion.ts`'s, deliberately unchanged: an unknown answer means KEEP.
// A path wrongly dropped makes the analysers blind to it — an unresolved import INTO it would stop
// being seen — and a silently narrowed gate is worse than a stale entry. So this proposes, and never
// disposes: the caller confirms every candidate with a direct sandbox read before the graph forgets
// it. Three guards decide what is even proposed:
//
//   1. A LISTING THAT FAILED IS NOT AN EMPTY WORKSPACE. The caller passes `null` for a throw, and an
//      empty list is refused outright. `seedGraphFromWorkspace` wraps its listing in
//      `.catch(() => [])`, which makes those two indistinguishable — and pruning on that answer would
//      wipe the entire graph of a project whose sandbox merely hiccuped. E2BActuator.listFiles draws
//      the same distinction internally, for the same reason.
//   2. ONLY WHAT THIS SEEDER WOULD HAVE INDEXED. A graph entry the tree filter would never have
//      listed (a `.md`, something under `dist/`) is outside what the listing can speak about, so its
//      absence from the tree is not evidence of anything.
//   3. A DISAGREEMENT LARGER THAN `MAX_PRUNE_PROBES` IS A BROKEN LISTING, NOT A DELETED APP. Past the
//      cap this returns NOTHING rather than a truncated prefix: at that size the likeliest cause by
//      far is a partial `find`, and keeping stale entries is today's behaviour while dropping 200
//      real files is a new and much worse failure. The refusal is reported, never silent.
//
// PURE — no I/O, no clock, never throws. The sandbox probe lives at the call site, where the actuator
// is, exactly as `fileDeletion.ts` arranged it.

/**
 * The most graph-vs-disk disagreements that can plausibly be real deletions in one build. Past this
 * the listing itself is the likelier suspect, and guard (3) refuses the whole batch.
 */
export const MAX_PRUNE_PROBES = 25;

/** Workspace-relative, forward-slashed, no leading `./` or `/`. Matches the seeder's own key shape. */
function normalizePath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '').replace(/^\//, '').trim();
}

/**
 * ONE pass, so the two public answers below can never disagree about what counts as a candidate.
 * Returns the candidates AND whether guard (3) refused the batch — both are needed, and computing
 * them twice is precisely how a filter drifts away from its own report line.
 */
function scan(
  graphFiles: readonly string[] | null | undefined,
  treeFiles: readonly string[] | null | undefined,
  indexable: (path: string) => boolean,
): { candidates: string[]; refused: boolean } {
  const none = { candidates: [] as string[], refused: false };
  // Guard (1) — a failed or empty listing has proven nothing about what is on disk.
  if (!treeFiles || treeFiles.length === 0) return none;
  const onDisk = new Set<string>();
  for (const raw of treeFiles) {
    if (typeof raw !== 'string') continue;
    // NORMALIZE BEFORE THE EMPTINESS TEST, not after. A listing of `['', '  ']` is degenerate, but
    // a whitespace entry is truthy — adding it first left a set of size 1 holding the empty string,
    // which passed the guard below and then proposed the ENTIRE graph for deletion. Caught by this
    // module's own test; the safe direction is that a listing with nothing usable in it is empty.
    const p = normalizePath(raw);
    if (p) onDisk.add(p);
  }
  if (onDisk.size === 0) return none;

  const candidates: string[] = [];
  for (const raw of graphFiles ?? []) {
    if (typeof raw !== 'string') continue;
    const p = normalizePath(raw);
    if (!p || p === '.' || p === '..' || p.endsWith('/')) continue;
    if (onDisk.has(p)) continue;
    // Guard (2) — the listing can only speak about paths it would have listed. A filter that THROWS
    // is an unknown answer, and an unknown answer means KEEP.
    let listable = false;
    try { listable = indexable(p); } catch { listable = false; }
    if (!listable) continue;
    if (candidates.includes(p)) continue;
    candidates.push(p);
    // Guard (3) — one past the cap is enough to refuse the whole batch.
    if (candidates.length > MAX_PRUNE_PROBES) return { candidates: [], refused: true };
  }
  return { candidates, refused: false };
}

/**
 * The graph paths the real workspace tree no longer contains — the CANDIDATES for removal, never the
 * decision. The caller must confirm each one with a direct sandbox read before dropping it.
 *
 * @param graphFiles  every path currently in the project map (`WorkspaceMemory.graph().files`).
 * @param treeFiles   the real listing, or `null` when the listing THREW. Null and empty both yield [].
 * @param indexable   the seeder's own filter — true for a path it would have listed and indexed.
 */
export function prunableGraphPaths(
  graphFiles: readonly string[] | null | undefined,
  treeFiles: readonly string[] | null | undefined,
  indexable: (path: string) => boolean,
): string[] {
  return scan(graphFiles, treeFiles, indexable).candidates;
}

/**
 * True when the disagreement was large enough for guard (3) to refuse it, so the caller can say so
 * instead of reporting a silent no-op. Both outcomes are an empty candidate list and only one of them
 * is worth a line in the report — the same reasoning `deletionReconciledMessage` is built on.
 */
export function pruneWasRefused(
  graphFiles: readonly string[] | null | undefined,
  treeFiles: readonly string[] | null | undefined,
  indexable: (path: string) => boolean,
): boolean {
  return scan(graphFiles, treeFiles, indexable).refused;
}

/** The one line the build report carries when guard (3) refuses a batch. Named, never silent. */
export function pruneRefusedMessage(): string {
  return `More than ${MAX_PRUNE_PROBES} files in the project map were missing from the workspace listing — `
    + `that is far likelier to be an incomplete listing than a deleted app, so the map was left alone.`;
}
