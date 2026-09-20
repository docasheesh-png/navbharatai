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
  reason: '' | 'not-ok' | 'no-workspace' | 'no-files' | 'already-saved' | 'disabled';
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
  try {
    await io.save(key, {
      commitMessage: restorePointMessage(opts.prompt, fileCount),
      fileCount,
      files: trimmed,
      isEdit: opts.isEdit === true,
      tier: opts.tier,
      ok: true,
    });
  } catch {
    /* best-effort by construction — the store swallows its own errors too */
  }
  return { save: true, reason: '' };
}
