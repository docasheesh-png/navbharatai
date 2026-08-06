// Run SQL against a user's OWN PostgreSQL, over a plain connection string.
//
// WHY THIS EXISTS (admin 2026-08-06). Database Studio was built entirely on Supabase's Management API
// (`POST /v1/projects/{ref}/database/query`), so it could read exactly one of the eleven providers a
// user can connect. Everyone else — Neon, a Render/Railway/Aiven Postgres, their own server — opened
// Studio, saw "Sample data", and reasonably concluded the feature was broken. A shipped screen that
// tells 10 of 11 users something false is worse than one that is honestly absent.
//
// The SQL itself needs no changes: every builder in `supabaseData` is ordinary PostgreSQL against
// `information_schema` / `pg_catalog`, and `sqlSafety` already enforces read-only by WRAPPING the
// user's statement in a bounded subquery rather than by guessing at keywords. Only the transport was
// Supabase-shaped. This is the other transport.
//
// SSL IS IMPLEMENTED TO THE POSTGRES SPEC, NOT TO WHAT IS CONVENIENT. Managed providers routinely serve
// certificates signed by their own CA, so the usual shortcut is `rejectUnauthorized: false` for every
// connection — which silently turns off MITM protection on somebody's production database. Instead the
// URL's own `sslmode` decides, exactly as libpq defines it: `verify-full` / `verify-ca` VERIFY,
// `require` / `prefer` encrypt without verifying, `disable` does neither. A user who asked for
// verification gets it; a user who asked for `require` gets what they asked for and no less.

import { Client } from 'pg';

export interface PostgresQueryError {
  ok: false;
  failure: 'bad-request' | 'unauthorized' | 'api-error';
  /** Written for the USER. Never the driver's own text — that can carry table and column names. */
  message: string;
  /** The real error, for server logs and the admin report only. */
  detail?: string;
}

/** How long a single Studio query may take before we stop waiting. */
export const PG_STATEMENT_TIMEOUT_MS = 15_000;
const PG_CONNECT_TIMEOUT_MS = 10_000;

export type SslMode = 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';

/**
 * The SSL setting for a connection string, per libpq's own definition of `sslmode`.
 *
 * Returns `false` (no TLS) only for `disable`; verification is ON for `verify-ca`/`verify-full` and OFF
 * for `require`/`prefer`/`allow`. The DEFAULT when the URL says nothing is `require`-like — encrypt, do
 * not verify — because every managed Postgres requires TLS and refusing to connect without a verifiable
 * chain would make the feature unusable for most users, while connecting in CLEARTEXT would be worse
 * than both. A localhost URL gets no TLS: the sandbox's own database has no certificate. PURE.
 */
export function sslConfigFor(url: string): false | { rejectUnauthorized: boolean } {
  let host = '';
  let mode: string | null = null;
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    mode = u.searchParams.get('sslmode');
  } catch {
    mode = /[?&]sslmode=([a-z-]+)/i.exec(url)?.[1]?.toLowerCase() ?? null;
    host = /@([^/:?#]+)/.exec(url)?.[1]?.toLowerCase() ?? '';
  }
  host = host.replace(/^\[|\]$/g, '');
  if (mode === 'disable') return false;
  if (!mode && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) return false;
  if (mode === 'verify-full' || mode === 'verify-ca') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

/**
 * True for a connection string this module can actually open.
 *
 * Deliberately strict: anything that is not a Postgres URL must fall through to an honest "Studio
 * cannot read this database yet" rather than be attempted and fail with a driver error the user cannot
 * act on. PURE.
 */
export function isPostgresUrl(url: string | null | undefined): boolean {
  const raw = String(url ?? '').trim();
  return /^postgres(?:ql)?:\/\/[^\s]+$/i.test(raw);
}

/**
 * Run one statement and return its rows.
 *
 * A fresh client per query on purpose: Studio is a low-frequency, human-paced screen, and a pool held
 * open against a user's database would keep a connection slot occupied for as long as the process
 * lives — on providers whose free tiers allow a handful of connections, that is their app's slot we
 * would be sitting on. Correctness for the user's app beats a few milliseconds on our screen.
 */
export async function runPostgresQuery(
  connectionString: string,
  sql: string,
  clientFactory: (cfg: { connectionString: string; ssl: false | { rejectUnauthorized: boolean }; connectionTimeoutMillis: number; statement_timeout: number }) => Client = (cfg) => new Client(cfg as never),
): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | PostgresQueryError> {
  if (!isPostgresUrl(connectionString)) {
    return { ok: false, failure: 'bad-request', message: 'Connect your database first — Settings → App Settings → Database.' };
  }
  const client = clientFactory({
    connectionString,
    ssl: sslConfigFor(connectionString),
    connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS,
    statement_timeout: PG_STATEMENT_TIMEOUT_MS,
  });
  try {
    await client.connect();
  } catch (e) {
    return { ok: false, failure: classifyPgFailure(e), message: connectMessageFor(e), detail: String(e).slice(0, 500) };
  }
  try {
    const result = await client.query(sql);
    const rows = Array.isArray(result?.rows) ? (result.rows as Array<Record<string, unknown>>) : [];
    return { ok: true, rows };
  } catch (e) {
    return {
      ok: false,
      failure: 'api-error',
      // The driver's message quotes the failing SQL, which can carry table and column names into a
      // response — and for a `run as a change` it can carry VALUES. The real text goes to the log.
      message: 'That query could not be run against your database. Check the table and column names and try again.',
      detail: String(e).slice(0, 500),
    };
  } finally {
    try { await client.end(); } catch { /* closing a failed connection is best-effort */ }
  }
}

/** Which kind of failure — the three need different words and different HTTP statuses. PURE. */
export function classifyPgFailure(e: unknown): 'bad-request' | 'unauthorized' | 'api-error' {
  const s = String(e ?? '').toLowerCase();
  if (/password authentication failed|no pg_hba\.conf entry|role .* does not exist|permission denied/.test(s)) return 'unauthorized';
  if (/invalid connection string|invalid url|database .* does not exist/.test(s)) return 'bad-request';
  return 'api-error';
}

/**
 * What to tell the USER about a failed connection.
 *
 * Each branch names something they can actually check. "Could not connect" alone sends someone to
 * support; "your database refused the password" sends them to the one screen that fixes it.
 */
export function connectMessageFor(e: unknown): string {
  const s = String(e ?? '').toLowerCase();
  if (/password authentication failed|no pg_hba\.conf entry|role .* does not exist/.test(s)) {
    return 'Your database refused the connection details saved in NavBharatAI. Update them in Settings → App Settings → Database.';
  }
  if (/self.signed|certificate|ssl/.test(s)) {
    return 'Your database\'s secure connection could not be established. If your provider gives a connection string ending in ?sslmode=require, use that one in Settings → App Settings → Database.';
  }
  if (/timeout|etimedout|econnrefused|enotfound|ehostunreach/.test(s)) {
    return 'Your database did not answer. Check it is running and that it accepts connections from the internet — some providers block outside access until you allow it.';
  }
  return 'Could not connect to your database just now. Please try again in a moment.';
}
