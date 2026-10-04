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
import { withoutPreviewBridge } from './previewBridge';

/**
 * One deterministic hash for a path→content map.
 *
 * SORTED, because the two sides of the comparison are built by different readers (a sandbox scan
 * mid-build, the durable store on a cold reopen, a union of the two) whose insertion orders differ.
 * Length-prefixed, so a path containing a space or a newline can never be confused with content.
 */
/**
 * THE SOURCE AN IDENTITY IS TAKEN OVER — the app's files with OUR preview bridge removed.
 *
 * 🔴 WHY (autopsy Study-Racer, 2026-09-25): the copy's hash is read from the SANDBOX tree right after
 * `npm run build`, the confirmation's from the DURABLE set that was persisted. Between the two sits a
 * fact that has nothing to do with the app: every dev-server start injects our console mirror into the
 * sandbox's `index.html` (E2BActuator), and the durable copy never carries it. So on a build whose
 * model wrote `index.html`, the two `index.html`s differed by 18 KB of NavBharatAI code — and the
 * copy was declared STALE ("both sides hold the same 19 file(s), so a file's CONTENT changed") on a
 * build whose own `POST_GREEN_WRITES` line said nothing wrote after the render. The user then paid
 * for a live machine on every preview because the free copy was distrusted. `withoutPreviewBridge`
 * already exists for exactly this ("apply it wherever sandbox content enters the analysis corpus");
 * the identity hash was the reader that had not applied it. Idempotent on a clean tree. PURE.
 */
export function identitySource(files: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!files) return out;
  for (const [path, content] of Object.entries(files)) {
    if (isSecretEnvFile(path)) continue;
    out[path] = typeof content === 'string' ? withoutPreviewBridge(path, content) : content;
  }
  return out;
}

/**
 * 🔴 A SECRETS FILE IS NEVER PART OF THE APP'S COPY (autopsy cc3ef776, 2026-10-04). The copy's source is
 * read by a scan that leaves `.env` out, while the saved side carries it whenever a key from Keys &
 * Secrets was loaded into the app — so every app with a key had its free preview copy called STALE
 * ("1 saved that the copy never held (.env)") and the user was sent to the paid live machine. A secrets
 * file is not built, not shipped and not shown, so it is left out of the identity on BOTH sides.
 * `.env.example` holds names, not secrets, and stays. PURE.
 */
export function isSecretEnvFile(path: string): boolean {
  const base = String(path ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  return /^\.env(?:\..+)?$/i.test(base) && !/^\.env\.(?:example|sample|template)$/i.test(base);
}

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
  /**
   * The PATHS the hash was computed over, kept only for this build's confirmation.
   *
   * 🔴 WHY (autopsy f97eb0ec, 2026-09-20): a mismatch was reported as "a later pass changed a file"
   * and could not say WHICH — so the one number that would settle the commonest suspicion was
   * missing. The two hashes are taken from different places: the copy's from the SANDBOX tree the
   * production build just consumed, the confirmation's from the DURABLE set that was persisted. If
   * those two sets differ by a single path, the hashes can never match and the copy is stale on
   * every build — which looks identical, in the report, to a real late write.
   *
   * ⚠️ NOT PERSISTED and not part of the identity — the HASH is still what decides. This only lets
   * the sentence name the difference, so the next report distinguishes a set mismatch (ours) from a
   * genuine content change (the app's).
   */
  filePaths?: string[];
  /**
   * One short hash PER FILE at copy time (over `identitySource`, so the bridge never counts).
   *
   * 🔴 WHY (autopsy 2d076ce8, 2026-09-30): the paths above told a set mismatch from a content change,
   * and then stopped. That build's line read *"Both sides hold the same 21 file(s), so a file's CONTENT
   * changed"* — and nothing on the timeline wrote after the copy (the only later actor was a
   * suggest-only reviewer that read five files). With the whole-tree hash alone the report could not
   * say WHICH file differed, nor whether the SANDBOX had moved or the SAVED set simply held something
   * the sandbox never ran. Those are different bugs: the first is a late write, the second means the
   * durable app is not the app that was verified. Per-file hashes answer both on the next report.
   * NOT PERSISTED — the whole-tree `filesHash` is still what decides.
   */
  fileHashes?: Record<string, string>;
}

/**
 * A short content hash for every file, over the SAME source an identity is taken over. PURE.
 * 16 hex chars is diagnostic, not cryptographic: it names which file differs, the tree hash decides.
 */
export function fileContentHashes(files: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(identitySource(files))) {
    out[path] = crypto.createHash('sha256').update(String(content ?? '')).digest('hex').slice(0, 16);
  }
  return out;
}

/**
 * Files the build SAVED with content the sandbox does not hold. PURE.
 *
 * The durable save starts from a sandbox scan and then lets the build's captured writes win. A path
 * where the two disagree is a write that was RECORDED one way and is running another way — so the
 * project a restore brings back is not the project the browser checks proved. Only paths present on
 * both sides are compared: a path the scan could not read is "not measured", never a divergence.
 */
export function savedDivergesFromSandbox(
  sandbox: Record<string, string> | null | undefined,
  saved: Record<string, string> | null | undefined,
): string[] {
  if (!sandbox || !saved) return [];
  return Object.keys(saved).filter((p) => p in sandbox && sandbox[p] !== saved[p]).sort();
}

/**
 * HOW a saved file differs from the sandbox copy, in one bounded line: both sizes, the first line where they
 * part, and both versions of that line. PURE.
 *
 * 🔴 WHY (autopsy 0473628e). `SAVED_SOURCE_DIVERGES` named `public/icon.svg` and nothing else. The only
 * writer of that file in this repo writes the same string to the sandbox and to the record, so the cause
 * could not be read from the code, and the report held nothing that could tell it. An instrument that says
 * "these differ" without saying how sends the next autopsy to guess.
 */
export function describeDivergence(path: string, sandbox: string, saved: string): string {
  const a = String(sandbox ?? '');
  const b = String(saved ?? '');
  const la = a.split('\n');
  const lb = b.split('\n');
  let i = 0;
  while (i < la.length && i < lb.length && la[i] === lb[i]) i++;
  const clip = (t: string | undefined) => (t === undefined ? '(no line)' : JSON.stringify(t.length > 100 ? `${t.slice(0, 100)}…` : t));
  return `${path}: sandbox ${Buffer.byteLength(a, 'utf8')} B / ${la.length} line(s), saved ${Buffer.byteLength(b, 'utf8')} B / ${lb.length} line(s); `
    + `first difference at line ${i + 1} — sandbox ${clip(la[i])}, saved ${clip(lb[i])}`;
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
/**
 * Name the difference between the two file sets, when both are known.
 *
 * The point is DIAGNOSIS, not blame: "the same 11 files, so a file's content changed" and "the copy
 * was taken over 2 path(s) that were not saved" are different bugs with different owners, and the
 * old sentence asserted the first while the second was never ruled out.
 */
function staleDetail(
  takenPaths: string[] | undefined,
  persistedPaths: string[] | undefined,
  hashes: { taken?: Record<string, string>; persisted?: Record<string, string>; sandbox?: Record<string, string> } = {},
): string {
  if (!takenPaths || !persistedPaths) return '';
  const taken = new Set(takenPaths);
  const saved = new Set(persistedPaths);
  const onlyInCopy = takenPaths.filter((p) => !saved.has(p));
  const onlyInSave = persistedPaths.filter((p) => !taken.has(p));
  if (onlyInCopy.length === 0 && onlyInSave.length === 0) {
    return ` Both sides hold the same ${taken.size} file(s), so a file's CONTENT changed between them.${contentDetail(hashes)}`;
  }
  const bits: string[] = [];
  // Named, bounded — a report line is read by a person, and forty paths is not a sentence.
  if (onlyInCopy.length) bits.push(`${onlyInCopy.length} in the copy that were not saved (${onlyInCopy.slice(0, 5).join(', ')})`);
  if (onlyInSave.length) bits.push(`${onlyInSave.length} saved that the copy never held (${onlyInSave.slice(0, 5).join(', ')})`);
  return ` The two sides cover DIFFERENT files — ${bits.join('; ')} — so this is a file-set mismatch, not necessarily a late write.`;
}

/**
 * WHICH files changed, and WHERE the change happened. Empty when the per-file hashes are not all known.
 *
 * `sandbox` is the final scan BEFORE the build's captured writes were laid over it. So for a path
 * whose saved content differs from the copy: sandbox ≠ copy ⇒ the SANDBOX moved after the copy (a
 * late write); sandbox = copy ⇒ the sandbox never moved, and the SAVED content is what differs (a
 * captured write that is not what the sandbox ran).
 */
function contentDetail(h: { taken?: Record<string, string>; persisted?: Record<string, string>; sandbox?: Record<string, string> }): string {
  if (!h.taken || !h.persisted) return '';
  const changed = Object.keys(h.persisted).filter((p) => p in h.taken! && h.taken![p] !== h.persisted![p]).sort();
  if (changed.length === 0) return '';
  const named = `${changed.slice(0, 6).join(', ')}${changed.length > 6 ? ` and ${changed.length - 6} more` : ''}`;
  if (!h.sandbox) return ` Changed: ${named}.`;
  const moved = changed.filter((p) => h.sandbox![p] !== h.taken![p]);
  const divergent = changed.filter((p) => h.sandbox![p] === h.taken![p]);
  const bits: string[] = [];
  if (moved.length) bits.push(`${moved.length} changed in the sandbox AFTER the copy was taken (${moved.slice(0, 6).join(', ')})`);
  if (divergent.length) bits.push(`${divergent.length} were SAVED with content the sandbox never ran (${divergent.slice(0, 6).join(', ')}) — the saved project is not the one the copy was built from`);
  return ` Changed: ${named} — ${bits.join('; ')}.`;
}

export function snapshotConfirmation(i: {
  taken: SnapshotTaken | null | undefined;
  persistedHash: string;
  persistedPaths?: string[];
  /** Per-file hashes of what was persisted (`fileContentHashes`). */
  persistedFileHashes?: Record<string, string>;
  /** Per-file hashes of the final sandbox scan, BEFORE captured writes were laid over it. */
  sandboxFileHashes?: Record<string, string>;
}): SnapshotConfirmation {
  if (!i?.taken || typeof i.taken.url !== 'string' || !/^https?:\/\//i.test(i.taken.url)) {
    return { action: 'none', reason: 'No copy was taken this build.' };
  }
  if (!i.taken.filesHash) {
    return { action: 'stale', reason: 'A copy was taken, but its source could not be read at the time, so it cannot be proven to match the app that was saved. It stays a fallback for an expired machine only.' };
  }
  if (i.taken.filesHash !== i.persistedHash) {
    return { action: 'stale', reason: `The copy does not match what was saved, so it is not this app. It stays a fallback for an expired machine only; the next build takes a fresh one.${staleDetail(i.taken.filePaths, i.persistedPaths, { taken: i.taken.fileHashes, persisted: i.persistedFileHashes, sandbox: i.sandboxFileHashes })}` };
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
