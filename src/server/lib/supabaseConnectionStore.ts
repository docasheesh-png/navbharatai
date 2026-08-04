// Where a user's Supabase grant lives (ROADMAP #1 Phase 1.1, slice 3).
//
// The OAuth flow returns tokens that can create and read databases inside the USER's Supabase
// account. They are, in effect, keys to their infrastructure — so they are stored ENCRYPTED with the
// platform's existing key-versioned AES-GCM helper (`lib/secrets`), never in plaintext, and this
// module is the ONLY place that reads them back. Nothing here logs a token, and no function returns
// one to a caller that did not ask for it explicitly.
//
// Two deliberate choices worth stating, because both are easy to get wrong later:
//
//  • ONE CONNECTION PER USER, not per app. The user connects their Supabase account once; every app
//    they build afterwards can be given its own project inside that account. Keying per workspace
//    would force them through consent again for every app — exactly the friction Phase 1 removes.
//
//  • A MISSING CONNECTION IS NOT AN ERROR. `getConnection` returns null for "not connected", "row
//    gone", and "could not decrypt" alike, because the caller's correct response to all three is the
//    same: ask the user to connect. Distinguishing them would only tempt a caller into showing a
//    scary failure for a user who simply has not connected yet.
//
// Collection: `supabase_connections/{userId}`

import { getServerDb } from './serverDb';
import { encrypt, decrypt } from './secrets';

const COLLECTION = 'supabase_connections';

export interface SupabaseConnection {
  /** Short-lived token used for Management API calls. */
  accessToken: string;
  /** Long-lived token used to mint a new access token when the above expires. */
  refreshToken: string;
  /** Absolute epoch ms at which accessToken stops working. */
  expiresAtMs: number;
  /** The organization we create projects in — resolved once at connect time. */
  orgId: string | null;
  /** Display name of that organization, so the UI can say WHICH account is connected. */
  orgName: string | null;
  connectedAtMs: number;
}

/** What a caller may see without holding a token — everything the Settings screen needs. */
export interface ConnectionStatus {
  connected: boolean;
  orgName: string | null;
  connectedAtMs: number | null;
}

/**
 * Should we refresh before using this token?
 *
 * PURE + exported so the boundary is unit-tested. The skew matters: a token that expires in four
 * seconds will pass a naive `expiresAt > now` check and then fail mid-request, surfacing to the user
 * as a random error on an operation that was actually fine. Refreshing slightly early is free;
 * failing halfway through creating their database is not.
 */
export const REFRESH_SKEW_MS = 60_000;

export function needsRefresh(expiresAtMs: number, nowMs: number, skewMs = REFRESH_SKEW_MS): boolean {
  if (!Number.isFinite(expiresAtMs)) return true; // unknown expiry ⇒ assume stale rather than gamble
  return nowMs >= expiresAtMs - skewMs;
}

/** Persist (or replace) a user's connection. Returns false rather than throwing — never breaks a flow. */
export async function saveConnection(userId: string, conn: SupabaseConnection): Promise<boolean> {
  const db = getServerDb() as any;
  if (!db || !userId) return false;
  try {
    await db.collection(COLLECTION).doc(userId).set({
      encrypted_access_token: encrypt(conn.accessToken),
      encrypted_refresh_token: encrypt(conn.refreshToken),
      expires_at_ms: conn.expiresAtMs,
      org_id: conn.orgId ?? null,
      org_name: conn.orgName ?? null,
      connected_at_ms: conn.connectedAtMs,
    });
    return true;
  } catch {
    return false; // storage is best-effort; the caller reports an honest "could not save"
  }
}

/**
 * Read a user's connection, decrypted.
 *
 * Returns null when there is nothing usable — see the header note on why "absent" and "corrupt" are
 * deliberately the same answer. A row whose tokens will not decrypt (key rotated past recovery, or a
 * tampered document) is treated as absent so the user is asked to reconnect instead of being handed a
 * broken credential.
 */
export async function getConnection(userId: string): Promise<SupabaseConnection | null> {
  const db = getServerDb() as any;
  if (!db || !userId) return null;
  try {
    const snap = await db.collection(COLLECTION).doc(userId).get();
    if (!snap?.exists) return null;
    const d = snap.data() ?? {};
    const accessToken = decrypt(d.encrypted_access_token ?? '');
    const refreshToken = decrypt(d.encrypted_refresh_token ?? '');
    if (!accessToken || !refreshToken) return null;
    return {
      accessToken,
      refreshToken,
      expiresAtMs: typeof d.expires_at_ms === 'number' ? d.expires_at_ms : 0,
      orgId: typeof d.org_id === 'string' ? d.org_id : null,
      orgName: typeof d.org_name === 'string' ? d.org_name : null,
      connectedAtMs: typeof d.connected_at_ms === 'number' ? d.connected_at_ms : 0,
    };
  } catch {
    return null;
  }
}

/**
 * The token-free view for the UI.
 *
 * Separate from getConnection on purpose: a status check happens on every Settings render, and it
 * must be impossible for that path to accidentally put a token on the wire.
 */
export async function getConnectionStatus(userId: string): Promise<ConnectionStatus> {
  const conn = await getConnection(userId);
  if (!conn) return { connected: false, orgName: null, connectedAtMs: null };
  return { connected: true, orgName: conn.orgName, connectedAtMs: conn.connectedAtMs || null };
}

/**
 * Disconnect.
 *
 * Deleting our copy revokes nothing on Supabase's side — the grant lives in the user's account until
 * they remove it there. Saying "disconnected" while implying we revoked it would be a small lie about
 * a security-relevant action, so the UI copy that accompanies this must tell them where to revoke.
 */
export async function deleteConnection(userId: string): Promise<boolean> {
  const db = getServerDb() as any;
  if (!db || !userId) return false;
  try {
    await db.collection(COLLECTION).doc(userId).delete();
    return true;
  } catch {
    return false;
  }
}

/** Update just the tokens after a refresh, preserving the org binding. */
export async function updateTokens(
  userId: string,
  tokens: { accessToken: string; refreshToken: string; expiresAtMs: number },
): Promise<boolean> {
  const existing = await getConnection(userId);
  if (!existing) return false;
  return saveConnection(userId, { ...existing, ...tokens });
}
