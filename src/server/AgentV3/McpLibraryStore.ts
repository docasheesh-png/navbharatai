/**
 * THE SERVICES A USER HAS SAVED — their account-level MCP library.
 *
 * Collection: `agentv3_mcp_library`
 * Doc ID:     `<userId>` — one document per person, for the same reason `McpServerStore` uses one per
 *             workspace: the cap is small, so an array costs a read where a document-per-service would
 *             cost a query.
 *
 * ═══ WHY THIS EXISTS ═══
 *
 * A connection used to be remembered per APP. The same app kept its services across every build — that
 * part was already right — but a NEW app meant typing the address and pasting the API key again, for a
 * service the user had already proven works. That is friction with nothing behind it.
 *
 * 🔒 AND THE OBVIOUS FIX IS THE WRONG ONE. "Apply every saved service to every new app" would repeat
 * the exact bug `secretScope.ts` already closed for credentials — a to-do list app quietly carrying a
 * key it has no business holding. So nothing here ever attaches itself. The library REMEMBERS; the
 * user CHOOSES, per app, in one tap. Saving and using stay two separate decisions.
 *
 * ═══ WHAT IS STORED, AND WHO CAN SEE IT ═══
 *
 * The same discipline as `McpServerStore`, deliberately: credentials are stored so the connection
 * keeps working, and are NEVER returned by a path that reaches a browser. `listForDisplay` returns the
 * name, the address and whether a key was configured; `listFull` (credentials included) is read only
 * by the server, at the moment it is about to attach or call. Two functions rather than one optional
 * flag, so a call site cannot leak a key by forgetting an argument.
 *
 * The document id IS the user, so there is no path that returns someone else's saved service.
 *
 * ⚠️ ATTACHING COPIES. When a saved service is attached to an app, the config is written into that
 * app's own `McpServerStore` record — the build path is completely unchanged by this file. The honest
 * consequence, which the screen states in words rather than leaving for a user to discover: removing a
 * service from the library stops it being OFFERED to new apps, and does not reach into apps that are
 * already using it. Those are disconnected per app, where the user can see which app they are changing.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { toPublic, type McpServerPublic } from './McpServerStore';
import type { McpServerConfig } from './mcpTransport';

export const MCP_LIBRARY_COLLECTION = 'agentv3_mcp_library';

/** Most services one ACCOUNT may keep saved. Four times the per-app cap — a person may reasonably have
 *  more tools than any single app should carry, which is the whole point of the split. */
export const MAX_SAVED_SERVICES = 20;

/**
 * Save one service into a list, replacing any earlier entry with the same name.
 *
 * PURE, and REPLACE rather than append on purpose. A user re-saving `notion` has rotated their key;
 * appending a second `notion` would leave two records whose precedence is decided by nothing anyone
 * chose — the same duplicate-row class that makes "which one wins?" unanswerable elsewhere in this
 * codebase. Here the newest simply IS the record.
 *
 * `null` when the list is full AND this is a new name. A replacement is always allowed, because
 * refusing to update a key the user already has saved would be a cap protecting nothing.
 */
export function upsertSaved(
  existing: readonly McpServerConfig[],
  cfg: McpServerConfig,
  max = MAX_SAVED_SERVICES,
): McpServerConfig[] | null {
  const without = existing.filter((s) => s.id !== cfg.id);
  const isNew = without.length === existing.length;
  if (isNew && existing.length >= max) return null;
  return [...without, cfg];
}

class McpLibraryStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = getServerDb();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  /**
   * Everything this user has saved, WITH credentials. Server-side only.
   *
   * Returns [] when storage is unavailable rather than throwing — an unreadable library must leave the
   * connect form working exactly as it does today, never break the screen.
   */
  async listFull(userId: string): Promise<McpServerConfig[]> {
    const db = this.getDb();
    if (!db || !userId) return [];
    try {
      const snap = await db.collection(MCP_LIBRARY_COLLECTION).doc(userId).get();
      const raw = snap.exists ? (snap.data()?.servers as unknown) : null;
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((s): s is McpServerConfig => !!s && typeof s === 'object'
          && typeof (s as McpServerConfig).id === 'string'
          && typeof (s as McpServerConfig).url === 'string')
        .slice(0, MAX_SAVED_SERVICES);
    } catch {
      return [];
    }
  }

  /** The same list, safe to send to a browser — credentials removed. */
  async listForDisplay(userId: string): Promise<McpServerPublic[]> {
    return (await this.listFull(userId)).map(toPublic);
  }

  /** One saved service, WITH credentials, or null. Server-side only — this is what attach reads. */
  async get(userId: string, serviceId: string): Promise<McpServerConfig | null> {
    if (!serviceId) return null;
    return (await this.listFull(userId)).find((s) => s.id === serviceId) ?? null;
  }

  /**
   * Remember a service (or update the key on one already remembered).
   *
   * Best-effort by contract: the caller is a connect that has ALREADY succeeded, so a library write
   * that fails must never turn a working connection into an error. It returns false and the connection
   * stands — the user simply has to type it again for their next app, which is today's behaviour.
   */
  async save(userId: string, cfg: McpServerConfig): Promise<boolean> {
    const db = this.getDb();
    if (!db || !userId) return false;
    try {
      const next = upsertSaved(await this.listFull(userId), cfg);
      if (!next) return false;
      await db.collection(MCP_LIBRARY_COLLECTION).doc(userId).set(
        { userId, servers: next, updatedAt: Date.now() },
        { merge: true },
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Forget one saved service. True when it is gone (including when it was never there). */
  async remove(userId: string, serviceId: string): Promise<boolean> {
    const db = this.getDb();
    if (!db || !userId) return false;
    try {
      const next = (await this.listFull(userId)).filter((s) => s.id !== serviceId);
      await db.collection(MCP_LIBRARY_COLLECTION).doc(userId).set(
        { userId, servers: next, updatedAt: Date.now() },
        { merge: true },
      );
      return true;
    } catch {
      return false;
    }
  }
}

export const mcpLibraryStore = new McpLibraryStore();
