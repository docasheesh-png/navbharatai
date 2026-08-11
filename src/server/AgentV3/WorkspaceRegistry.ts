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
 */
export interface WorkspaceSession {
  workspaceId: string;
  git: GitManager;
  /** The sandbox command runner (the actuator) — powers the real Code Studio terminal. */
  runner?: CommandRunner;
  userId?: string;
  createdAt: number;
}

const sessions = new Map<string, WorkspaceSession>();
const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function prune(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff) sessions.delete(id);
  }
}

export function registerSession(workspaceId: string, git: GitManager, userId?: string, runner?: CommandRunner): void {
  prune();
  sessions.set(workspaceId, { workspaceId, git, runner, userId, createdAt: Date.now() });
}

export function getSession(workspaceId: string): WorkspaceSession | undefined {
  return sessions.get(workspaceId);
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

  const session = sessions.get(workspaceId);
  if (session && userId && session.userId && session.userId !== userId) return { ok: false, reason: 'forbidden' };

  if (session) {
    const ok = await session.git.restore(sha);
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
  const session = sessions.get(workspaceId);
  if (!session) return false;
  if (userId && session.userId && session.userId !== userId) return false;
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
  const session = sessions.get(workspaceId);
  if (!session) return null;
  if (userId && session.userId && session.userId !== userId) return null;
  return session.git.status();
}

/**
 * Run a single command in a warm session's sandbox for the REAL Code Studio terminal. Bounded: the
 * command runs under a hard `timeout` and its output is capped. Returns { available:false } when the
 * session is unknown / not owned / has no sandbox runner — so the UI shows an honest "sandbox not
 * active" state instead of faking output. Never throws.
 */
export async function execInSession(
  workspaceId: string,
  command: string,
  userId?: string,
): Promise<ExecResult> {
  const offline: ExecResult = { available: false, exitCode: -1, stdout: '', stderr: '' };
  const session = sessions.get(workspaceId);
  if (!session || !session.runner) return offline;
  if (userId && session.userId && session.userId !== userId) return offline;
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
 */
export function ptyHostForSession(workspaceId: string, userId?: string): PtyHost | undefined {
  const session = sessions.get(workspaceId);
  if (!session || !session.runner) return undefined;
  if (userId && session.userId && session.userId !== userId) return undefined;
  return isPtyHost(session.runner) ? session.runner : undefined;
}

export function sessionCount(): number {
  return sessions.size;
}

/** Test-only: clear the registry. */
export function _clearSessions(): void {
  sessions.clear();
}
