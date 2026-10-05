/**
 * The services a workspace has connected (MCP).
 *
 * Collection: `agentv3_mcp_servers`
 * Doc ID:     `<workspaceId>` — one document holding that workspace's short list, because the cap is
 *             5 and a document-per-server would cost a query where an array costs a read.
 *
 * Pattern mirrors `DeploymentStore`: VITEST-skip so tests never touch Firestore, best-effort so a
 * storage problem can never fail a build, and set+merge so a missing document is created atomically.
 *
 * 🔒 WHAT IS STORED, AND WHAT IS NOT.
 *
 * The `headers` a user configures are their own API key for their own service. They are stored so the
 * connection keeps working across sessions — but they are never returned by the LIST path, because
 * that answer reaches a browser. `listForDisplay` returns the id and url only; the full record with
 * headers is read solely by the server when it is about to make a call. Two functions rather than one
 * optional flag, so a call site cannot leak a key by forgetting an argument.
 *
 * A connected server is also never shared between workspaces or users: the document id IS the
 * workspace, so there is no path that returns someone else's connection.
 *
 * 🔒 AND THE HEADERS ARE ENCRYPTED AT REST (Q-628). They are written only as `headersEnc`
 * (mcpCredentials.ts, AES-256-GCM via lib/secrets.ts); rows written before that still read, and are
 * re-sealed on the next write or by the background migration a read starts. A service whose saved key
 * cannot be decrypted is never called — `listFull` leaves it out, and the screen says it needs
 * reconnecting.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { MAX_SERVERS_PER_WORKSPACE } from './mcpClient';
import type { McpServerConfig } from './mcpTransport';
import { isStoredServerShape, openServer, resealStored, sealServer, type OpenedMcpServer } from './mcpCredentials';

export const MCP_COLLECTION = 'agentv3_mcp_servers';

/** What a browser may see: no credentials. */
export interface McpServerPublic {
  id: string;
  url: string;
  /** Whether the user configured auth for it — useful to show, without revealing the value. */
  hasAuth: boolean;
  /** Its saved key could not be read; it is not used until the owner connects it again. */
  needsReconnect?: boolean;
}

/** Strip a stored record down to what is safe to send to a client — and say whether its key is usable. */
export function openedToPublic(o: OpenedMcpServer): McpServerPublic {
  return { id: o.cfg.id, url: o.cfg.url, hasAuth: o.hasAuth, ...(o.credentialsUnreadable ? { needsReconnect: true } : {}) };
}

type RawEntry = { id: string; url: string } & Record<string, unknown>;

/** The well-formed entries of a stored `servers` array. */
export function rawEntries(data: unknown): RawEntry[] {
  const raw = (data as { servers?: unknown } | undefined)?.servers;
  return Array.isArray(raw) ? (raw.filter(isStoredServerShape) as RawEntry[]) : [];
}

export class McpServerStore {
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

  /** The stored entries, as written. THROWS on a read failure — a write must never treat "could not
   *  read" as "empty" and overwrite the user's connections with a shorter list. */
  private async readRaw(db: admin.firestore.Firestore, workspaceId: string): Promise<RawEntry[]> {
    const snap = await db.collection(MCP_COLLECTION).doc(workspaceId).get();
    return snap.exists ? rawEntries(snap.data()) : [];
  }

  /**
   * Re-seal rows written before Q-628, in a transaction so a concurrent connect is never lost.
   * Started by a read that found one; best-effort — the rows keep working either way, and the next
   * write seals them too.
   */
  private migrateLegacy(db: admin.firestore.Firestore, workspaceId: string): void {
    const ref = db.collection(MCP_COLLECTION).doc(workspaceId);
    void Promise.resolve()
      .then(() => db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const raw = snap.exists ? rawEntries(snap.data()) : [];
        if (!raw.some((r) => openServer(r).legacyPlaintext)) return;
        t.set(ref, { servers: raw.map(resealStored), updatedAt: Date.now() }, { merge: true });
      }))
      .catch(() => { /* the plaintext rows still work; the next write seals them */ });
  }

  /** Every stored server, opened, with whether its key is usable. Server-side only. [] when unreadable. */
  async listOpened(workspaceId: string): Promise<OpenedMcpServer[]> {
    const db = this.getDb();
    if (!db || !workspaceId) return [];
    try {
      const opened = (await this.readRaw(db, workspaceId)).slice(0, MAX_SERVERS_PER_WORKSPACE).map(openServer);
      if (opened.some((o) => o.legacyPlaintext)) this.migrateLegacy(db, workspaceId);
      return opened;
    } catch {
      return [];
    }
  }

  /**
   * Every USABLE connected server for a workspace, WITH credentials. Server-side only.
   *
   * A server whose saved key cannot be decrypted is left out: calling it without the auth it was set up
   * with would be a call the user never made. `unreadableIds` names those, for the build to say so.
   *
   * Returns [] when storage is unavailable rather than throwing: a build must still run when the
   * connections cannot be read — it simply runs without the extra tools, which is today's behaviour.
   */
  async listFull(workspaceId: string): Promise<McpServerConfig[]> {
    return (await this.listOpened(workspaceId)).filter((o) => !o.credentialsUnreadable).map((o) => o.cfg);
  }

  /** The ids of connected servers whose saved key cannot be read (they are not used). */
  async unreadableIds(workspaceId: string): Promise<string[]> {
    return (await this.listOpened(workspaceId)).filter((o) => o.credentialsUnreadable).map((o) => o.cfg.id);
  }

  /** The same list, safe to send to a browser — credentials removed, unreadable keys flagged. */
  async listForDisplay(workspaceId: string): Promise<McpServerPublic[]> {
    return (await this.listOpened(workspaceId)).map(openedToPublic);
  }

  /**
   * Add one server. Returns false when it could not be saved, so the caller reports the truth rather
   * than a success the user would later find missing.
   *
   * The cap is enforced HERE as well as in `canConnectServer`, because this is the last point before
   * the write — a check that lives only in the route is one a future second route can miss.
   * The new server's headers are sealed; every other entry is kept (a legacy one is sealed too).
   */
  async add(workspaceId: string, cfg: McpServerConfig): Promise<boolean> {
    const db = this.getDb();
    if (!db || !workspaceId) return false;
    try {
      const existing = await this.readRaw(db, workspaceId);
      if (existing.length >= MAX_SERVERS_PER_WORKSPACE) return false;
      if (existing.some((s) => s.id === cfg.id)) return false;
      await db.collection(MCP_COLLECTION).doc(workspaceId).set(
        { workspaceId, servers: [...existing.map(resealStored), sealServer(cfg)], updatedAt: Date.now() },
        { merge: true },
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Remove one server by id. True when it is gone (including when it was never there). */
  async remove(workspaceId: string, serverId: string): Promise<boolean> {
    const db = this.getDb();
    if (!db || !workspaceId) return false;
    try {
      const next = (await this.readRaw(db, workspaceId)).filter((s) => s.id !== serverId).map(resealStored);
      await db.collection(MCP_COLLECTION).doc(workspaceId).set(
        { workspaceId, servers: next, updatedAt: Date.now() },
        { merge: true },
      );
      return true;
    } catch {
      return false;
    }
  }
}

export const mcpServerStore = new McpServerStore();
