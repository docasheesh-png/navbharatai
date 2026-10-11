import { GitManager } from './GitManager';
import type { CommandRunner } from './GitManager';
import { wrapBoundedCommand, capOutput, isRunnableCommand, EXEC_TIMEOUT_SEC, type ExecResult } from './execCommand';
import { isPtyHost, type PtyHost } from './ShellSessions';

/**
 * WorkspaceRegistry — keeps active v5.0 build sessions addressable after the
 * streaming build request, so a separate request can act on the same sandbox
 * (History → restore now; preview refresh / resume later). In-memory singleton
 * with a TTL sweep so abandoned sessions are dropped.
 *
 * This is the first step toward full session persistence (D7): today it holds
 * the live GitManager for the workspace; a durable backend can replace the Map
 * without changing callers.
 *
 * TTL is sliding (BLD-8): a session that is still being used stays alive. Expiry
 * is measured from `lastUsedAt`, not from when the session was created. A lookup
 * of an expired session deletes it and returns a miss.
 */
export interface WorkspaceSession {
  workspaceId: string;
  git: GitManager;
  /** The sandbox command runner (the actuator) — powers the real Code Studio terminal. */
  runner?: CommandRunner;
  userId?: string;
  createdAt: number;
  /** Epoch ms of the last successful lookup. Sliding TTL reads this, not `createdAt`. */
  lastUsedAt: number;
}

const sessions = new Map<string, WorkspaceSession>();
const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function expired(s: WorkspaceSession, now = Date.now()): boolean {
  return now - s.lastUsedAt > TTL_MS;
}

function prune(now = Date.now()): void {
  for (const [id, s] of sessions) {
    if (expired(s, now)) sessions.delete(id);
  }
}

/**
 * A runner to re-register when exec misses the in-memory map (another Cloud Run instance,
 * or this one recycled). Tests inject a fake; production wires the actuator. Null means
 * there is no live sandbox to rehydrate — exec stays offline. Never used for a PTY.
 */
export type SessionReconnect = (
  workspaceId: string,
  userId?: string,
) => Promise<CommandRunner | null | undefined> | CommandRunner | null | undefined;

let sessionReconnect: SessionReconnect | null = null;

/** Install or clear the exec rehydrate hook. Production and tests share this one setter. */
export function bindSessionReconnectForTests(fn: SessionReconnect | null): void {
  sessionReconnect = fn;
}

export function registerSession(workspaceId: string, git: GitManager, userId?: string, runner?: CommandRunner): void {
  prune();
  const now = Date.now();
  sessions.set(workspaceId, { workspaceId, git, runner, userId, createdAt: now, lastUsedAt: now });
}

/**
 * Successful lookup of a LIVE session: refresh `lastUsedAt`.
 * Expired → delete and miss. Wrong owner → miss WITHOUT touching (and without deleting),
 * so a probe cannot slide somebody else's TTL or look like a rehydrate opportunity.
 */
function takeLive(workspaceId: string, userId?: string): WorkspaceSession | undefined {
  const s = sessions.get(workspaceId);
  if (!s) return undefined;
  if (expired(s)) {
    sessions.delete(workspaceId);
    return undefined;
  }
  if (userId && s.userId && s.userId !== userId) return undefined;
  s.lastUsedAt = Date.now();
  return s;
}

export function getSession(workspaceId: string): WorkspaceSession | undefined {
  return takeLive(workspaceId);
}

/**
 * Why a checkpoint restore did or did not happen. A bare boolean used to collapse FOUR different
 * situations into one, and the user was told the same sentence for all of them.
 */
export type RestoreReason =
  | 'restored'      // it worked
  | 'forbidden'     // the workspace is not this user's
  | 'no-sandbox'    // the sandbox is gone; there is nothing to restore INTO
  | 'no-history'    // the sandbox is alive but carries no git repo (recycled → history lost)
  | 'unknown-sha'   // the sandbox has git, but not this commit
  | 'failed';       // git ran and refused

export interface RestoreResult { ok: boolean; reason: RestoreReason }

/**
 * Restore a workspace to a checkpoint SHA.
 *
 * ⚠️ THE BUG THIS FIXES (2026-08-11). This used to read ONLY the in-memory `sessions` map and return
 * `false` when it missed. That map lives on ONE Cloud Run instance, and Cloud Run runs several — so a
 * user whose request happened to land on a different instance was told their checkpoint was "not
 * active in this session", with a live sandbox sitting right there. The checkpoint LIST is durable
 * (Firestore), so the UI was offering restores it could not perform, and the failure looked like the
 * user's fault.
 *
 * The sandbox is addressed by `workspaceId`, not by which instance happens to hold a session object,
 * so any instance can serve this: the warm session is used when present (cheapest), and otherwise a
 * `GitManager` is built on demand against the same sandbox — exactly what `/restore-files` already
 * does for the file path.
 *
 * The remaining honest limit: a sandbox that RECYCLED has no git repo, so its history is genuinely
 * gone and no instance can bring it back. That is now reported as `no-history` — a different fact
 * from "not in this session", and one the UI can act on.
 */
export async function restoreSessionDetailed(
  workspaceId: string,
  sha: string,
  userId: string | undefined,
  makeRunner: () => CommandRunner,
): Promise<RestoreResult> {
  // 🔒 VALIDATE BEFORE ANYTHING REACHES A SHELL. The sha is client-supplied and is interpolated into
  // a command below; `GitManager.restore` validates it too, but the probe runs FIRST, so checking
  // only there would have left a command-injection hole open in front of it. (It did — the test for
  // this caught `rm -rf` reaching the sandbox during development.)
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) return { ok: false, reason: 'unknown-sha' };

  const raw = sessions.get(workspaceId);
  if (raw && expired(raw)) {
    sessions.delete(workspaceId);
  } else if (raw) {
    if (userId && raw.userId && raw.userId !== userId) return { ok: false, reason: 'forbidden' };
    // Warm session actually used — slide the TTL.
    raw.lastUsedAt = Date.now();
    const ok = await raw.git.restore(sha);
    if (ok) return { ok: true, reason: 'restored' };
    // Fall through: a warm session whose restore refused still deserves a real diagnosis below.
  }

  // No session on THIS instance (or the warm attempt failed) → address the sandbox directly.
  let runner: CommandRunner;
  try { runner = makeRunner(); } catch { return { ok: false, reason: 'no-sandbox' }; }

  // Ask the sandbox whether it has a repo AT ALL. `ensureRepo()` cannot answer this — it returns true
  // unless the runner throws, ignoring exit codes — so trusting it would report a git-less sandbox as
  // "unknown commit" instead of "history gone", which are opposite messages for the user.
  try {
    const repo = await runner.runCommand(workspaceId, 'git rev-parse --git-dir >/dev/null 2>&1 && echo HASREPO');
    if (!repo.stdout.includes('HASREPO')) return { ok: false, reason: 'no-history' };
  } catch { return { ok: false, reason: 'no-sandbox' }; }

  // Distinguish "this commit is not here" from "git refused" — the user can act on the first
  // (that version is gone) and only the second is worth retrying.
  try {
    const probe = await runner.runCommand(workspaceId, `git cat-file -e ${sha}^{commit} 2>/dev/null && echo FOUND`);
    if (!probe.stdout.includes('FOUND')) return { ok: false, reason: 'unknown-sha' };
  } catch { /* probe is best-effort — fall through to the real restore */ }

  const git = new GitManager(runner, workspaceId);
  try { await git.ensureRepo(); } catch { return { ok: false, reason: 'no-sandbox' }; }
  return (await git.restore(sha)) ? { ok: true, reason: 'restored' } : { ok: false, reason: 'failed' };
}

/** Back-compat boolean wrapper — the warm-session-only path, kept for existing callers. */
export async function restoreSession(
  workspaceId: string,
  sha: string,
  userId?: string,
): Promise<boolean> {
  const session = takeLive(workspaceId, userId);
  if (!session) return false;
  return session.git.restore(sha);
}

/**
 * Real git working-tree status for a session's workspace (Phase G2). Returns null when the session is
 * unknown, not owned by the user, or git is unavailable — so the caller can show an honest "not active
 * in this session" state instead of faking a clean tree.
 */
export async function gitStatusForSession(
  workspaceId: string,
  userId?: string,
): Promise<{ clean: boolean; changed: number; head: string } | null> {
  const session = takeLive(workspaceId, userId);
  if (!session) return null;
  return session.git.status();
}

/**
 * Run a single command in a warm session's sandbox for the REAL Code Studio terminal. Bounded: the
 * command runs under a hard `timeout` and its output is capped. Returns { available:false } when the
 * session is unknown / not owned / has no sandbox runner — so the UI shows an honest "sandbox not
 * active" state instead of faking output. Never throws.
 *
 * On a MISS (no in-memory session), an optional reconnect hook may re-register a live sandbox on
 * THIS instance and continue. A session the caller does not own is never rehydrated. A null
 * reconnect result keeps today's offline answer. PTY hosts do not use this path — a TTY cannot
 * migrate onto this process.
 */
export async function execInSession(
  workspaceId: string,
  command: string,
  userId?: string,
): Promise<ExecResult> {
  const offline: ExecResult = { available: false, exitCode: -1, stdout: '', stderr: '' };
  const raw = sessions.get(workspaceId);
  // Someone else's session — expired or not — is not a hole to rehydrate through.
  if (raw && userId && raw.userId && raw.userId !== userId) {
    if (expired(raw)) sessions.delete(workspaceId);
    return offline;
  }
  let session = takeLive(workspaceId, userId);
  if (!session && sessionReconnect) {
    let runner: CommandRunner | null | undefined;
    try { runner = await sessionReconnect(workspaceId, userId); } catch { runner = null; }
    if (runner) {
      registerSession(workspaceId, new GitManager(runner, workspaceId), userId, runner);
      session = takeLive(workspaceId, userId);
    }
  }
  if (!session || !session.runner) return offline;
  if (!isRunnableCommand(command)) return { available: true, exitCode: 0, stdout: '', stderr: '' };
  try {
    const r = await session.runner.runCommand(workspaceId, wrapBoundedCommand(command, EXEC_TIMEOUT_SEC));
    return {
      available: true,
      exitCode: typeof r.exitCode === 'number' ? r.exitCode : -1,
      stdout: capOutput(r.stdout),
      stderr: capOutput(r.stderr),
      // `timeout` exits 124 when it kills the command.
      timedOut: r.exitCode === 124,
    };
  } catch {
    // The sandbox has no shell (e.g. LocalActuator in dev/CI) → honest "not available".
    return offline;
  }
}

/**
 * The PTY-capable actuator behind a workspace, for Code Studio's REAL shells (ShellSessions.ts).
 *
 * Undefined when the session is unknown, not owned by the caller, or the actuator has no TTY support
 * (LocalActuator in dev/CI) — so the caller shows an honest "sandbox not active" state rather than a
 * shell that silently swallows every keystroke.
 *
 * Pure memory lookup. A TTY cannot be reconnected onto this instance — the caller returns
 * SHELL_NOT_ON_THIS_INSTANCE and the client opens a new shell here.
 */
export function ptyHostForSession(workspaceId: string, userId?: string): PtyHost | undefined {
  const session = takeLive(workspaceId, userId);
  if (!session || !session.runner) return undefined;
  return isPtyHost(session.runner) ? session.runner : undefined;
}

export function sessionCount(): number {
  return sessions.size;
}

/** Test-only: clear the registry. */
export function _clearSessions(): void {
  sessions.clear();
}
