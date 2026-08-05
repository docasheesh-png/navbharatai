/**
 * Reading a user's OWN database — the queries behind the Data GUI (ROADMAP #1 Phase 2.1).
 *
 * WHY THIS EXISTS. Database Studio showed `DEMO_COLLECTIONS` ("Arjun Sharma") or, if you typed a
 * collection name, NavBharatAI's OWN Firestore — never the database the user's app actually uses.
 * That is the wrong database twice over: it is not their data, and the standing constraint is that
 * NavBharatAI's Firebase project is never the store behind a user's app. Phase 1 gives every user a
 * real Supabase project; this is what reads it.
 *
 * THE SAFETY MODEL. Supabase's Management query endpoint runs SQL with elevated rights against the
 * user's own project, so every identifier that reaches a statement here is VALIDATED and then QUOTED,
 * and every number is coerced to a bounded integer. Nothing else from a request is ever interpolated.
 * The SQL builders are pure and exported precisely so that boundary is tested directly rather than
 * being an assumption about how a route happens to call them.
 *
 * READ-ONLY on purpose for 2.1. Writes (2.2) are a separate change with their own confirmation path —
 * shipping "browse" and "silently mutate" in one step is how a data GUI destroys someone's rows.
 */

export type Fetch = typeof globalThis.fetch;

const SUPABASE_API = 'https://api.supabase.com';

/** Rows per page. Bounded so a table with a million rows can never be pulled into a browser tab. */
export const MAX_ROWS = 200;
export const DEFAULT_ROWS = 50;

export interface DataError {
  ok: false;
  failure: 'unauthorized' | 'bad-request' | 'api-error';
  /** For the user. Never carries SQL or a provider's raw text. */
  message: string;
  /** For the admin diagnostics only. */
  detail?: string;
}

/**
 * The project id, from the URL we already store.
 *
 * Provisioning saves `VITE_SUPABASE_URL` into the user's secrets but never recorded the project ref
 * separately, so for every user provisioned before this change the URL is the only place it exists.
 * Callers prefer a stored ref and fall back to this — deriving is a recovery path, not the design.
 */
export function projectRefFromUrl(url: string | undefined | null): string | null {
  const m = /^https:\/\/([a-z0-9]{12,40})\.supabase\.(co|in|net)\/?$/i.exec(String(url ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Is this a name we are willing to put inside a statement?
 *
 * Postgres identifiers are far more permissive than this, and that is the point: we accept the
 * ordinary shape a generated schema produces and refuse everything else, rather than trying to prove
 * that an exotic name survives quoting intact.
 */
export function isSafeIdentifier(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name);
}

/**
 * Quote an identifier for Postgres.
 *
 * Throws on anything `isSafeIdentifier` rejects instead of returning a "best effort" string — a
 * builder that silently emits a half-escaped identifier is exactly how injection reaches the wire.
 */
export function quoteIdent(name: string): string {
  if (!isSafeIdentifier(name)) throw new Error(`unsafe identifier: ${String(name).slice(0, 40)}`);
  return `"${name}"`;
}

/** Clamp a caller-supplied count to a real, bounded integer. Junk becomes the default, never NaN. */
export function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * The user's tables, with their row counts.
 *
 * `public` only: that is where a generated schema lives, while `auth`, `storage` and the internal
 * `pg_*` schemas are Supabase's own plumbing — showing them would present machinery as "your data".
 * The count is the planner's ESTIMATE (`reltuples`), not `count(*)`: an exact count locks and scans
 * every table on every page load, which on a real database is a self-inflicted outage. A slightly
 * stale number in a sidebar is worth far more than a studio that hangs.
 */
export function listTablesSql(): string {
  return `select c.relname as table_name,
       greatest(c.reltuples::bigint, 0) as row_estimate
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r','p')
 order by c.relname`;
}

/** The columns of one table, in declaration order — the Schema view (2.3) reads the same shape. */
export function listColumnsSql(table: string): string {
  return `select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = ${literal(table)}
 order by ordinal_position`;
}

/**
 * A single-quoted string literal.
 *
 * Used ONLY for values compared inside catalogue queries (a table name matched against
 * `information_schema`), never to build an identifier — those go through `quoteIdent`. The name is
 * still validated first, so the doubling here is defence in depth rather than the only guard.
 */
function literal(value: string): string {
  if (!isSafeIdentifier(value)) throw new Error(`unsafe value: ${String(value).slice(0, 40)}`);
  return `'${value.replace(/'/g, "''")}'`;
}

/** One page of rows. Ordering is optional and, when given, must name a real column of that table. */
export function readRowsSql(opts: { table: string; limit?: number; offset?: number; orderBy?: string; desc?: boolean }): string {
  const table = quoteIdent(opts.table);
  const limit = boundedInt(opts.limit, DEFAULT_ROWS, 1, MAX_ROWS);
  const offset = boundedInt(opts.offset, 0, 0, 1_000_000);
  const order = opts.orderBy ? ` order by ${quoteIdent(opts.orderBy)} ${opts.desc ? 'desc' : 'asc'}` : '';
  return `select * from public.${table}${order} limit ${limit} offset ${offset}`;
}

/**
 * Run one statement against the user's project.
 *
 * Errors are CLASSIFIED, not thrown: a revoked grant (the user must reconnect) and a bad query (our
 * bug) need different words in front of the user, and neither should surface Supabase's raw text —
 * that goes to `detail`, which only the admin diagnostics read.
 */
export async function runQuery(
  token: string,
  projectRef: string,
  sql: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | DataError> {
  if (!token || !projectRef) {
    return { ok: false, failure: 'bad-request', message: 'Connect your database first, then open Database Studio.' };
  }
  let res: Response;
  try {
    res = await fetchImpl(`${SUPABASE_API}/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
  } catch (e) {
    return { ok: false, failure: 'api-error', detail: String(e),
      message: 'Could not reach your database just now — please try again in a moment.' };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, failure: 'unauthorized',
      message: 'NavBharatAI no longer has permission to read your database. Open Settings → Database and connect again.' };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, failure: 'api-error', detail: body.slice(0, 500),
      message: 'Your database could not be read just now. NavBharatAI has recorded the details.' };
  }
  const parsed = await res.json().catch(() => null);
  // The endpoint answers with the result array directly; anything else means the shape changed and
  // we say so rather than handing the UI something it will render as an empty, "working" table.
  if (!Array.isArray(parsed)) {
    return { ok: false, failure: 'api-error', detail: 'unexpected response shape',
      message: 'Your database returned something NavBharatAI could not read. Please try again.' };
  }
  return { ok: true, rows: parsed as Array<Record<string, unknown>> };
}

/**
 * Foreign keys OUT of this table (Phase 2.3).
 *
 * Only outgoing links, because that is the question a person browsing a row is actually asking —
 * "what does this `user_id` point at?" — and listing every table that references this one turns a
 * detail panel into a directory.
 */
export function listForeignKeysSql(table: string): string {
  return `select
       con.conname            as constraint_name,
       att.attname            as column_name,
       cl2.relname            as references_table,
       att2.attname           as references_column
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  join unnest(con.conkey)  with ordinality as k(attnum, ord) on true
  join unnest(con.confkey) with ordinality as fk(attnum, ord) on fk.ord = k.ord
  join pg_attribute att  on att.attrelid  = con.conrelid  and att.attnum  = k.attnum
  join pg_attribute att2 on att2.attrelid = con.confrelid and att2.attnum = fk.attnum
  join pg_class cl2 on cl2.oid = con.confrelid
 where con.contype = 'f' and n.nspname = 'public' and cl.relname = ${literal(table)}
 order by con.conname, k.ord`;
}

/**
 * Indexes on this table (Phase 2.3).
 *
 * Worth showing because it explains performance the user can otherwise only guess at — a table with
 * no index on the column their app filters by is the single most common reason a generated app slows
 * down as it fills up.
 */
export function listIndexesSql(table: string): string {
  return `select i.relname as index_name,
       ix.indisunique  as is_unique,
       ix.indisprimary as is_primary,
       pg_get_indexdef(ix.indexrelid) as definition
  from pg_index ix
  join pg_class t on t.oid = ix.indrelid
  join pg_class i on i.oid = ix.indexrelid
  join pg_namespace n on n.oid = t.relnamespace
 where n.nspname = 'public' and t.relname = ${literal(table)}
 order by ix.indisprimary desc, i.relname`;
}

/** Column names across a page of rows — the table header, including columns that are null in row 1. */
export function columnsOf(rows: Array<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  for (const row of rows ?? []) {
    if (row && typeof row === 'object') for (const k of Object.keys(row)) seen.add(k);
  }
  return [...seen];
}
