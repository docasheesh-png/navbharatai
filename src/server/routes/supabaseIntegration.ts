// One-click database — the HTTP surface (ROADMAP #1 Phase 1.1, slice 4).
//
// Ties the three tested cores together into the flow a user actually walks:
//   status  → "are you connected, and to which Supabase account?"
//   start   → mint PKCE + signed state, hand back the Supabase consent URL
//   callback→ verify state, exchange the code, resolve the org, store tokens ENCRYPTED
//   disconnect → forget our copy (and say plainly that Supabase must be told separately)
//
// WHAT THIS ROUTE FILE IS NOT: it does not create projects. Provisioning is a separate call so that
// connecting an account and spending it on a project stay independently retryable — a user whose
// project creation hits the free-plan cap must not have to redo consent to try again after clearing
// space.
//
// SECURITY NOTES, all enforced here rather than trusted from the client:
//  • The user is resolved from the VERIFIED Firebase token, never a body/query field. The signed
//    state carries the same uid, and the callback requires the two to be the same person — so a
//    completed consent can only ever attach to the account that began it.
//  • The state signing key is the platform's SECRET_ENCRYPTION_KEY; if it is absent the feature
//    reports itself unavailable rather than signing with a guessable constant.
//  • The PKCE verifier is held server-side, keyed by the state's nonce, with a short TTL. It never
//    travels to the browser, so an intercepted redirect cannot be replayed.
//  • No token is ever returned to the client or written to a log.

import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import {
  createPkcePair, signOAuthState, verifyOAuthState, buildSupabaseAuthorizeUrl,
  tokenExchangeBody, basicAuthHeader, parseCallbackParams, supabaseOAuthConfigured,
  connectFailureMessage, SUPABASE_TOKEN_URL, OAUTH_STATE_TTL_MS,
} from '../lib/supabaseOAuth';
import {
  listOrganizations, createProject, waitUntilReady, fetchProjectCredentials,
  projectNameFor, envForProject, refreshAccessToken, applySchemaToProject, schemaSqlFromFiles,
  fetchPoolerConnection, databaseEnvFor,
} from '../lib/supabaseProvision';
import {
  saveConnection, getConnection, getConnectionStatus, deleteConnection, needsRefresh, updateTokens,
} from '../lib/supabaseConnectionStore';
import {
  projectRefFromUrl, isSafeIdentifier, boundedInt, listTablesSql, listColumnsSql, readRowsSql,
  runQuery, columnsOf, MAX_ROWS, DEFAULT_ROWS, listForeignKeysSql, listIndexesSql, quoteIdent,
} from '../lib/supabaseData';
import { toCsv, matchColumns } from '../../lib/csv';
import { readOnlyQuery, writeQuery, QUERY_ROW_CAP } from '../lib/sqlSafety';
import {
  primaryKeySql, buildInsertSql, buildUpdateSql, buildDeleteSql, buildBulkInsertSql, verifySingleRow,
} from '../lib/supabaseWrite';
import { audit } from '../lib/audit';
import { getServerDb } from '../lib/serverDb';
import { encrypt, loadUserVaultSecrets } from '../lib/secrets';
import { loadWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';

/**
 * Default region for a new project.
 *
 * India-first is the product's whole positioning, and database latency is felt on every single
 * request — so a user in India gets a Mumbai database unless they ask for something else, rather
 * than the provider's US default.
 */
export const DEFAULT_REGION = 'ap-south-1';

/**
 * A usable access token for this user — renewed silently if the stored one is stale.
 *
 * ONE implementation on purpose (Phase 2.1). This block was written for provisioning; the Data GUI
 * needs exactly the same thing, and a second copy is how the two drift — the dangerous half being
 * the rotation persistence: Supabase may hand back a NEW refresh token, and a caller that forgets to
 * store it breaks the connection an hour later, somewhere else entirely, where the cause is nearly
 * impossible to find. Centralising it means that can only be got right or wrong once.
 *
 * Returns a status rather than throwing, because the two failures need different words: a genuinely
 * revoked grant sends the user back through consent (401), while a network blip or a provider 5xx is
 * transient (502) and must never cost them a re-authorisation.
 */
async function freshAccessToken(
  userId: string,
  conn: { accessToken: string; refreshToken: string; expiresAtMs: number },
): Promise<{ ok: true; token: string } | { ok: false; status: number; message: string; failure: string }> {
  if (!needsRefresh(conn.expiresAtMs, Date.now())) return { ok: true, token: conn.accessToken };
  const renewed = await refreshAccessToken({
    refreshToken: conn.refreshToken,
    clientId: process.env.SUPABASE_OAUTH_CLIENT_ID as string,
    clientSecret: process.env.SUPABASE_OAUTH_CLIENT_SECRET as string,
    nowMs: Date.now(),
  });
  if (!renewed.ok) {
    return { ok: false, status: renewed.failure === 'unauthorized' ? 401 : 502, message: renewed.message, failure: renewed.failure };
  }
  // Persist BEFORE spending it — see above.
  await updateTokens(userId, renewed.tokens);
  return { ok: true, token: renewed.tokens.accessToken };
}

/**
 * Write the provisioned keys into the user's encrypted vault, replacing any earlier value.
 *
 * Uses the same `user_secrets` collection, the same names and the same encryption as the manual
 * Settings → Database flow, so the builder picks them up through a path that already works.
 */
async function saveUserSecrets(userId: string, values: Record<string, string>): Promise<boolean> {
  const db = getServerDb() as any;
  if (!db) return false;
  try {
    const col = db.collection('user_secrets');
    for (const [name, value] of Object.entries(values)) {
      if (!value) continue;
      // Replace rather than accumulate — a stale duplicate would make which key wins ambiguous.
      const dupes = await col.where('user_id', '==', userId).where('secret_name', '==', name).get();
      await Promise.all(dupes.docs.map((d: { ref: { delete: () => Promise<unknown> } }) => d.ref.delete()));
      await col.add({
        user_id: userId,
        secret_name: name,
        encrypted_secret_value: encrypt(value),
        created_at: new Date(),
      });
    }
    return true;
  } catch {
    return false;
  }
}

/** What Supabase's token endpoint returns. Fields are `unknown` because they come off the wire. */
interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

/** Where Supabase sends the user back. Must byte-match the app's registered redirect URI. */
export function callbackUrl(): string {
  const base = (process.env.APP_ORIGIN || 'https://navbharatai.com').replace(/\/$/, '');
  return `${base}/api/integrations/supabase/callback`;
}

/**
 * PKCE verifiers awaiting their callback, keyed by the state nonce.
 *
 * In memory on purpose: a verifier is single-use and lives for minutes, so persisting it would add a
 * durable copy of a security value for no benefit. The cost is honest and bounded — if the instance
 * restarts mid-consent the user retries, which is why the failure message says exactly that rather
 * than something vague. Entries are swept on every insert so an abandoned flow cannot accumulate.
 */
const pendingVerifiers = new Map<string, { verifier: string; expiresAtMs: number }>();

function rememberVerifier(nonce: string, verifier: string, nowMs: number): void {
  for (const [k, v] of pendingVerifiers) if (v.expiresAtMs <= nowMs) pendingVerifiers.delete(k);
  pendingVerifiers.set(nonce, { verifier, expiresAtMs: nowMs + OAUTH_STATE_TTL_MS });
}

function takeVerifier(nonce: string, nowMs: number): string | null {
  const hit = pendingVerifiers.get(nonce);
  pendingVerifiers.delete(nonce); // single use, whatever the outcome
  if (!hit || hit.expiresAtMs <= nowMs) return null;
  return hit.verifier;
}

/** The nonce is the third dot-segment of the state we signed. */
export function nonceFromState(state: string): string {
  const parts = String(state ?? '').split('.');
  return parts.length === 4 ? parts[2] : '';
}

/** The signing key for OAuth state. Absent ⇒ the feature is unavailable (never a guessable default). */
function stateSecret(): string {
  return process.env.SECRET_ENCRYPTION_KEY || '';
}

/** A small self-closing page for the popup — never renders untrusted text as HTML. */
function closingPage(ok: boolean, message: string): string {
  const safe = String(message).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const origin = (process.env.APP_ORIGIN || 'https://navbharatai.com').replace(/\/$/, '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Supabase</title></head>
<body style="font-family:system-ui;padding:32px;text-align:center;color:#c9d1d9;background:#0d1117">
<p style="font-size:15px">${safe}</p>
<p style="font-size:13px;color:#8b949e">You can close this window.</p>
<script>
  try { (window.opener||window.parent).postMessage({ __nbaiSupabaseConnect: true, ok: ${ok ? 'true' : 'false'} }, ${JSON.stringify(origin)}); } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch (e) {} }, ${ok ? 1200 : 4000});
</script>
</body></html>`;
}

export function registerSupabaseIntegrationRoutes(
  app: Express,
  verifyFirebaseToken: (req: Request) => Promise<string | null>,
): void {
  // Is the feature available, and is this user connected? Honest about BOTH — a deployment without
  // OAuth credentials reports `available:false` instead of showing a button that cannot work (rule 2).
  app.get('/api/integrations/supabase/status', async (req: Request, res: Response) => {
    const available = supabaseOAuthConfigured() && Boolean(stateSecret());
    const uid = await verifyFirebaseToken(req);
    if (!available || !uid) {
      res.json({ available, connected: false, orgName: null, connectedAtMs: null });
      return;
    }
    res.json({ available, ...(await getConnectionStatus(uid)) });
  });

  // Begin the flow. Returns the URL to open; the client never sees the verifier.
  app.post('/api/integrations/supabase/start', async (req: Request, res: Response) => {
    if (!supabaseOAuthConfigured() || !stateSecret()) {
      res.status(503).json({ error: connectFailureMessage('not-configured') });
      return;
    }
    const uid = await verifyFirebaseToken(req);
    if (!uid) {
      res.status(401).json({ error: 'Please sign in before connecting a database.' });
      return;
    }
    const now = Date.now();
    const nonce = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = createPkcePair();
    rememberVerifier(nonce, verifier, now);
    const state = signOAuthState(stateSecret(), uid, now + OAUTH_STATE_TTL_MS, nonce);
    res.json({
      url: buildSupabaseAuthorizeUrl({
        clientId: process.env.SUPABASE_OAUTH_CLIENT_ID as string,
        redirectUri: callbackUrl(),
        state,
        codeChallenge: challenge,
      }),
    });
  });

  // Where Supabase sends the user back. Renders a small page (this is a browser navigation, not an
  // API call), so every failure below must be readable by a human, not a JSON blob.
  app.get('/api/integrations/supabase/callback', async (req: Request, res: Response) => {
    const fail = (msg: string): void => { res.status(200).type('html').send(closingPage(false, msg)); };
    if (!supabaseOAuthConfigured() || !stateSecret()) { fail(connectFailureMessage('not-configured')); return; }

    const parsed = parseCallbackParams(req.query as Record<string, unknown>);
    if (!parsed.ok) { fail(connectFailureMessage(parsed.reason)); return; }

    const now = Date.now();
    const stateCheck = verifyOAuthState(stateSecret(), parsed.state, now);
    if (!stateCheck.ok) { fail(connectFailureMessage(stateCheck.reason)); return; }

    // The signed state proves WHO began the flow; the session proves who is here now. Requiring both
    // to match is what stops a consent completed in someone else's browser from attaching there.
    const uid = await verifyFirebaseToken(req);
    if (!uid || uid !== stateCheck.userId) {
      fail('Please sign in as the same account that started this connection, then try again.');
      return;
    }

    const verifier = takeVerifier(nonceFromState(parsed.state), now);
    if (!verifier) {
      fail('This connection attempt timed out or was already used. Please tap "Connect database" again.');
      return;
    }

    let body: TokenResponse | null = null;
    try {
      const r = await fetch(SUPABASE_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: basicAuthHeader(
            process.env.SUPABASE_OAUTH_CLIENT_ID as string,
            process.env.SUPABASE_OAUTH_CLIENT_SECRET as string,
          ),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenExchangeBody({ code: parsed.code, redirectUri: callbackUrl(), codeVerifier: verifier }),
      });
      if (r.ok) body = (await r.json().catch(() => null)) as TokenResponse | null;
    } catch { /* falls through to the honest failure below */ }

    const accessToken = typeof body?.access_token === 'string' ? body.access_token : '';
    const refreshToken = typeof body?.refresh_token === 'string' ? body.refresh_token : '';
    if (!accessToken || !refreshToken) { fail(connectFailureMessage('exchange-failed')); return; }

    // Resolve the organization NOW, while we know the token is fresh. Doing it at project-creation
    // time instead would turn "your account has no organization" into a confusing failure halfway
    // through building an app, rather than at the moment the user is looking at the connect screen.
    const orgs = await listOrganizations(accessToken);
    if (!orgs.ok) { fail(orgs.message); return; }

    const expiresIn = typeof body?.expires_in === 'number' ? body.expires_in : 3600;
    const saved = await saveConnection(uid, {
      accessToken,
      refreshToken,
      expiresAtMs: now + expiresIn * 1000,
      orgId: orgs.orgs[0].id,
      orgName: orgs.orgs[0].name,
      connectedAtMs: now,
    });
    if (!saved) { fail('We could not save the connection. Please try again in a moment.'); return; }

    try { audit('SUPABASE_CONNECTED', { userId: uid, ok: true }); } catch { /* audit never blocks */ }
    res.status(200).type('html').send(closingPage(true, `Connected to ${orgs.orgs[0].name}.`));
  });

  // Spend the connection: create a real database in the user's account and wire it into their app.
  //
  // Separate from `callback` on purpose (see the header): consent and provisioning fail for different
  // reasons, and the free-plan cap in particular must be retryable without redoing consent.
  //
  // The resulting keys are written into the SAME encrypted vault, under the SAME names, that the
  // manual Settings → Database flow already uses. That is deliberate: the builder already knows how
  // to pick those up, so provisioning inherits a working path instead of introducing a second
  // convention that could drift from it.
  app.post('/api/integrations/supabase/provision', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Please sign in first.' }); return; }

    const conn = await getConnection(uid);
    if (!conn) {
      res.status(400).json({ error: 'Connect your Supabase account first, then create the database.' });
      return;
    }
    if (!conn.orgId) {
      res.status(400).json({ error: 'No Supabase organization is linked. Please disconnect and connect again.' });
      return;
    }
    // A Supabase access token lives about an hour, but a user connects once and builds for weeks — so
    // an expired token is renewed SILENTLY here. Without this the user's second app would meet
    // "please connect again", turning one-time setup into a recurring chore.
    const fresh = await freshAccessToken(uid, conn);
    if (!fresh.ok) {
      res.status(fresh.status).json({ error: fresh.message, failure: fresh.failure });
      return;
    }
    const accessToken = fresh.token;

    const appLabel = typeof (req.body ?? {}).appLabel === 'string' ? (req.body as { appLabel: string }).appLabel : '';
    const region = typeof (req.body ?? {}).region === 'string' && (req.body as { region: string }).region
      ? (req.body as { region: string }).region
      : DEFAULT_REGION;

    // The database password is generated here and then KEPT — encrypted, in this user's own vault,
    // beside the keys they add by hand (admin question 2026-08-06). It used to be discarded on the
    // reasoning that we had no reason to hold it. We did: Supabase never hands the password back, so
    // without it no Postgres connection string can EVER be composed, and a one-click database was
    // therefore usable only by browser-only supabase-js apps. Every server-side app — Prisma, Drizzle,
    // `pg` — got a real database in the user's account that its own code could not connect to.
    // It is the user's password, in the user's vault, written only into the user's app.
    const dbPass = crypto.randomBytes(24).toString('base64url');
    const created = await createProject({
      token: accessToken,
      orgId: conn.orgId,
      name: projectNameFor(appLabel),
      region,
      dbPass,
    });
    if (!created.ok) {
      res.status(created.failure === 'plan-limit' ? 409 : 502)
        .json({ error: created.message, failure: created.failure });
      return;
    }

    // "Created" is not "usable" — see supabaseProvision.waitUntilReady. Claiming success here would
    // hand the user a database that refuses every connection.
    const ready = await waitUntilReady(accessToken, created.project.id);
    if (!ready.ok) {
      res.status(202).json({ error: ready.message, failure: ready.failure, projectRef: created.project.id });
      return;
    }

    const creds = await fetchProjectCredentials(accessToken, created.project.id);
    if (!creds.ok) {
      res.status(202).json({ error: creds.message, failure: creds.failure, projectRef: created.project.id });
      return;
    }

    // A database with no tables is not "ready". The build already writes migrations/001_init.sql, so
    // apply it now — otherwise the app is wired to an EMPTY database and every query hits a table
    // that does not exist, which is the same class of nearly-true claim this feature exists to avoid.
    //
    // Reported SEPARATELY from the database itself: the project genuinely was created, so saying the
    // whole thing failed would send the user to create a second one (and burn a free-plan slot). The
    // schema outcome is its own field the client can surface honestly.
    let schemaApplied: boolean | null = null;
    let schemaNote: string | undefined;
    const workspaceId = typeof (req.body ?? {}).workspaceId === 'string' ? (req.body as { workspaceId: string }).workspaceId : '';
    if (workspaceId) {
      try {
        const files = await loadWorkspaceFiles(workspaceId);
        const sql = schemaSqlFromFiles(files || {});
        if (sql) {
          const applied = await applySchemaToProject(accessToken, created.project.id, sql);
          schemaApplied = applied.ok;
          if (!applied.ok) schemaNote = applied.message;
        }
      } catch {
        // Reading the workspace is best-effort; a database with no schema applied is still a real,
        // usable database, and we say so rather than failing the whole provision.
        schemaApplied = null;
      }
    }

    // Ask Supabase where this project's pooler is, rather than inventing the hostname — see
    // fetchPoolerConnection. A missing pooler is a DOWNGRADE (we write the direct URL instead), never a
    // failed provision: the database exists either way and saying otherwise would send the user to
    // create a second one and burn a free-plan slot.
    const pooler = await fetchPoolerConnection(accessToken, created.project.id);

    const saved = await saveUserSecrets(uid, {
      ENGINEER_DB_PROVIDER: 'supabase',
      ...envForProject(creds.credentials),
      ...databaseEnvFor(created.project.id, dbPass, pooler),
    });
    if (!saved) {
      // The project EXISTS in their account even though we could not record it — say so, so they do
      // not create a second one chasing a database they already have.
      res.status(500).json({
        error: 'Your database was created in Supabase, but NavBharatAI could not save its keys. '
          + 'Open Settings → Database and try again — do not create another project.',
        projectRef: created.project.id,
      });
      return;
    }

    try { audit('SUPABASE_PROJECT_PROVISIONED', { userId: uid, ok: true }); } catch { /* audit never blocks */ }
    res.json({
      ok: true,
      projectRef: created.project.id,
      projectName: created.project.name,
      url: creds.credentials.url,
      schemaApplied,
      // What the app can actually DO with this database, stated plainly. `pooled: false` means we could
      // not read the pooler endpoint and wrote the direct connection instead — that host is IPv6-only
      // on new Supabase projects, so a container-hosted app may not reach it. The client can say so
      // rather than the user discovering it as a connection error later.
      serverConnection: pooler ? 'pooled' : 'direct',
      ...(schemaNote ? { schemaNote } : {}),
    });
  });

  // ── Data GUI (ROADMAP #1 Phase 2.1) ────────────────────────────────────────────────────────────
  // Read the user's OWN database. Until now Database Studio showed demo rows, or — if you typed a
  // collection name — NavBharatAI's own Firestore, which is the wrong database twice over: not the
  // user's data, and a store that must never back a user's app.
  //
  // READ-ONLY. Writes are Phase 2.2 with their own confirmation path; shipping "browse" and "silently
  // mutate" together is how a data GUI destroys someone's rows.

  /**
   * Everything a data read needs, resolved from the VERIFIED user: a live token and their project.
   *
   * The project ref is derived from the `VITE_SUPABASE_URL` we already store, because provisioning
   * never recorded the ref separately — so for users provisioned before Phase 2.1 the URL is the only
   * place it exists. `projectRefFromUrl` refuses anything that is not a real Supabase project URL,
   * so a custom domain yields an honest "not connected" rather than a call aimed at a guessed ref.
   */
  async function resolveDataAccess(req: Request): Promise<
    { ok: true; token: string; projectRef: string } | { ok: false; status: number; error: string }
  > {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return { ok: false, status: 401, error: 'Please sign in first.' };
    const conn = await getConnection(uid);
    if (!conn) return { ok: false, status: 400, error: 'Connect your database first — Settings → Database.' };
    const fresh = await freshAccessToken(uid, conn);
    if (!fresh.ok) return { ok: false, status: fresh.status, error: fresh.message };
    const secrets = await loadUserVaultSecrets(uid).catch(() => ({} as Record<string, string>));
    const projectRef = projectRefFromUrl(secrets.VITE_SUPABASE_URL);
    if (!projectRef) {
      return { ok: false, status: 400, error: 'No database is set up for your account yet. Create one in Settings → Database.' };
    }
    return { ok: true, token: fresh.token, projectRef };
  }

  /** Turn a classified data failure into a response — the provider's own text never goes out. */
  function sendDataError(res: Response, err: { failure: string; message: string; detail?: string }): void {
    if (err.detail) console.error(`[SUPABASE-DATA] ${err.failure}: ${err.detail}`);
    res.status(err.failure === 'unauthorized' ? 401 : err.failure === 'bad-request' ? 400 : 502)
      .json({ error: err.message, failure: err.failure });
  }

  // The sidebar: which tables exist, and roughly how many rows each holds.
  app.get('/api/integrations/supabase/tables', async (req: Request, res: Response) => {
    const access = await resolveDataAccess(req);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    const result = await runQuery(access.token, access.projectRef, listTablesSql());
    if (!result.ok) { sendDataError(res, result); return; }
    res.json({
      tables: result.rows.map((r) => ({
        name: String(r.table_name ?? ''),
        rowEstimate: Number(r.row_estimate ?? 0),
      })).filter((t) => t.name),
    });
  });

  // One page of one table, plus its columns so the header is right even when a column is null
  // throughout the page.
  app.get('/api/integrations/supabase/rows', async (req: Request, res: Response) => {
    const table = typeof req.query.table === 'string' ? req.query.table : '';
    if (!isSafeIdentifier(table)) {
      res.status(400).json({ error: 'That table name is not one NavBharatAI can read.' });
      return;
    }
    const access = await resolveDataAccess(req);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }

    const limit = boundedInt(req.query.limit, DEFAULT_ROWS, 1, MAX_ROWS);
    const offset = boundedInt(req.query.offset, 0, 0, 1_000_000);
    const orderBy = typeof req.query.orderBy === 'string' && isSafeIdentifier(req.query.orderBy) ? req.query.orderBy : undefined;
    const desc = req.query.desc === '1' || req.query.desc === 'true';

    const [rows, columns] = await Promise.all([
      runQuery(access.token, access.projectRef, readRowsSql({ table, limit, offset, orderBy, desc })),
      runQuery(access.token, access.projectRef, listColumnsSql(table)),
    ]);
    if (!rows.ok) { sendDataError(res, rows); return; }
    // The column list is a nicety: a page of rows is still worth showing if the catalogue read fails,
    // so we fall back to the keys actually present rather than failing the whole request.
    const declared = columns.ok
      ? columns.rows.map((c) => String(c.column_name ?? '')).filter(Boolean)
      : [];
    res.json({
      table,
      rows: rows.rows,
      columns: declared.length ? declared : columnsOf(rows.rows),
      limit,
      offset,
      // Honest paging without a count(*): a full page MIGHT have more after it, and we say "might"
      // rather than inventing a total we did not measure.
      hasMore: rows.rows.length === limit,
    });
  });

  // Phase 2.3 — the shape of one table (columns, types, nullability, defaults).
  app.get('/api/integrations/supabase/columns', async (req: Request, res: Response) => {
    const table = typeof req.query.table === 'string' ? req.query.table : '';
    if (!isSafeIdentifier(table)) {
      res.status(400).json({ error: 'That table name is not one NavBharatAI can read.' });
      return;
    }
    const access = await resolveDataAccess(req);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    const result = await runQuery(access.token, access.projectRef, listColumnsSql(table));
    if (!result.ok) { sendDataError(res, result); return; }
    res.json({
      table,
      columns: result.rows.map((c) => ({
        name: String(c.column_name ?? ''),
        type: String(c.data_type ?? ''),
        nullable: String(c.is_nullable ?? '').toUpperCase() === 'YES',
        default: c.column_default === null || c.column_default === undefined ? null : String(c.column_default),
      })).filter((c) => c.name),
    });
  });

  // ── Writing a row (ROADMAP #1 Phase 2.2) ───────────────────────────────────────────────────────
  // Reading a table wrong shows the wrong screen; writing one wrong destroys data, with no undo. The
  // guarantees live in supabaseWrite.ts (no primary key ⇒ no write; every value literalised by one
  // encoder that throws rather than guesses); these routes add the two things only the server can do:
  // ask the database what the key actually IS, and verify afterwards that exactly one row changed.

  /** The table's real primary key, from the database's own catalogue — never inferred from a name. */
  async function primaryKeyOf(token: string, projectRef: string, table: string): Promise<string[] | null> {
    const result = await runQuery(token, projectRef, primaryKeySql(table));
    if (!result.ok) return null;
    return result.rows.map((r) => String(r.column_name ?? '')).filter(Boolean);
  }

  /** The table's declared columns, so a payload naming a column that does not exist is refused. */
  async function columnNamesOf(token: string, projectRef: string, table: string): Promise<string[]> {
    const result = await runQuery(token, projectRef, listColumnsSql(table));
    if (!result.ok) return [];
    return result.rows.map((r) => String(r.column_name ?? '')).filter(Boolean);
  }

  /**
   * Everything the three write routes share: access, a valid table, its key and its columns.
   *
   * A table with NO primary key is refused here, once, with a message that explains the reason rather
   * than a generic failure — "we can't identify a single row" is something the user can act on (add a
   * primary key), while "write failed" sends them to support.
   */
  async function prepareWrite(req: Request, res: Response): Promise<
    { ok: true; token: string; projectRef: string; table: string; pk: string[]; columns: string[] } | { ok: false }
  > {
    const table = typeof req.body?.table === 'string' ? req.body.table : '';
    if (!isSafeIdentifier(table)) {
      res.status(400).json({ error: 'That table name is not one NavBharatAI can write to.' });
      return { ok: false };
    }
    const access = await resolveDataAccess(req);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return { ok: false }; }
    const [pk, columns] = await Promise.all([
      primaryKeyOf(access.token, access.projectRef, table),
      columnNamesOf(access.token, access.projectRef, table),
    ]);
    if (pk === null) {
      res.status(502).json({ error: 'Could not read that table just now — please try again in a moment.' });
      return { ok: false };
    }
    if (pk.length === 0) {
      res.status(409).json({
        error: `The table "${table}" has no primary key, so NavBharatAI cannot tell one row from another and will not risk changing the wrong one. Add a primary key to this table to edit it here.`,
        failure: 'no-primary-key',
      });
      return { ok: false };
    }
    return { ok: true, token: access.token, projectRef: access.projectRef, table, pk, columns };
  }

  /** Run one write and report what genuinely changed. A builder's refusal is the user's answer. */
  async function runWrite(res: Response, token: string, projectRef: string, build: () => string): Promise<void> {
    let sql: string;
    try {
      sql = build();
    } catch (e) {
      // These throws are the guarantees doing their job (no key, unknown column, unstorable value),
      // so the reason goes to the user — it is actionable, and never contains their data.
      res.status(400).json({ error: e instanceof Error ? e.message : 'That change could not be saved.' });
      return;
    }
    const result = await runQuery(token, projectRef, sql);
    if (!result.ok) { sendDataError(res, result); return; }
    const verified = verifySingleRow(result.rows);
    if (!verified.ok) { res.status(409).json({ error: verified.message }); return; }
    res.json({ ok: true, row: verified.row });
  }

  app.post('/api/integrations/supabase/row', async (req: Request, res: Response) => {
    const prep = await prepareWrite(req, res);
    if (!prep.ok) return;
    const values = (req.body?.values ?? {}) as Record<string, unknown>;
    await runWrite(res, prep.token, prep.projectRef, () =>
      buildInsertSql({ table: prep.table, values, columns: prep.columns }));
  });

  app.patch('/api/integrations/supabase/row', async (req: Request, res: Response) => {
    const prep = await prepareWrite(req, res);
    if (!prep.ok) return;
    const values = (req.body?.values ?? {}) as Record<string, unknown>;
    const key = (req.body?.key ?? {}) as Record<string, unknown>;
    await runWrite(res, prep.token, prep.projectRef, () =>
      buildUpdateSql({ table: prep.table, values, key, pkColumns: prep.pk, columns: prep.columns }));
  });

  // DELETE with a body: the key identifies the row and can be composite, so it does not fit a path
  // segment. Express parses a JSON body on DELETE the same as any other method.
  app.delete('/api/integrations/supabase/row', async (req: Request, res: Response) => {
    const prep = await prepareWrite(req, res);
    if (!prep.ok) return;
    const key = (req.body?.key ?? {}) as Record<string, unknown>;
    await runWrite(res, prep.token, prep.projectRef, () =>
      buildDeleteSql({ table: prep.table, key, pkColumns: prep.pk }));
  });

  // The UI needs the key BEFORE it offers an edit control, so a table it cannot safely write is shown
  // read-only with the reason, instead of offering a Save that will fail.
  app.get('/api/integrations/supabase/primary-key', async (req: Request, res: Response) => {
    const table = typeof req.query.table === 'string' ? req.query.table : '';
    if (!isSafeIdentifier(table)) { res.status(400).json({ error: 'That table name is not one NavBharatAI can read.' }); return; }
    const access = await resolveDataAccess(req);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    const pk = await primaryKeyOf(access.token, access.projectRef, table);
    if (pk === null) { res.status(502).json({ error: 'Could not read that table just now.' }); return; }
    res.json({ table, primaryKey: pk, editable: pk.length > 0 });
  });

  // Phase 2.3 — the rest of the table's shape: what it points at, and what it is indexed on.
  app.get('/api/integrations/supabase/relations', async (req: Request, res: Response) => {
    const table = typeof req.query.table === 'string' ? req.query.table : '';
    if (!isSafeIdentifier(table)) { res.status(400).json({ error: 'That table name is not one NavBharatAI can read.' }); return; }
    const access = await resolveDataAccess(req);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    const [fks, indexes] = await Promise.all([
      runQuery(access.token, access.projectRef, listForeignKeysSql(table)),
      runQuery(access.token, access.projectRef, listIndexesSql(table)),
    ]);
    if (!fks.ok) { sendDataError(res, fks); return; }
    res.json({
      table,
      foreignKeys: fks.rows.map((r) => ({
        name: String(r.constraint_name ?? ''),
        column: String(r.column_name ?? ''),
        referencesTable: String(r.references_table ?? ''),
        referencesColumn: String(r.references_column ?? ''),
      })).filter((f) => f.column && f.referencesTable),
      // Indexes are additive: losing them should not cost the user the relations they asked for.
      indexes: indexes.ok ? indexes.rows.map((r) => ({
        name: String(r.index_name ?? ''),
        unique: r.is_unique === true,
        primary: r.is_primary === true,
        definition: String(r.definition ?? ''),
      })).filter((i) => i.name) : [],
    });
  });

  // Phase 2.4 — run the user's own SQL.
  //
  // Read-only is the DEFAULT and is enforced by Postgres, not by inspecting the text: the statement
  // is wrapped as a subquery, where a write is not even grammatical and a data-modifying CTE is
  // rejected outright (see sqlSafety.ts — a keyword check waves that CTE straight through).
  //
  // Writing is possible, because a data GUI that cannot run a migration is half a tool — but only
  // when the caller explicitly says so, having confirmed it in the UI. Either way it is ONE
  // statement: the user confirmed what they read, and they only read the first one.
  app.post('/api/integrations/supabase/query', async (req: Request, res: Response) => {
    const sql = typeof req.body?.sql === 'string' ? req.body.sql : '';
    const wantsWrite = req.body?.allowWrite === true;
    const access = await resolveDataAccess(req);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }

    const prepared = wantsWrite ? writeQuery(sql) : readOnlyQuery(sql);
    if (!prepared.ok) { res.status(400).json({ error: prepared.message }); return; }

    const started = Date.now();
    const result = await runQuery(access.token, access.projectRef, prepared.sql);
    if (!result.ok) { sendDataError(res, result); return; }
    // A write reports what it did; a read reports what it found. Neither invents a number.
    res.json({
      ok: true,
      readOnly: !wantsWrite,
      rows: result.rows,
      columns: columnsOf(result.rows),
      rowCount: result.rows.length,
      // Honest about the cap: a read that fills it may have had more behind it.
      capped: !wantsWrite && result.rows.length >= QUERY_ROW_CAP,
      elapsedMs: Date.now() - started,
    });
  });

  // ── CSV import / export (ROADMAP #1 Phase 2.5) ─────────────────────────────────────────────────

  /** One export pull. Bounded: an unbounded "export everything" is a way to fall over on a big table. */
  const EXPORT_MAX_ROWS = 5000;
  /** Rows per INSERT. Large enough to be quick, small enough that one statement stays sane. */
  const IMPORT_BATCH = 200;

  // Export a table as CSV. Honest about the cap: the header says how many rows came out, and whether
  // there were more behind them, instead of implying the file is the whole table.
  app.get('/api/integrations/supabase/export', async (req: Request, res: Response) => {
    const table = typeof req.query.table === 'string' ? req.query.table : '';
    if (!isSafeIdentifier(table)) { res.status(400).json({ error: 'That table name is not one NavBharatAI can read.' }); return; }
    const access = await resolveDataAccess(req);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }

    const limit = boundedInt(req.query.limit, EXPORT_MAX_ROWS, 1, EXPORT_MAX_ROWS);
    // Ask for one more than we will emit, so "there is more" is something we OBSERVED rather than guessed.
    const probe = await runQuery(access.token, access.projectRef,
      `select * from public.${quoteIdent(table)} limit ${limit + 1}`);
    if (!probe.ok) { sendDataError(res, probe); return; }
    const truncated = probe.rows.length > limit;
    const rows = truncated ? probe.rows.slice(0, limit) : probe.rows;

    const columnsResult = await runQuery(access.token, access.projectRef, listColumnsSql(table));
    const columns = columnsResult.ok
      ? columnsResult.rows.map((c) => String(c.column_name ?? '')).filter(Boolean)
      : columnsOf(rows);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${table}.csv"`);
    // A header the client reads to tell the user the file is partial — the file itself stays clean CSV,
    // because a warning comment inside it would corrupt the data for every other tool.
    res.setHeader('X-Nbai-Row-Count', String(rows.length));
    res.setHeader('X-Nbai-Truncated', truncated ? '1' : '0');
    res.send(toCsv(rows, columns));
  });

  /**
   * Import rows into a table.
   *
   * PARTIAL IMPORTS ARE REPORTED, NOT HIDDEN. Rows go in batches, and each batch is atomic — so a
   * failure leaves earlier batches applied. Pretending otherwise ("import failed") would send the
   * user to re-run the whole file and duplicate everything that did land. The response says exactly
   * how many rows were written and where it stopped.
   */
  app.post('/api/integrations/supabase/import', async (req: Request, res: Response) => {
    const table = typeof req.body?.table === 'string' ? req.body.table : '';
    if (!isSafeIdentifier(table)) { res.status(400).json({ error: 'That table name is not one NavBharatAI can write to.' }); return; }
    const incoming = Array.isArray(req.body?.rows) ? req.body.rows as Array<Record<string, unknown>> : [];
    if (incoming.length === 0) { res.status(400).json({ error: 'There are no rows to import.' }); return; }

    const access = await resolveDataAccess(req);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }

    const tableColumns = await columnNamesOf(access.token, access.projectRef, table);
    if (tableColumns.length === 0) {
      res.status(502).json({ error: 'Could not read that table just now — please try again in a moment.' });
      return;
    }
    // Only columns the table actually has. The UNKNOWN ones are named back to the user rather than
    // dropped in silence: a file whose header is "e-mail" against a column "email" would otherwise
    // import every row with that field empty and call it a success.
    const headers = [...new Set(incoming.flatMap((r) => Object.keys(r ?? {})))];
    const { usable, unknown } = matchColumns(headers, tableColumns);
    if (usable.length === 0) {
      res.status(400).json({
        error: `None of the columns in this file match "${table}". The table has: ${tableColumns.join(', ')}.`,
        unknownColumns: unknown,
      });
      return;
    }

    let imported = 0;
    let failure: string | null = null;
    for (let i = 0; i < incoming.length; i += IMPORT_BATCH) {
      const batch = incoming.slice(i, i + IMPORT_BATCH);
      let sql: string;
      try {
        sql = buildBulkInsertSql({ table, columns: usable, rows: batch });
      } catch (e) {
        failure = e instanceof Error ? e.message : 'Some rows could not be imported.';
        break;
      }
      const result = await runQuery(access.token, access.projectRef, sql);
      if (!result.ok) {
        if (result.detail) console.error(`[SUPABASE-IMPORT] ${result.failure}: ${result.detail}`);
        failure = result.message;
        break;
      }
      imported += result.rows.length;
    }

    res.json({
      ok: failure === null,
      imported,
      total: incoming.length,
      unknownColumns: unknown,
      ...(failure ? { error: failure } : {}),
    });
  });

  // Forget our copy. Deliberately explicit that this does NOT revoke the grant on Supabase's side —
  // implying we revoked something we did not would be a lie about a security-relevant action.
  app.post('/api/integrations/supabase/disconnect', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Please sign in first.' }); return; }
    const ok = await deleteConnection(uid);
    try { audit('SUPABASE_DISCONNECTED', { userId: uid, ok }); } catch { /* audit never blocks */ }
    res.json({
      ok,
      note: 'NavBharatAI has forgotten your Supabase connection. To fully revoke access, remove the '
        + 'NavBharatAI app in your Supabase account settings as well.',
    });
  });
}
