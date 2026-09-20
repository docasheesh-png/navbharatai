// EVERY BUILD LEAVES A VERSION YOU CAN GO BACK TO — the writer the Time Machine was reading for.
//
// 🔴 WHY THIS EXISTS (admin 2026-09-20: "versioning kam hi nahi kar raha hai", with a screenshot of
// Time Machine reading "No saved versions yet" under an app of 20 files).
//
// NavBharatAI grew TWO version systems, and the screen the user opens reads the dead one:
//
//   A. `workspace_checkpoints_v3` — git commit METADATA from a v5 build, durable, cross-device, shown
//      in the Pro panel's own History tab. Restoring one asks the SANDBOX to check the sha out, so
//      `/api/agentv3/restore` says in its own comment that it "can offer a restore the sandbox can no
//      longer perform". Days later, on another device, there is nothing left to restore FROM.
//   B. `build_history/{sessionId}` — whole FILE SNAPSHOTS, durable, restorable for ever. This is what
//      `CodeVersioning.tsx` (Time Machine) lists, and what its empty state promises: "Each build is
//      saved here automatically."
//
// **That promise was false.** `BuildHistoryStore`'s own docblock says "Every build (ok: true) writes
// one entry here", and a grep of its importers returns exactly two files: the LEGACY `/api/build`
// route, and `workspaceEdit` (a restore point taken before a TOOL edits files). NavBharatAI Pro v5 —
// the engine that builds every app anyone makes today — never wrote a single one. So the Time Machine
// has been empty for every v5 app, for every user, since v5 became the engine. Nothing failed, nothing
// logged, and the screen blamed the user's app for having no versions.
//
// The instance was fixed in one lane and the sibling was never hunted — the class CLAUDE.md names.
// This module is the missing writer, and it is deliberately ONE function rather than a line at each
// save site: a build settles in TWO places (the normal settle and the Fix-67 deadline finalizer), and
// Fix 67 exists precisely because those two drifted on billing once already.
//
// 🔒 IT COPIES THE DURABLE FILE SET, NOT THE TURN'S WRITES. A restore point must be the WHOLE app as
// it stood, not the handful of files this turn happened to touch — restoring a three-file diff over a
// twenty-file app would produce something that never existed. So the caller hands it a loader and it
// reads what was actually persisted.

import { buildHistoryStore } from '../project/BuildHistoryStore';
import { workspacePrefixFor } from '../lib/workspaceIdentity';

/** Never let one restore point grow past what the store can hold; it caps again internally. */
export const MAX_RESTORE_POINT_BYTES = 900_000;

/**
 * The key the Time Machine reads.
 *
 * ⚠️ `/api/versioning/apps` lists a user's apps as `workspaceId` MINUS `agentv3-{uid}-`, and
 * `/api/build-history/:sessionId` is then called with that bare session id. So a restore point written
 * under the full workspace id would be invisible to the very screen it exists for — the failure would
 * look identical to writing nothing at all. One rule, derived the same way the route derives it.
 *
 * A workspace that does not carry this user's prefix (an imported or legacy id) keeps its own id,
 * which is what the listing route does too.
 */
export function restorePointKey(workspaceId: string, uid: string | null | undefined): string {
  const ws = String(workspaceId ?? '').trim();
  if (!ws) return '';
  const prefix = workspacePrefixFor(uid);
  return prefix && ws.startsWith(prefix) ? ws.slice(prefix.length) : ws;
}

export interface RestorePointDecision {
  save: boolean;
  /** Why not, for the build report. Empty when saving. */
  reason:
    | ''
    | 'not-ok'
    | 'no-workspace'
    | 'no-files'
    | 'already-saved'
    | 'disabled'
    // The write was attempted and the store did not take it (no Firestore, or it threw). NOT the same
    // fact as any refusal above: those mean "we chose not to", this means "we tried and failed".
    | 'write-failed'
    // We asked, and the answer did not come back inside the confirmation window. A version may well
    // exist. Saying so is the only honest option — reporting either "saved" or "failed" would be a
    // guess, and this module exists because a guess was reported as a fact.
    | 'unconfirmed';
}

/** Every build that has already left a restore point, keyed per build so a retry cannot double-write. */
const savedForBuild = new Set<string>();

/** Bounded so a long-lived instance cannot grow this set without limit. */
const MAX_REMEMBERED = 500;

export function rememberRestorePoint(buildKey: string): void {
  if (savedForBuild.size >= MAX_REMEMBERED) savedForBuild.clear();
  savedForBuild.add(buildKey);
}

export function restorePointAlreadySaved(buildKey: string): boolean {
  return savedForBuild.has(buildKey);
}

/**
 * Release a claim whose write did not land.
 *
 * 🔒 The claim is taken BEFORE the write so two settle paths cannot both save. That is right, and it
 * had one hole: a FAILED write left the key claimed, so the other settle path — the one that exists
 * precisely to rescue a build the first path could not finish — would refuse with `already-saved` and
 * the user would end with no version at all. Releasing on failure cannot duplicate anything, because
 * nothing was written.
 */
export function forgetRestorePoint(buildKey: string): void {
  savedForBuild.delete(buildKey);
}

/** TEST ONLY — the per-process memory above is deliberately module-scoped. */
export function _resetRestorePointMemory(): void {
  savedForBuild.clear();
}

/**
 * Should this build leave a restore point? PURE.
 *
 * ⚠️ `ok` is required and there is no default: a FAILED build must never become the version a user
 * goes back to, and a turn that produced no app (a chat answer, a survey) has nothing to snapshot.
 * The kill switch is read by the caller and passed in, so this stays free of `process.env`.
 */
export function decideRestorePoint(opts: {
  ok: boolean;
  workspaceId: string;
  fileCount: number;
  buildKey: string;
  enabled?: boolean;
}): RestorePointDecision {
  if (opts.enabled === false) return { save: false, reason: 'disabled' };
  if (!opts.ok) return { save: false, reason: 'not-ok' };
  if (!String(opts.workspaceId ?? '').trim()) return { save: false, reason: 'no-workspace' };
  if (!(opts.fileCount > 0)) return { save: false, reason: 'no-files' };
  if (restorePointAlreadySaved(opts.buildKey)) return { save: false, reason: 'already-saved' };
  return { save: true, reason: '' };
}

/** `AGENTV3_RESTORE_POINTS=off` is the instant, no-deploy revert to the pre-2026-09-20 behaviour. */
export function restorePointsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_RESTORE_POINTS ?? '').trim().toLowerCase() !== 'off';
}

/**
 * What the user reads in the Time Machine list. Their OWN words where there are any — a list of
 * identical auto-messages is what made the v5 checkpoint list unusable before labels were added.
 */
export function restorePointMessage(prompt: string | null | undefined, fileCount: number): string {
  const p = String(prompt ?? '').replace(/\s+/g, ' ').trim();
  const files = `${fileCount} file${fileCount === 1 ? '' : 's'}`;
  if (!p) return `App version — ${files}`;
  return `${p.length > 64 ? `${p.slice(0, 63)}…` : p} — ${files}`;
}

export interface RestorePointIo {
  loadFiles: (workspaceId: string) => Promise<Record<string, string>>;
  /** Resolves TRUE only when the version really landed — see BuildHistoryStore.save. */
  save: typeof buildHistoryStore.save;
}

const defaultIo: RestorePointIo = {
  loadFiles: async () => ({}),
  save: (...a) => buildHistoryStore.save(...a),
};

/**
 * Write one restore point for a finished build. NEVER throws and never blocks a build — a history
 * write must not be able to cost a user the app they just paid for.
 *
 * Returns the decision so the caller can record it honestly in the build report: "no restore point"
 * and "we did not look" are different facts, and the screen that reads them says so.
 */
export async function saveRestorePoint(opts: {
  ok: boolean;
  workspaceId: string;
  uid: string | null | undefined;
  prompt?: string | null;
  isEdit?: boolean;
  tier?: string;
  buildKey: string;
  io?: Partial<RestorePointIo>;
  env?: NodeJS.ProcessEnv;
}): Promise<RestorePointDecision> {
  const io: RestorePointIo = { ...defaultIo, ...(opts.io ?? {}) };
  const enabled = restorePointsEnabled(opts.env);
  // Cheap refusals first — an `ok: false` build must not pay for a durable read.
  const early = decideRestorePoint({ ok: opts.ok, workspaceId: opts.workspaceId, fileCount: 1, buildKey: opts.buildKey, enabled });
  if (!early.save) return early;

  let files: Record<string, string> = {};
  try {
    files = (await io.loadFiles(opts.workspaceId)) ?? {};
  } catch {
    return { save: false, reason: 'no-files' };
  }
  const trimmed: Record<string, string> = {};
  let bytes = 0;
  for (const [path, content] of Object.entries(files)) {
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    const size = path.length + content.length;
    if (bytes + size > MAX_RESTORE_POINT_BYTES) break;
    trimmed[path] = content;
    bytes += size;
  }
  const fileCount = Object.keys(trimmed).length;
  const decision = decideRestorePoint({ ok: opts.ok, workspaceId: opts.workspaceId, fileCount, buildKey: opts.buildKey, enabled });
  if (!decision.save) return decision;

  const key = restorePointKey(opts.workspaceId, opts.uid);
  if (!key) return { save: false, reason: 'no-workspace' };

  // Claimed BEFORE the write, so a settle that races its own finalizer writes once rather than twice.
  rememberRestorePoint(opts.buildKey);
  let landed = false;
  try {
    landed = (await io.save(key, {
      commitMessage: restorePointMessage(opts.prompt, fileCount),
      fileCount,
      files: trimmed,
      isEdit: opts.isEdit === true,
      tier: opts.tier,
      ok: true,
    })) === true;
  } catch {
    landed = false;
  }
  if (!landed) {
    // Nothing was written, so the claim must go: the OTHER settle path is the rescue, and a stale
    // claim would turn a recoverable failure into a build with no version at all.
    forgetRestorePoint(opts.buildKey);
    return { save: false, reason: 'write-failed' };
  }
  return { save: true, reason: '' };
}

/** How long the build waits for the store to confirm before recording `unconfirmed` and moving on. */
export const RESTORE_POINT_CONFIRM_MS = 5_000;

/**
 * One sentence for the build report. PURE.
 *
 * 🔴 WHY THE REPORT NEEDED THIS AT ALL (admin 2026-09-20, having pressed "Save this version" by hand
 * and asked why the automatic one had not run): the writer knew six different answers and told NOBODY
 * any of them. So the only way to find out whether a build had left a version was to open the Time
 * Machine on a phone and look — which is how this module's own two-month-old bug survived. An engine
 * that cannot say what it did is an engine whose next failure is found by a user.
 */
export function describeRestorePoint(decision: RestorePointDecision): string {
  switch (decision.reason) {
    case '':
      return 'A version was saved — the user can go back to this build from the Time Machine.';
    case 'not-ok':
      return 'No version was saved: this turn did not produce a working app. A failed build must never become the version somebody goes back to.';
    case 'no-files':
      return 'No version was saved: no files could be read for this workspace, so there was nothing to snapshot.';
    case 'no-workspace':
      return 'No version was saved: this turn had no workspace to snapshot.';
    case 'already-saved':
      return 'No second version was saved: this build had already left one (the two settle paths share one key).';
    case 'disabled':
      return 'No version was saved: version saving is switched off (AGENTV3_RESTORE_POINTS=off).';
    case 'write-failed':
      return 'A version could NOT be saved — the history store did not accept the write. The user has no way back to this build.';
    case 'unconfirmed':
      return `A version was requested but not confirmed within ${Math.round(RESTORE_POINT_CONFIRM_MS / 1000)}s. It may or may not exist; the Time Machine is the authority.`;
    default:
      return 'No version was saved.';
  }
}

/** Is this an outcome worth a human's attention? A refusal we CHOSE is not; a failure is. */
export function restorePointSeverity(decision: RestorePointDecision): 'info' | 'warning' {
  return decision.reason === 'write-failed'
    || decision.reason === 'unconfirmed'
    || decision.reason === 'no-files'
    || decision.reason === 'no-workspace'
    ? 'warning'
    : 'info';
}

/**
 * The same write, bounded, so the BUILD REPORT can state the outcome instead of guessing at it.
 *
 * 🔴 WHY IT IS AWAITED AT ALL, when the write itself is deliberately best-effort. Fire-and-forget and
 * "say what happened" are incompatible: the report is assembled and persisted at the end of the build,
 * so an answer that arrives afterwards reaches nobody. The wait is bounded by
 * `RESTORE_POINT_CONFIRM_MS` and lands at the very end of a build measured in minutes.
 *
 * 🔒 A TIMEOUT IS NOT A FAILURE. The write may still land after we stop waiting, so the outcome is
 * `unconfirmed` — a third answer, kept separate from both "saved" and "failed" for the same reason
 * `JudgeVerdict.reviewed` exists: an instrument that could not read must not report a reading.
 */
export async function saveRestorePointForReport(
  opts: Parameters<typeof saveRestorePoint>[0] & { confirmMs?: number },
): Promise<RestorePointDecision> {
  const ms = Math.max(0, opts.confirmMs ?? RESTORE_POINT_CONFIRM_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const attempt = saveRestorePoint(opts).catch(() => ({ save: false, reason: 'write-failed' as const }));
    const bounded = new Promise<RestorePointDecision>((resolve) => {
      timer = setTimeout(() => resolve({ save: false, reason: 'unconfirmed' }), ms);
    });
    return await Promise.race([attempt, bounded]);
  } catch {
    return { save: false, reason: 'write-failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
