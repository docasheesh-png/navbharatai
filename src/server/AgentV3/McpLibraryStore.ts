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
 * 🔒 ENCRYPTED AT REST (Q-628), exactly like `McpServerStore`: headers are written only as `headersEnc`
 * (mcpCredentials.ts), legacy plaintext rows still read and are re-sealed on the next write or by the
 * background migration a read starts, and a saved service whose key cannot be decrypted is never handed
 * out for a call — `get` returns null for it and `getOpened` says why.
 *
 * ⚠️ ATTACHING COPIES. When a saved service is attached to an app, the config is written into that
 * app's own `McpServerStore` record — the build path is completely unchanged by this file. The honest
 * consequence, which the screen states in words rather than leaving for a user to discover: removing a
 * service from the library stops it being OFFERED to new apps, and does not reach into apps that are
 * already using it. Those are disconnected per app, where the user can see which app they are changing.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { openedToPublic, rawEntries, type McpServerPublic } from './McpServerStore';
import type { McpServerConfig } from './mcpTransport';
import { openServer, resealStored, sealServer, type OpenedMcpServer, type StoredMcpServer } from './mcpCredentials';

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
export function upsertSaved<T extends { id: string }>(
  existing: readonly T[],
  cfg: T,
  max = MAX_SAVED_SERVICES,
): T[] | null {
  const without = existing.filter((s) => s.id !== cfg.id);
  const isNew = without.length === existing.length;
  if (isNew && existing.length >= max) return null;
  return [...without, cfg];
}

type RawEntry = { id: string; url: string } & Record<string, unknown>;

export class McpLibraryStore {
  private db: admin.firestore.Firestore | null = null;

  /** `dbOverride` is for tests: a fake Firestore instead of the real one. */
  constructor(private readonly dbOverride?: () => admin.firestore.Firestore | null) {}

  private getDb(): admin.firestore.Firestore | null {
    if (this.dbOverride) return this.dbOverride();
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

  /** THROWS on a read failure, so a write never mistakes "could not read" for "nothing saved". */
  private async readRaw(db: admin.firestore.Firestore, userId: string): Promise<RawEntry[]> {
    const snap = await db.collection(MCP_LIBRARY_COLLECTION).doc(userId).get();
    return snap.exists ? rawEntries(snap.data()) : [];
  }

  /** Re-seal pre-Q-628 plaintext rows in a transaction. Best-effort; see McpServerStore.migrateLegacy. */
  private migrateLegacy(db: admin.firestore.Firestore, userId: string): void {
    const ref = db.collection(MCP_LIBRARY_COLLECTION).doc(userId);
    void Promise.resolve()
      .then(() => db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const raw = snap.exists ? rawEntries(snap.data()) : [];
        if (!raw.some((r) => openServer(r).legacyPlaintext)) return;
        t.set(ref, { servers: raw.map(resealStored), updatedAt: Date.now() }, { merge: true });
      }))
      .catch(() => { /* the plaintext rows still work; the next write seals them */ });
  }

  /** Everything this user has saved, opened, with whether each key is usable. Server-side only. */
  async listOpened(userId: string): Promise<OpenedMcpServer[]> {
    const db = this.getDb();
    if (!db || !userId) return [];
    try {
      const opened = (await this.readRaw(db, userId)).slice(0, MAX_SAVED_SERVICES).map(openServer);
      if (opened.some((o) => o.legacyPlaintext)) this.migrateLegacy(db, userId);
      return opened;
    } catch {
      return [];
    }
  }

  /**
   * Everything this user has saved that can be USED, WITH credentials. Server-side only.
   *
   * Returns [] when storage is unavailable rather than throwing — an unreadable library must leave the
   * connect form working exactly as it does today, never break the screen.
   */
  async listFull(userId: string): Promise<McpServerConfig[]> {
    return (await this.listOpened(userId)).filter((o) => !o.credentialsUnreadable).map((o) => o.cfg);
  }

  /** The same list, safe to send to a browser — credentials removed, unreadable keys flagged. */
  async listForDisplay(userId: string): Promise<McpServerPublic[]> {
    return (await this.listOpened(userId)).map(openedToPublic);
  }

  /** One saved service, opened (so a caller can tell "not saved" from "saved, key unreadable"). */
  async getOpened(userId: string, serviceId: string): Promise<OpenedMcpServer | null> {
    if (!serviceId) return null;
    return (await this.listOpened(userId)).find((o) => o.cfg.id === serviceId) ?? null;
  }

  /** One USABLE saved service, WITH credentials, or null. Server-side only. */
  async get(userId: string, serviceId: string): Promise<McpServerConfig | null> {
    const o = await this.getOpened(userId, serviceId);
    return o && !o.credentialsUnreadable ? o.cfg : null;
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
      const existing: StoredMcpServer[] = (await this.readRaw(db, userId)).slice(0, MAX_SAVED_SERVICES).map(resealStored);
      const next = upsertSaved(existing, sealServer(cfg));
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
      const next = (await this.readRaw(db, userId)).filter((s) => s.id !== serviceId).map(resealStored);
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
