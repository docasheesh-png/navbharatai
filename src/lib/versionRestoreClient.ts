// The client half of the one version timeline (Q-128). PURE.

/**
 * The session id older clients use in version-history API URLs.
 *
 * The app picker uses bare session ids, so keep that UI/API contract. Storage uses the complete
 * workspace id, including its owner; the server resolves this URL id after verifying the caller.
 */
export function historyKeyFor(workspaceId: string | null | undefined, uid: string | null | undefined): string {
  const ws = String(workspaceId ?? '').trim();
  if (!ws) return '';
  const safeUid = typeof uid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(uid) ? uid : null;
  const prefix = safeUid ? `agentv3-${safeUid}-` : null;
  return prefix && ws.startsWith(prefix) ? ws.slice(prefix.length) : ws;
}

export type VersionRestoreOutcome =
  | { ok: true; files: Record<string, string>; message: string; needsRetry: boolean }
  | { ok: false; message: string };

const NOTHING_CHANGED = 'Could not go back to that version — nothing was changed. Please try again.';

/**
 * Read `/api/agentv3/restore-version`'s answer. A body is not an answer until it is checked: an OK status with
 * no file map is NOT a restore, and must never hand an empty app to the screen. PURE.
 */
export function readVersionRestoreResponse(httpOk: boolean, body: unknown): VersionRestoreOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const message = typeof b.message === 'string' && b.message.trim() ? b.message : '';
  if (!httpOk || b.ok !== true) {
    const err = typeof b.error === 'string' && b.error.trim() ? b.error : '';
    return { ok: false, message: err || NOTHING_CHANGED };
  }
  const files = b.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return { ok: false, message: NOTHING_CHANGED };
  const clean: Record<string, string> = {};
  for (const [p, c] of Object.entries(files as Record<string, unknown>)) if (typeof c === 'string') clean[p] = c;
  if (Object.keys(clean).length === 0) return { ok: false, message: NOTHING_CHANGED };
  return { ok: true, files: clean, message: message || 'Your app is back to that version.', needsRetry: b.sandbox === 'not-updated' };
}
