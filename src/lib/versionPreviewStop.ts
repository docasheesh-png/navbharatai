/**
 * Close a version preview on the server when the user leaves it (queue Q-162).
 *
 * `POST /api/agentv3/version-preview/stop` was written to be "called when the user dismisses the preview",
 * and nothing called it: leaving the preview only cleared the panel, so the old version's dev server kept
 * its port and memory in the user's sandbox until a newer preview displaced it or the sandbox slept.
 *
 * Best effort by design: the screen has already closed, a failed stop costs only what it cost before, and
 * the server still reclaims the port on its own — so this never throws and never shows an error.
 */
import { authJsonHeaders } from './authHeaders';

export async function stopVersionPreview(opts: { workspaceId?: string; sha?: string; userId?: string; email?: string }): Promise<boolean> {
  if (!opts.workspaceId || !opts.sha) return false;
  try {
    const r = await fetch('/api/agentv3/version-preview/stop', {
      method: 'POST',
      headers: await authJsonHeaders(),
      body: JSON.stringify({ workspaceId: opts.workspaceId, sha: opts.sha, userId: opts.userId, email: opts.email }),
    });
    const j = await r.json().catch(() => null);
    return r.ok && j?.stopped === true;
  } catch {
    return false;
  }
}
