// AgentV3 — IS THE SAVED COPY THE APP AS IT STANDS RIGHT NOW? Answered by CONTENT, not by clocks.
//
// THE BUG THIS REPLACES (found 2026-09-11 while making the copy the default pane). The copy of a
// green build is saved MID-WAY through the post-build sequence, and the build's FINAL durable save —
// the one that persists every file, unchanged or not — runs AFTER it. That save rewrites the
// workspace's `savedAt` stamp. So for every build that ever produced a copy, the last durable write
// was newer than the copy, and every rule of the form "current = no write since the copy"
// (`snapshotStillCurrent`) answered FALSE for the very app the copy was made from. Two features were
// dead on arrival without failing: the door's "show the copy while the machine starts" (2026-09-08)
// and the health probe's matching note. Meanwhile the idle-serve path checked NOTHING, and framed a
// copy that a later edit in the Files tab had already outdated. Opposite failures, one missing fact.
//
// THE FACT: a copy is current when the SOURCE it was built from is byte-identical to the source in
// the workspace now. A timestamp is a proxy for that; a hash of the sorted file map is the thing
// itself. So the build records the hash at the moment the copy is taken, and at the final save
// compares it with what was actually persisted. Equal ⇒ the copy is the app, and the durable stamp is
// moved to AFTER that save — which is simply true, and is what lets every existing clock-based rule
// keep working unchanged. Different ⇒ a later pass changed a file, and the copy is honestly stale.
//
// PURE — no I/O, no clock.

import crypto from 'crypto';

/**
 * One deterministic hash for a path→content map.
 *
 * SORTED, because the two sides of the comparison are built by different readers (a sandbox scan
 * mid-build, the durable store on a cold reopen, a union of the two) whose insertion orders differ.
 * Length-prefixed, so a path containing a space or a newline can never be confused with content.
 */
export function workspaceContentHash(files: Record<string, string> | null | undefined): string {
  const h = crypto.createHash('sha256');
  const paths = Object.keys(files ?? {}).sort();
  for (const p of paths) {
    const c = String((files as Record<string, string>)[p] ?? '');
    h.update(`${p.length}:${p}${c.length}:${c}`);
  }
  return h.digest('hex').slice(0, 32);
}

/** What the build remembered when it took the copy. `filesHash` is null if the source could not be read. */
export interface SnapshotTaken {
  url: string;
  filesHash: string | null;
}

export type SnapshotConfirmation =
  | { action: 'restamp'; reason: string }
  | { action: 'stale'; reason: string }
  | { action: 'none'; reason: string };

/**
 * After the final durable save: may the copy be declared current?
 *
 * Every branch that is not a proven match answers NOT current. An unreadable source at copy time is
 * not proof ("we did not check" must never round up to "it matches"), and neither is a missing copy.
 */
export function snapshotConfirmation(i: { taken: SnapshotTaken | null | undefined; persistedHash: string }): SnapshotConfirmation {
  if (!i?.taken || typeof i.taken.url !== 'string' || !/^https?:\/\//i.test(i.taken.url)) {
    return { action: 'none', reason: 'No copy was taken this build.' };
  }
  if (!i.taken.filesHash) {
    return { action: 'stale', reason: 'A copy was taken, but its source could not be read at the time, so it cannot be proven to match the app that was saved. It stays a fallback for an expired machine only.' };
  }
  if (i.taken.filesHash !== i.persistedHash) {
    return { action: 'stale', reason: 'A later pass changed a file after the copy was taken, so the copy is not this app. It stays a fallback for an expired machine only; the next build takes a fresh one.' };
  }
  return { action: 'restamp', reason: 'The saved copy was built from exactly the files that were persisted — it is this app, and the preview can show it in place of a running machine.' };
}

/**
 * Does a copy's recorded source hash match the source in hand?
 *
 * `undefined` when the record carries no hash (a copy from before hashes were recorded) — the caller
 * then falls back to the clock rule rather than treating the absence as either answer.
 */
export function snapshotMatchesFiles(recordHash: string | null | undefined, currentHash: string | null | undefined): boolean | undefined {
  if (typeof recordHash !== 'string' || !recordHash) return undefined;
  if (typeof currentHash !== 'string' || !currentHash) return undefined;
  return recordHash === currentHash;
}
