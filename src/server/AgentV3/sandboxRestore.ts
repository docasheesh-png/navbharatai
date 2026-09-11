// AgentV3 — bringing a DEAD workspace back to life on a brand-new sandbox.
//
// ── THE REPORT (admin 2026-09-11, verbatim) ─────────────────────────────────────────────────────
// *"woh already mare huye hi hai, wapas on nahi hote hai. kitne bhi retry/diagnosis karo, woh wapas
// live nahi ate hai, bas starting ke 24hr tak hi live rahte hai"* — and, when the diagnosis was put to
// them: *"resume nahi hota hai. mean abhi jo preview pause hai, yahi preview resume nahi ho sakta
// kabhi bhi nahi!!!"*
//
// They were right, and the reason is not the resume. It is what happens AFTER the resume fails.
//
// ── WHY A RESUME CAN FAIL, AND WHY THAT MUST BE SURVIVABLE ──────────────────────────────────────
// A paused sandbox is a snapshot held by E2B, and it can genuinely stop existing: the plan's retention
// window passes, the machine is reclaimed, or — for every app built before 2026-09-08 — E2B's DEFAULT
// `onTimeout: kill` deleted it outright at the one-hour mark (that default is now `pause`, see
// previewWake.ts, but a lifecycle is fixed at CREATION, so no change can reach a machine already gone).
//
// So "the vendor no longer has your machine" is a NORMAL state, not an error to be retried. It is not
// ours to prevent. What IS ours is the answer to it, and we did not have one.
//
// ── THE BUG THIS MODULE EXISTS TO KILL ──────────────────────────────────────────────────────────
// `getSandbox` already falls through a refused `Sandbox.connect` to a fresh `Sandbox.create`. The new
// machine is EMPTY, and the only thing that ever refilled it was the actuator's in-memory `_fileCache`
// — which the idle sweep DELETES when it pauses a workspace, and which dies with its Cloud Run
// instance on every deploy. In precisely the situation that matters — days later, another instance,
// snapshot gone — the restore source was empty and the app never came back. Every retry repeated it.
//
// The app's real files were never in danger: `WorkspaceFileStore` is Firestore, has no TTL, and is
// written on every build and edit. Two paths already read it before touching a sandbox (publish and
// GitHub push, via sandboxSeed.ts) because each was fixed when it broke. The preview — the one the
// user actually looks at — was outside both.
//
// ── WHY THE DECISION LIVES HERE AND NOT IN THE ACTUATOR ─────────────────────────────────────────
// The actuator cannot be unit-tested: it needs a real E2B account. So the RULE is pure and tested
// here, and the actuator only wires it. That is the same split `sandboxResumeChoice.ts`,
// `sandboxReaper.ts` and `previewWake.ts` already use for the neighbouring decisions.

/** What a restore onto a fresh machine actually did — every field measured, none inferred. */
export interface SandboxRestoreOutcome {
  /** Files the durable store held (Firestore, no TTL, survives the instance and the vendor). */
  durable: number;
  /** Files this instance still had warm in memory (may be NEWER than the last durable save). */
  warm: number;
  /** How many files we tried to write into the empty machine. */
  attempted: number;
  /** How many genuinely landed. The only number that means the app is back. */
  restored: number;
  /** Binary assets (logo, icons, fonts) re-materialised beside them. */
  assets: number;
  /**
   * Files the landing path DELIBERATELY refused: a live `.env`, an absolute or traversing path, a
   * dependency directory, or something over the per-file ceiling.
   *
   * Reported separately because it is not a failure and must not read as one. A skipped `.env` is the
   * system working — secrets are re-minted into the machine from the user's own vault, never restored
   * out of a shared store — but a report that showed only "restored 23/24" would send the next reader
   * hunting a bug that is not there.
   */
  skipped: number;
}

/**
 * Merge the two restore sources into the file set to write.
 *
 * 🔒 DURABLE FIRST, WARM OVERLAID — and the order is the whole correctness argument.
 *
 * The durable store is the COMPLETE app as of its last save, so it must supply the baseline: it is the
 * only source that still exists days later. The warm cache is INCOMPLETE by construction (bounded to
 * 500 files, skipping anything over 256KB and every dependency directory) but, when present, it holds
 * the writes of a build that may not have reached Firestore yet. So it wins per PATH and never decides
 * the SET — taking the cache as the baseline would silently ship a 500-file truncation of a larger app,
 * and taking durable as the winner would undo the newest edit.
 */
export function mergeRestoreSources(
  durable: Record<string, string>,
  warm: ReadonlyMap<string, string> | null | undefined,
): Record<string, string> {
  const merged: Record<string, string> = { ...durable };
  if (warm) for (const [path, content] of warm) merged[path] = content;
  return merged;
}

/**
 * Did the restore leave the machine usable?
 *
 * `attempted === 0` is NOT a failure: a brand-new workspace has nothing saved yet, and its first build
 * is supposed to scaffold. Only "we had files to put back and none of them landed" is a failure, and it
 * has to be reported rather than swallowed — an empty machine that nobody admits is empty is exactly
 * how this became a fifty-attempt bug.
 */
export function restoreFailed(outcome: SandboxRestoreOutcome): boolean {
  // A set that was ENTIRELY refused is not a failed restore either: nothing was ever going to be
  // written, and the refusals are deliberate. Only "files were writable and none landed" is the state
  // that leaves a user staring at an empty app.
  return outcome.attempted > outcome.skipped && outcome.restored === 0;
}

/**
 * One honest line for the build report. Never says "restored" about files that did not land.
 *
 * Written for the admin reading a build report beside the sandbox origin: "created a fresh machine
 * because the resume was refused" next to "restored 24 of 24 files from the durable store" is a
 * complete story, where the origin alone was a mystery.
 */
export function summarizeRestore(outcome: SandboxRestoreOutcome): string {
  if (outcome.attempted === 0) return 'nothing saved yet — nothing to restore';
  const parts = [`restored ${outcome.restored}/${outcome.attempted} files`];
  parts.push(`durable ${outcome.durable}`, `warm ${outcome.warm}`);
  if (outcome.assets > 0) parts.push(`assets ${outcome.assets}`);
  if (outcome.skipped > 0) parts.push(`skipped ${outcome.skipped} (secret/oversized/unsafe path)`);
  if (restoreFailed(outcome)) parts.push('RESTORE FAILED — the machine is empty');
  return parts.join(' · ');
}
