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
} from '../lib/supabaseProvision';
import {
  saveConnection, getConnection, getConnectionStatus, deleteConnection, needsRefresh, updateTokens,
} from '../lib/supabaseConnectionStore';
import { audit } from '../lib/audit';
import { getServerDb } from '../lib/serverDb';
import { encrypt } from '../lib/secrets';
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
    let accessToken = conn.accessToken;
    if (needsRefresh(conn.expiresAtMs, Date.now())) {
      const renewed = await refreshAccessToken({
        refreshToken: conn.refreshToken,
        clientId: process.env.SUPABASE_OAUTH_CLIENT_ID as string,
        clientSecret: process.env.SUPABASE_OAUTH_CLIENT_SECRET as string,
        nowMs: Date.now(),
      });
      if (!renewed.ok) {
        // Only a genuinely revoked grant sends the user back through consent; a network blip or a
        // provider 5xx is transient and must not cost them a re-authorisation.
        res.status(renewed.failure === 'unauthorized' ? 401 : 502)
          .json({ error: renewed.message, failure: renewed.failure });
        return;
      }
      accessToken = renewed.tokens.accessToken;
      // Persist BEFORE spending it: Supabase may have rotated the refresh token, and losing that
      // rotation silently breaks the connection an hour later, where the cause is very hard to see.
      await updateTokens(uid, renewed.tokens);
    }

    const appLabel = typeof (req.body ?? {}).appLabel === 'string' ? (req.body as { appLabel: string }).appLabel : '';
    const region = typeof (req.body ?? {}).region === 'string' && (req.body as { region: string }).region
      ? (req.body as { region: string }).region
      : DEFAULT_REGION;

    // The database password is generated here, used once, and never shown or stored by us. The user
    // can reset it in their own Supabase dashboard; keeping a copy would be a credential we have no
    // reason to hold.
    const created = await createProject({
      token: accessToken,
      orgId: conn.orgId,
      name: projectNameFor(appLabel),
      region,
      dbPass: crypto.randomBytes(24).toString('base64url'),
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

    const saved = await saveUserSecrets(uid, {
      ENGINEER_DB_PROVIDER: 'supabase',
      ...envForProject(creds.credentials),
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
      ...(schemaNote ? { schemaNote } : {}),
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
