// Shared NavBharatAI Pro v5.0 (AgentV3) workspace identity for the IDE side.
//
// The v5.0 engine keys every workspace as `agentv3-{uid}-{sessionId}` (server: deriveWorkspaceId),
// and the v5.0 chat panel persists its `sessionId` in localStorage under `agentv3_session_{uid}`.
// To make the IDE (Code Studio) and the v5.0 panel operate on the SAME workspace — so an uploaded
// ZIP in the IDE syncs into v5.0 and v5.0 knows which files exist — both sides must resolve to the
// same id. This module mirrors that exact format + storage key, so whichever surface runs first
// mints the session and the other reuses it.

const SESSION_KEY = (uid?: string | null): string => `agentv3_session_${uid || 'anon'}`;

/** Sanitise a uid to the server's accepted shape, falling back to 'anon'. */
export function normalizeUid(uid?: string | null): string {
  return uid && /^[A-Za-z0-9_-]{1,64}$/.test(uid) ? uid : 'anon';
}

function mintSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The current v5.0 session id for this account — reused across the IDE and the v5.0 panel via
 * localStorage. Mints + persists one on first use. Never throws (storage may be unavailable).
 */
export function getAgentV3SessionId(uid?: string | null): string {
  const key = SESSION_KEY(uid);
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const fresh = mintSessionId();
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return mintSessionId();
  }
}

/** The canonical v5.0 workspace id for this account/session — matches the server's format. */
export function getAgentV3WorkspaceId(uid?: string | null): string {
  return `agentv3-${normalizeUid(uid)}-${getAgentV3SessionId(uid)}`;
}
