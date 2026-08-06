// Supabase Management API — creating the user's database INSIDE their own account (Phase 1.1, slice 2).
//
// This is the half that talks to Supabase. `supabaseOAuth.ts` produced the access token; this module
// spends it: find the user's organization, create a project there, wait for it to come up, and read
// back the two values the generated app actually needs (project URL + anon key).
//
// THE RULE THIS PROTECTS. CLAUDE.md: user apps never run on NavBharatAI's billing. Everything here
// happens in the USER's Supabase organization with a token THEY granted, so the project, the data and
// the bill are theirs. We are doing the work, not owning the resource.
//
// HONESTY IS THE HARD PART, NOT THE HTTP. Provisioning fails in ways that are entirely normal and must
// never look like our bug:
//   • Supabase's FREE plan allows 2 projects per organization. A user already at the cap gets a 402/403
//     that means "your account is full", not "NavBharatAI is broken" — so it is its own outcome with
//     its own instruction, never a generic failure. (This is the single most likely real-world failure
//     and the admin was warned about it before the feature was designed.)
//   • A project is NOT usable the moment the API returns; it takes tens of seconds to come up. Reporting
//     success at creation time would hand the user a database that refuses connections — the same class
//     of lie as "provisioning PostgreSQL…" printed while nothing was provisioning (autopsy ca5a4ca8).
//     So `ready` is EARNED by polling until the project reports ACTIVE_HEALTHY.
//   • A token can be revoked by the user at any time. That is a re-connect prompt, not an error page.
//
// `fetch` is injected everywhere, so every branch above is unit-tested without a network.

/** Supabase Management API base. Fixed — never taken from user input. */
export const SUPABASE_API = 'https://api.supabase.com';

/** How the caller should react — the whole point of classifying instead of throwing a bare Error. */
export type ProvisionFailure =
  | 'org-missing'      // the grant carried no organization we can create in
  | 'plan-limit'       // the user's Supabase plan has no room for another project
  | 'unauthorized'     // token expired or revoked → ask them to reconnect
  | 'rate-limited'     // Supabase throttled us → retry later
  | 'timeout'          // created, but did not come up in time
  | 'api-error';       // anything else, with Supabase's own message carried through

export interface ProvisionError {
  ok: false;
  failure: ProvisionFailure;
  /** A message written for the USER, telling them what to do next. */
  message: string;
  /** Supabase's own words, for the admin diagnostics report only. */
  detail?: string;
}

export interface SupabaseOrg { id: string; name: string }
export interface CreatedProject { id: string; name: string; region: string }
/** What the generated app is actually wired with. */
export interface ProjectCredentials { projectRef: string; url: string; anonKey: string }

type Fetch = typeof globalThis.fetch;

const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

/**
 * Turn an HTTP status into an outcome the caller can act on.
 *
 * 402/403 on a CREATE is the free-plan cap far more often than a permissions problem, because the
 * scope was granted seconds earlier by the user themself — so it is reported as the thing the user can
 * actually fix rather than as "access denied", which would send them hunting for the wrong cause.
 */
export function classifyStatus(status: number, body: string, phase: 'create' | 'read'): ProvisionError {
  const detail = body?.slice(0, 500) || undefined;
  if (status === 401) {
    return { ok: false, failure: 'unauthorized', detail,
      message: 'Your Supabase connection has expired. Please connect Supabase again from Settings → Database.' };
  }
  if ((status === 402 || status === 403) && phase === 'create') {
    return { ok: false, failure: 'plan-limit', detail,
      message: 'Your Supabase account has no room for another project — the free plan allows 2. '
        + 'Delete a project you no longer need in Supabase, or upgrade there, then try again.' };
  }
  if (status === 403) {
    return { ok: false, failure: 'unauthorized', detail,
      message: 'NavBharatAI does not have permission to do this in your Supabase account. Please reconnect and accept the requested permissions.' };
  }
  if (status === 429) {
    return { ok: false, failure: 'rate-limited', detail,
      message: 'Supabase is busy right now. Please try again in a minute.' };
  }
  return { ok: false, failure: 'api-error', detail,
    message: 'Supabase could not complete this request. Please try again in a moment.' };
}

/**
 * List the organizations this grant can create in.
 *
 * A grant with no organization is a real, silent dead end (it happens when the user consents on an
 * account that owns none), so it gets its own outcome instead of an empty list the caller might treat
 * as success.
 */
export async function listOrganizations(
  token: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<{ ok: true; orgs: SupabaseOrg[] } | ProvisionError> {
  let res: Response;
  try {
    res = await fetchImpl(`${SUPABASE_API}/v1/organizations`, { headers: authHeaders(token) });
  } catch (e) {
    return { ok: false, failure: 'api-error', detail: String(e),
      message: 'We could not reach Supabase. Please check your connection and try again.' };
  }
  if (!res.ok) return classifyStatus(res.status, await res.text().catch(() => ''), 'read');
  const raw = (await res.json().catch(() => null)) as unknown;
  const orgs = Array.isArray(raw)
    ? raw.filter((o): o is SupabaseOrg => !!o && typeof (o as SupabaseOrg).id === 'string')
        .map((o) => ({ id: o.id, name: typeof o.name === 'string' ? o.name : o.id }))
    : [];
  if (orgs.length === 0) {
    return { ok: false, failure: 'org-missing',
      message: 'No Supabase organization was found on your account. Create one in Supabase (it is free), then connect again.' };
  }
  return { ok: true, orgs };
}

/** Project names must be recognisable in the user's own Supabase dashboard, months later. */
export function projectNameFor(appLabel: string | null | undefined): string {
  const base = String(appLabel ?? '').trim().replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 40).trim();
  return base ? `${base} (NavBharatAI)` : 'NavBharatAI app';
}

export interface CreateProjectInput {
  token: string;
  orgId: string;
  name: string;
  region: string;
  /** Generated by the caller from a CSPRNG and stored encrypted — never logged, never shown. */
  dbPass: string;
}

/** Create the project. Returns as soon as Supabase accepts it — it is NOT usable yet (see waitUntilReady). */
export async function createProject(
  input: CreateProjectInput,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<{ ok: true; project: CreatedProject } | ProvisionError> {
  let res: Response;
  try {
    res = await fetchImpl(`${SUPABASE_API}/v1/projects`, {
      method: 'POST',
      headers: authHeaders(input.token),
      body: JSON.stringify({
        organization_id: input.orgId,
        name: input.name,
        region: input.region,
        db_pass: input.dbPass,
      }),
    });
  } catch (e) {
    return { ok: false, failure: 'api-error', detail: String(e),
      message: 'We could not reach Supabase. Please check your connection and try again.' };
  }
  if (!res.ok) return classifyStatus(res.status, await res.text().catch(() => ''), 'create');
  const body = (await res.json().catch(() => null)) as { id?: unknown; name?: unknown; region?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) {
    return { ok: false, failure: 'api-error',
      message: 'Supabase accepted the request but did not return a project. Please check your Supabase dashboard before retrying.' };
  }
  return { ok: true, project: {
    id,
    name: typeof body?.name === 'string' ? body.name : input.name,
    region: typeof body?.region === 'string' ? body.region : input.region,
  } };
}

/** The only status that means "you can connect to it now". */
export const PROJECT_READY_STATUS = 'ACTIVE_HEALTHY';

export interface WaitOptions {
  /** Total budget. A fresh Supabase project routinely needs well over a minute. */
  timeoutMs?: number;
  /** Gap between polls. */
  intervalMs?: number;
  /** Injected so tests do not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so tests control elapsed time. */
  now?: () => number;
}

/**
 * Poll until the project is genuinely usable.
 *
 * This is the function that keeps the feature honest. Without it we would report success the instant
 * the API returned and hand the user a database that refuses every connection — exactly the failure
 * class the DB-provisioning autopsy called out ("we announced provisioning at the moment we stopped
 * trying"). A timeout here is reported as a timeout, never as success.
 */
export async function waitUntilReady(
  token: string,
  projectRef: string,
  opts: WaitOptions = {},
  fetchImpl: Fetch = globalThis.fetch,
): Promise<{ ok: true } | ProvisionError> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const intervalMs = opts.intervalMs ?? 5_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const started = now();
  for (;;) {
    let res: Response | null = null;
    try {
      res = await fetchImpl(`${SUPABASE_API}/v1/projects/${projectRef}`, { headers: authHeaders(token) });
    } catch { /* a transient network blip must not end the wait — keep polling within the budget */ }
    if (res && res.ok) {
      const body = (await res.json().catch(() => null)) as { status?: unknown } | null;
      if (body?.status === PROJECT_READY_STATUS) return { ok: true };
    } else if (res && (res.status === 401 || res.status === 403)) {
      // Authorisation cannot recover by waiting — fail fast instead of burning the whole budget.
      return classifyStatus(res.status, await res.text().catch(() => ''), 'read');
    }
    if (now() - started >= timeoutMs) {
      return { ok: false, failure: 'timeout',
        message: 'Your database was created but is still starting up in Supabase. '
          + 'It usually takes a couple of minutes — open Settings → Database and tap Refresh shortly.' };
    }
    await sleep(intervalMs);
  }
}

/**
 * Read back the two values the generated app is wired with.
 *
 * The anon key is the PUBLIC, row-level-security-scoped key — the one that belongs in a client app.
 * The service-role key is deliberately NOT fetched: nothing in a generated frontend should ever hold
 * a key that bypasses RLS, and not fetching it means we cannot leak it.
 */
export async function fetchProjectCredentials(
  token: string,
  projectRef: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<{ ok: true; credentials: ProjectCredentials } | ProvisionError> {
  let res: Response;
  try {
    res = await fetchImpl(`${SUPABASE_API}/v1/projects/${projectRef}/api-keys`, { headers: authHeaders(token) });
  } catch (e) {
    return { ok: false, failure: 'api-error', detail: String(e),
      message: 'We could not reach Supabase to read your project keys. Please try again.' };
  }
  if (!res.ok) return classifyStatus(res.status, await res.text().catch(() => ''), 'read');
  const raw = (await res.json().catch(() => null)) as unknown;
  const keys = Array.isArray(raw) ? raw as Array<{ name?: unknown; api_key?: unknown }> : [];
  const anon = keys.find((k) => k?.name === 'anon');
  const anonKey = typeof anon?.api_key === 'string' ? anon.api_key : '';
  if (!anonKey) {
    return { ok: false, failure: 'api-error',
      message: 'Your database was created but its public key could not be read yet. Open Settings → Database and tap Refresh in a moment.' };
  }
  return { ok: true, credentials: { projectRef, url: `https://${projectRef}.supabase.co`, anonKey } };
}

/** A refreshed grant. `refreshToken` may be rotated by the provider, so callers must store it back. */
export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
}

/**
 * Exchange a refresh token for a new access token (Phase 1.2).
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. A Supabase access token lives about an hour, but a user
 * connects once and then builds apps for weeks. Without this, the SECOND app they create would meet
 * "your connection expired, please connect again" — turning a one-time setup into a recurring chore
 * and quietly undoing the entire point of Phase 1.
 *
 * Two failure modes, deliberately distinguished, because the right user action differs:
 *   • `unauthorized` — the grant is gone (revoked in their Supabase account, or the refresh token was
 *     already rotated away). Only reconnecting fixes this, so we say exactly that.
 *   • anything else — network, 5xx, throttling. Transient; the caller may retry without dragging the
 *     user through consent again. Treating these as "revoked" would send people to re-authorise for
 *     a blip that would have cleared on its own.
 *
 * ROTATION: Supabase may return a NEW refresh token, in which case the old one stops working. We
 * always return whatever came back (falling back to the one we sent only when none was returned), and
 * the caller persists it — dropping a rotated token silently breaks the connection an hour later, at
 * which point the cause is very hard to see.
 */
export async function refreshAccessToken(
  input: { refreshToken: string; clientId: string; clientSecret: string; nowMs: number },
  fetchImpl: Fetch = globalThis.fetch,
): Promise<{ ok: true; tokens: RefreshedTokens } | ProvisionError> {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', input.refreshToken);

  let res: Response;
  try {
    res = await fetchImpl(`${SUPABASE_API}/v1/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
  } catch (e) {
    return { ok: false, failure: 'api-error', detail: String(e),
      message: 'We could not reach Supabase to renew your connection. Please try again in a moment.' };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 400 is how OAuth reports an invalid/expired/rotated grant — it means reconnect, not "retry".
    if (res.status === 400 || res.status === 401) {
      return { ok: false, failure: 'unauthorized', detail: text.slice(0, 500),
        message: 'Your Supabase connection is no longer valid. Please connect Supabase again from Settings → Database.' };
    }
    return classifyStatus(res.status, text, 'read');
  }

  const data = (await res.json().catch(() => null)) as
    { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } | null;
  const accessToken = typeof data?.access_token === 'string' ? data.access_token : '';
  if (!accessToken) {
    return { ok: false, failure: 'api-error',
      message: 'Supabase did not return a renewed connection. Please try again in a moment.' };
  }
  const expiresIn = typeof data?.expires_in === 'number' ? data.expires_in : 3600;
  return { ok: true, tokens: {
    accessToken,
    // Keep the OLD refresh token when none is returned — some responses omit it and it stays valid.
    refreshToken: typeof data?.refresh_token === 'string' && data.refresh_token
      ? data.refresh_token
      : input.refreshToken,
    expiresAtMs: input.nowMs + expiresIn * 1000,
  } };
}

/**
 * Apply the app's schema to the freshly created project (ROADMAP #1 Phase 1.2 remainder).
 *
 * WITHOUT THIS THE FEATURE IS HALF-DONE. One-click provisioning hands the user an EMPTY database:
 * the app is wired to it, but every query hits a table that does not exist. The build already writes
 * `migrations/001_init.sql`; this is what actually runs it, so "your database is ready" is true rather
 * than nearly true.
 *
 * Failures are classified, not thrown, because they mean different things to the user:
 *   • `unauthorized` — the grant no longer covers this, or was revoked → reconnect.
 *   • `api-error` with Supabase's own message — almost always a real SQL error in the generated
 *     schema. That belongs in the admin diagnostics (it is OUR bug to fix), while the user is told
 *     plainly that the tables were not created rather than being shown raw SQL.
 *
 * Deliberately NOT wrapped in a transaction here: Supabase's query endpoint runs the statement batch
 * as given, and a generated `001_init.sql` is CREATE-only. Silently wrapping it would change the
 * semantics of SQL we did not write.
 */
export async function applySchemaToProject(
  token: string,
  projectRef: string,
  sql: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<{ ok: true } | ProvisionError> {
  const trimmed = String(sql ?? '').trim();
  if (!trimmed) {
    // Nothing to apply is not a failure — plenty of apps have no schema yet.
    return { ok: true };
  }
  let res: Response;
  try {
    res = await fetchImpl(`${SUPABASE_API}/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ query: trimmed }),
    });
  } catch (e) {
    return { ok: false, failure: 'api-error', detail: String(e),
      message: 'Your database was created, but we could not set up its tables. Open Settings → Database and try again.' };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) return classifyStatus(res.status, body, 'read');
    return { ok: false, failure: 'api-error', detail: body.slice(0, 500),
      message: 'Your database was created, but its tables could not be set up. NavBharatAI has recorded the details — please try again in a moment.' };
  }
  return { ok: true };
}

/** Pick the schema SQL out of a workspace file map. Pure — the caller supplies the files. */
export function schemaSqlFromFiles(files: Record<string, string>): string {
  // `migrations/001_init.sql` is what generate_migration writes. Any other .sql under migrations/ is
  // applied too, in path order, so a multi-step schema is not silently truncated to its first file.
  const paths = Object.keys(files ?? {})
    .filter((p) => /(^|\/)migrations\/.*\.sql$/i.test(p))
    .sort();
  return paths.map((p) => files[p]).filter(Boolean).join('\n\n');
}

/** The env pairs written into the generated app — the SAME names the existing scaffolder already uses. */
export function envForProject(c: ProjectCredentials): Record<string, string> {
  return { VITE_SUPABASE_URL: c.url, VITE_SUPABASE_ANON_KEY: c.anonKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CONNECTION STRING (admin question 2026-08-06: "mitrify me db hai, is liye preview nahi chal raha")
//
// Until now a one-click database stored exactly two values: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
// Those only work through supabase-js, from the browser. Every SERVER-side app — Prisma, Drizzle, `pg`,
// which is most real apps and specifically the one the admin was debugging — needs a Postgres connection
// string, and we wrote none. So the user could click "create my database", genuinely get a real Postgres
// in their own account, and their app still could not connect to it. The feature was only ever finished
// for frontend-only apps.
//
// That also means the generated password can no longer be thrown away. It is the user's own project
// password, kept in the user's own encrypted vault beside their other keys, and written only into their
// own app's `.env`. Without it no connection string can ever be composed — Supabase does not hand the
// password back — so discarding it did not protect the user, it just made the database unusable.
// ─────────────────────────────────────────────────────────────────────────────

/** The connection pooler in front of a project's Postgres, as Supabase reports it. */
export interface PoolerConnection {
  host: string;
  /** Session-mode port. See databaseUrlsFor for why we do not use transaction mode. */
  port: number;
  user: string;
  database: string;
}

/** Session-mode pooler port — a drop-in Postgres connection for every client and every migration tool. */
export const POOLER_SESSION_PORT = 5432;

/**
 * Read the project's pooler endpoint.
 *
 * WHY ASK INSTEAD OF DERIVING IT: the pooler host is region-specific
 * (`aws-0-<region>.pooler.supabase.com`), and a hostname we invent is a hostname that silently stops
 * resolving the day the provider changes it — shipping a `DATABASE_URL` that looks right and connects
 * to nothing. The API knows; we ask. When it cannot tell us, the caller falls back to the DIRECT host,
 * which needs only the project ref and has been stable for years.
 *
 * Returns null rather than an error: no pooler is a downgrade, never a failed provision.
 */
export async function fetchPoolerConnection(
  token: string,
  projectRef: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<PoolerConnection | null> {
  let res: Response;
  try {
    res = await fetchImpl(`${SUPABASE_API}/v1/projects/${projectRef}/config/database/pooler`, { headers: authHeaders(token) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const raw = (await res.json().catch(() => null)) as unknown;
  return parsePoolerConfig(raw, projectRef);
}

/**
 * Pull a usable pooler endpoint out of whatever shape the API returned.
 *
 * Deliberately shape-tolerant: this endpoint has been documented as both a single object and a list of
 * per-database entries, and a strict parser would turn a working pooler into a silent fallback. We take
 * the first entry that names a host and fill the rest from Supabase's own conventions. PURE.
 */
export function parsePoolerConfig(raw: unknown, projectRef: string): PoolerConnection | null {
  const entries = Array.isArray(raw) ? raw : [raw];
  for (const e of entries) {
    const o = (e ?? {}) as Record<string, unknown>;
    const host = typeof o.db_host === 'string' ? o.db_host.trim() : '';
    if (!host) continue;
    const user = typeof o.db_user === 'string' && o.db_user.trim() ? o.db_user.trim() : `postgres.${projectRef}`;
    const database = typeof o.db_name === 'string' && o.db_name.trim() ? o.db_name.trim() : 'postgres';
    return { host, port: POOLER_SESSION_PORT, user, database };
  }
  return null;
}

/** The direct (non-pooled) host for a project. Derived from the ref alone, so it always exists. */
export function directDatabaseUrl(projectRef: string, password: string): string {
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`;
}

/** The pooled connection string. */
export function pooledDatabaseUrl(pooler: PoolerConnection, password: string): string {
  return `postgresql://${encodeURIComponent(pooler.user)}:${encodeURIComponent(password)}`
    + `@${pooler.host}:${pooler.port}/${pooler.database}`;
}

/**
 * The env pairs a SERVER-side app needs to talk to this database.
 *
 * `DATABASE_URL` prefers the POOLER, for one reason that decides it: a direct Supabase connection is
 * IPv6-only on new projects, and the build sandbox — like most container networks — is IPv4. The
 * pooler answers on IPv4, which is precisely why Supabase documents it for containerised and serverless
 * apps. Falling back to direct when no pooler is reported is still better than writing nothing, and the
 * app's own connection error then says so honestly.
 *
 * We take SESSION mode (port 5432), never transaction mode (6543). Transaction mode needs
 * `?pgbouncer=true` for Prisma and breaks prepared statements for some drivers, so it would make the
 * URL correct for one stack and wrong for another. Session mode behaves like plain Postgres for every
 * client, which is the only sane default when we do not know what the app will use.
 *
 * `DIRECT_URL` is always the unpooled one — it is Prisma's convention for running migrations while the
 * runtime uses the pooler, and it is inert for every app that does not read it. PURE.
 */
export function databaseEnvFor(projectRef: string, password: string, pooler: PoolerConnection | null): Record<string, string> {
  if (!projectRef || !password) return {};
  const direct = directDatabaseUrl(projectRef, password);
  return {
    DATABASE_URL: pooler ? pooledDatabaseUrl(pooler, password) : direct,
    DIRECT_URL: direct,
  };
}
