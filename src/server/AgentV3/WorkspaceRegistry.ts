import type { GitManager, CommandRunner } from './GitManager';
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
 * Restore a session's workspace to a checkpoint SHA. Returns false if the
 * session is unknown or the user does not own it (when a userId is given).
 */
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
