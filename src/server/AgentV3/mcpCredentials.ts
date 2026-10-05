/**
 * A connected service's credentials, as they are kept at rest (Q-628, forensic audit 2026-10-04).
 *
 * 🔴 WHAT THIS REPLACED. The `headers` a user configures for an MCP service — their own bearer token or
 * API key — were written to Firestore exactly as typed, in `agentv3_mcp_servers` (one doc per app) and
 * `agentv3_mcp_library` (one doc per account). They never reached a browser, but anyone who could read
 * those collections (a backup, an export, a mis-scoped console role) read every user's key in the clear.
 *
 * NOW: the headers are sealed with the platform's secrets helper (`lib/secrets.ts`, AES-256-GCM, the same
 * key and format that already protects the vault and the bot tokens) into ONE field, `headersEnc`. A record
 * written from here never carries a `headers` field at all.
 *
 * READING BOTH SHAPES, so nothing that works today stops working:
 *  • `headersEnc` → decrypted. If it cannot be decrypted or is not a header map (a rotated-away key, a
 *    tampered value), the service is marked `credentialsUnreadable` and its headers are DROPPED — it is
 *    never called without the auth it was set up with, and the screen tells the owner to reconnect it.
 *  • `headers` (rows written before this change) → used as they are, and re-sealed the next time that
 *    document is written (and by the store's background migration on read).
 *  • neither → a service with no auth, exactly as before.
 */
import { decrypt, encrypt } from '../lib/secrets';
import type { McpServerConfig } from './mcpTransport';

/** The shape a record has in Firestore after this change. */
export interface StoredMcpServer {
  id: string;
  url: string;
  /** `encrypt(JSON.stringify(headers))`. Absent when the service has no auth. */
  headersEnc?: string;
}

/** A record read back, with the one fact a caller must not miss. */
export interface OpenedMcpServer {
  cfg: McpServerConfig;
  /** The saved key could not be read. The service must not be called; the owner must reconnect it. */
  credentialsUnreadable: boolean;
  /** Written before Q-628 with plaintext headers — to be re-sealed on the next write. */
  legacyPlaintext: boolean;
  /** Whether the user configured auth at all (shown as "key saved", never the value). */
  hasAuth: boolean;
}

function isHeaderMap(v: unknown): v is Record<string, string> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
}

/** Is this a record the stores can use at all (an id and an address)? */
export function isStoredServerShape(s: unknown): s is { id: string; url: string } {
  return !!s && typeof s === 'object'
    && typeof (s as { id?: unknown }).id === 'string'
    && typeof (s as { url?: unknown }).url === 'string';
}

/**
 * The record to WRITE. Never contains `headers`; the headers, when there are any, go into `headersEnc`.
 * Throws only when the secrets helper refuses to encrypt (production with no key configured) — the
 * stores catch that and report the save as failed, which is the truth.
 */
export function sealServer(cfg: McpServerConfig): StoredMcpServer {
  const out: StoredMcpServer = { id: cfg.id, url: cfg.url };
  const headers = isHeaderMap(cfg.headers) ? cfg.headers : {};
  if (Object.keys(headers).length > 0) out.headersEnc = encrypt(JSON.stringify(headers));
  return out;
}

/** Read one stored record, in either shape. Never throws. */
export function openServer(raw: { id: string; url: string } & Record<string, unknown>): OpenedMcpServer {
  const base: McpServerConfig = { id: raw.id, url: raw.url };
  if (typeof raw.headersEnc === 'string' && raw.headersEnc) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(decrypt(raw.headersEnc)); } catch { parsed = null; }
    if (!isHeaderMap(parsed)) {
      // FAIL CLOSED: no headers rather than wrong or missing ones sent as if they were the user's auth.
      return { cfg: base, credentialsUnreadable: true, legacyPlaintext: false, hasAuth: true };
    }
    return { cfg: { ...base, headers: parsed }, credentialsUnreadable: false, legacyPlaintext: false, hasAuth: Object.keys(parsed).length > 0 };
  }
  if (isHeaderMap(raw.headers) && Object.keys(raw.headers).length > 0) {
    return { cfg: { ...base, headers: raw.headers }, credentialsUnreadable: false, legacyPlaintext: true, hasAuth: true };
  }
  return { cfg: base, credentialsUnreadable: false, legacyPlaintext: false, hasAuth: false };
}

/**
 * Re-seal a stored record for a write that is about this document but not about this entry: a legacy
 * plaintext entry is encrypted, an already-sealed entry is kept byte for byte (even one whose key cannot
 * be read today — deleting a user's connection is their decision, not a side effect of another write).
 */
export function resealStored(raw: { id: string; url: string } & Record<string, unknown>): StoredMcpServer {
  if (typeof raw.headersEnc === 'string' && raw.headersEnc) return { id: raw.id, url: raw.url, headersEnc: raw.headersEnc };
  return sealServer(openServer(raw).cfg);
}

/** The sentence the owner reads when a service's saved key cannot be used. */
export const UNREADABLE_CREDENTIALS_MESSAGE =
  'Its saved key could not be read, so it was not used. Disconnect it and connect it again with its key.';
