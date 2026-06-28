// P4.4 — Replication / cross-device sync consistency.
//
// The cross-device workspace sync POST used to BLINDLY overwrite the whole stored doc, so a
// device that saved a slightly-stale view could drop another device's newer sessions (a
// lost-update). The consistency model is now LAST-WRITE-WINS PER SESSION, ENFORCED ON THE
// SERVER by merging the incoming payload with what's already stored before writing. This
// guarantees no cross-device session is ever lost, needs no client changes, and is fully
// backward compatible. These helpers are pure so the merge rule is unit-tested.

export interface SyncSession {
  id?: string;
  /** ISO string or epoch ms; higher = newer. Missing → treated as oldest. */
  lastUpdated?: string | number;
  [k: string]: unknown;
}

export interface WorkspacePayload {
  sessions: SyncSession[];
  lastApp: string;
}

function ts(s: SyncSession): number {
  const t = new Date((s?.lastUpdated as any) ?? 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Merge stored + incoming sessions by id, newer `lastUpdated` wins (ties → incoming, the
 * more recent writer). Sessions without an id can't be matched across devices, so only the
 * incoming writer's id-less sessions are kept (its payload is its complete current view) —
 * this avoids unbounded accumulation of stale id-less duplicates.
 */
export function mergeSessions(stored: SyncSession[], incoming: SyncSession[]): SyncSession[] {
  const byId = new Map<string, SyncSession>();
  for (const s of stored) if (s?.id) byId.set(s.id, s);
  for (const s of incoming) {
    if (!s?.id) continue;
    const existing = byId.get(s.id);
    if (!existing || ts(s) >= ts(existing)) byId.set(s.id, s); // newer-wins
  }
  const idless = incoming.filter((s) => !s?.id);
  return [...byId.values(), ...idless];
}

/**
 * Merge a full workspace payload. `lastApp` keeps the incoming value when non-empty,
 * otherwise preserves the stored one — so a device that has no generated app cached can
 * never wipe the cloud copy.
 */
export function mergeWorkspaceState(stored: WorkspacePayload, incoming: WorkspacePayload): WorkspacePayload {
  const incomingLastApp = typeof incoming.lastApp === 'string' ? incoming.lastApp : '';
  return {
    sessions: mergeSessions(stored.sessions || [], incoming.sessions || []),
    lastApp: incomingLastApp.length > 0 ? incomingLastApp : (stored.lastApp || ''),
  };
}
