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
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { MAX_SERVERS_PER_WORKSPACE } from './mcpClient';
import type { McpServerConfig } from './mcpTransport';

export const MCP_COLLECTION = 'agentv3_mcp_servers';

/** What a browser may see: no credentials. */
export interface McpServerPublic {
  id: string;
  url: string;
  /** Whether the user configured auth for it — useful to show, without revealing the value. */
  hasAuth: boolean;
}

/** Strip a stored record down to what is safe to send to a client. */
export function toPublic(cfg: McpServerConfig): McpServerPublic {
  return { id: cfg.id, url: cfg.url, hasAuth: Object.keys(cfg.headers ?? {}).length > 0 };
}

class McpServerStore {
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
   * Every connected server for a workspace, WITH credentials. Server-side only.
   *
   * Returns [] when storage is unavailable rather than throwing: a build must still run when the
   * connections cannot be read — it simply runs without the extra tools, which is today's behaviour.
   */
  async listFull(workspaceId: string): Promise<McpServerConfig[]> {
    const db = this.getDb();
    if (!db || !workspaceId) return [];
    try {
      const snap = await db.collection(MCP_COLLECTION).doc(workspaceId).get();
      const raw = snap.exists ? (snap.data()?.servers as unknown) : null;
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((s): s is McpServerConfig => !!s && typeof s === 'object'
          && typeof (s as McpServerConfig).id === 'string'
          && typeof (s as McpServerConfig).url === 'string')
        .slice(0, MAX_SERVERS_PER_WORKSPACE);
    } catch {
      return [];
    }
  }

  /** The same list, safe to send to a browser — credentials removed. */
  async listForDisplay(workspaceId: string): Promise<McpServerPublic[]> {
    return (await this.listFull(workspaceId)).map(toPublic);
  }

  /**
   * Add one server. Returns false when it could not be saved, so the caller reports the truth rather
   * than a success the user would later find missing.
   *
   * The cap is enforced HERE as well as in `canConnectServer`, because this is the last point before
   * the write — a check that lives only in the route is one a future second route can miss.
   */
  async add(workspaceId: string, cfg: McpServerConfig): Promise<boolean> {
    const db = this.getDb();
    if (!db || !workspaceId) return false;
    try {
      const existing = await this.listFull(workspaceId);
      if (existing.length >= MAX_SERVERS_PER_WORKSPACE) return false;
      if (existing.some((s) => s.id === cfg.id)) return false;
      await db.collection(MCP_COLLECTION).doc(workspaceId).set(
        { workspaceId, servers: [...existing, cfg], updatedAt: Date.now() },
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
      const existing = await this.listFull(workspaceId);
      const next = existing.filter((s) => s.id !== serverId);
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
