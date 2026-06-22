import type { GitManager } from './GitManager';

/**
 * WorkspaceRegistry — keeps active v3.0 build sessions addressable after the
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

export function registerSession(workspaceId: string, git: GitManager, userId?: string): void {
  prune();
  sessions.set(workspaceId, { workspaceId, git, userId, createdAt: Date.now() });
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

export function sessionCount(): number {
  return sessions.size;
}

/** Test-only: clear the registry. */
export function _clearSessions(): void {
  sessions.clear();
}
