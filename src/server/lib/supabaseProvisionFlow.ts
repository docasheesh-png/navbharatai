// Creating the user's database — the SEQUENCE, separated from the HTTP route that used to own it.
//
// WHY THIS MODULE EXISTS (admin question 2026-08-06: "user se puchona chahiye na!"). Provisioning lived
// inside the POST /provision handler, so the only way to create a database was for the user to walk to
// Settings and press a button. A BUILD that discovers mid-flight that the app needs a database — the
// exact moment the user is actually thinking about it — had no way to offer one; the best it could do
// was print a sentence pointing at a screen. Asking is only worth building if we can act on the answer,
// so the sequence had to become callable from somewhere other than a request handler.
//
// The route is now a thin adapter: it maps this outcome onto status codes. Nothing about the ORDER of
// operations changed, and every honesty property the route had is preserved here rather than restated:
//   • "created" is not "usable" — readiness is polled, never assumed;
//   • a database created but not recorded is reported as EXISTING, so the user does not create a second
//     one and burn a free-plan slot;
//   • the schema outcome is reported SEPARATELY from the database, because they fail separately.

import crypto from 'crypto';
import {
  createProject, waitUntilReady, fetchProjectCredentials, projectNameFor, envForProject,
  applySchemaToProject, schemaSqlFromFiles, fetchPoolerConnection, databaseEnvFor, refreshAccessToken,
} from './supabaseProvision';
import { getConnection, needsRefresh, updateTokens } from './supabaseConnectionStore';
import { getServerDb } from './serverDb';
import { encrypt } from './secrets';
import { audit } from './audit';
import { loadWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';

/** Where a database is created when the caller expresses no preference. */
export const DEFAULT_REGION = 'ap-south-1';

/**
 * A Supabase access token lives about an hour, but a user connects once and builds for weeks — so an
 * expired token is renewed SILENTLY. Without this the user's second app would meet "please connect
 * again", turning one-time setup into a recurring chore.
 *
 * Returns a status rather than throwing, because the two failures need different words: a genuinely
 * revoked grant sends the user back through consent (401), while a network blip or a provider 5xx is
 * transient (502) and must never cost them a re-authorisation.
 */
export async function freshAccessToken(
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
  // Persist BEFORE spending it — a rotated refresh token that is used and not stored is a grant lost.
  await updateTokens(userId, renewed.tokens);
  return { ok: true, token: renewed.tokens.accessToken };
}

/**
 * Write the provisioned keys into the user's encrypted vault, replacing any earlier value.
 *
 * Uses the same `user_secrets` collection, the same names and the same encryption as the manual
 * Settings → Database flow, so the builder picks them up through a path that already works.
 */
export async function saveUserSecrets(userId: string, values: Record<string, string>): Promise<boolean> {
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

export interface ProvisionSuccess {
  ok: true;
  projectRef: string;
  projectName: string;
  url: string;
  /**
   * Exactly what was written into the vault. A caller that has a LIVE sandbox (a build) writes the same
   * pairs into the app's `.env` too, because the vault is only read at the START of a build — a build
   * already in flight would otherwise finish against a database it was never told about.
   */
  env: Record<string, string>;
  schemaApplied: boolean | null;
  schemaNote?: string;
  /** `direct` means no pooler was reported; that host is IPv6-only on new projects. */
  serverConnection: 'pooled' | 'direct';
}

export interface ProvisionFailure {
  ok: false;
  /** The HTTP status the route should use. 202 = the project EXISTS but is not usable yet. */
  status: number;
  error: string;
  failure?: string;
  projectRef?: string;
}

export interface ProvisionInput {
  appLabel?: string;
  region?: string;
  /** When given, the app's `migrations/*.sql` is applied so the database is not created empty. */
  workspaceId?: string;
}

/**
 * Create a Postgres database inside the USER's own Supabase account and record its keys.
 *
 * Requires an existing OAuth grant — provisioning cannot start one, because consent needs a browser.
 * A caller with no grant gets a 400 telling the user to connect first; it must never pretend it asked.
 */
export async function provisionDatabaseForUser(uid: string, input: ProvisionInput = {}): Promise<ProvisionSuccess | ProvisionFailure> {
  const conn = await getConnection(uid);
  if (!conn) return { ok: false, status: 400, error: 'Connect your Supabase account first, then create the database.' };
  if (!conn.orgId) return { ok: false, status: 400, error: 'No Supabase organization is linked. Please disconnect and connect again.' };

  const fresh = await freshAccessToken(uid, conn);
  if (!fresh.ok) return { ok: false, status: fresh.status, error: fresh.message, failure: fresh.failure };
  const accessToken = fresh.token;

  // The database password is generated here and then KEPT — encrypted, in this user's own vault,
  // beside the keys they add by hand (admin question 2026-08-06). It used to be discarded on the
  // reasoning that we had no reason to hold it. We did: Supabase never hands the password back, so
  // without it no Postgres connection string can EVER be composed, and a one-click database was
  // therefore usable only by browser-only supabase-js apps. Every server-side app — Prisma, Drizzle,
  // `pg` — got a real database in the user's account that its own code could not connect to.
  const dbPass = crypto.randomBytes(24).toString('base64url');
  const created = await createProject({
    token: accessToken,
    orgId: conn.orgId,
    name: projectNameFor(input.appLabel ?? ''),
    region: input.region || DEFAULT_REGION,
    dbPass,
  });
  if (!created.ok) {
    return { ok: false, status: created.failure === 'plan-limit' ? 409 : 502, error: created.message, failure: created.failure };
  }

  // "Created" is not "usable" — see supabaseProvision.waitUntilReady. Claiming success here would hand
  // the user a database that refuses every connection.
  const ready = await waitUntilReady(accessToken, created.project.id);
  if (!ready.ok) return { ok: false, status: 202, error: ready.message, failure: ready.failure, projectRef: created.project.id };

  const creds = await fetchProjectCredentials(accessToken, created.project.id);
  if (!creds.ok) return { ok: false, status: 202, error: creds.message, failure: creds.failure, projectRef: created.project.id };

  // A database with no tables is not "ready". The build already writes migrations/001_init.sql, so
  // apply it now — otherwise the app is wired to an EMPTY database and every query hits a table that
  // does not exist, which is the same class of nearly-true claim this feature exists to avoid.
  //
  // Reported SEPARATELY from the database itself: the project genuinely was created, so saying the
  // whole thing failed would send the user to create a second one (and burn a free-plan slot).
  let schemaApplied: boolean | null = null;
  let schemaNote: string | undefined;
  if (input.workspaceId) {
    try {
      const files = await loadWorkspaceFiles(input.workspaceId);
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
  // failed provision: the database exists either way.
  const pooler = await fetchPoolerConnection(accessToken, created.project.id);

  const env = {
    ENGINEER_DB_PROVIDER: 'supabase',
    ...envForProject(creds.credentials),
    ...databaseEnvFor(created.project.id, dbPass, pooler),
  };
  const saved = await saveUserSecrets(uid, env);
  if (!saved) {
    // The project EXISTS in their account even though we could not record it — say so, so they do not
    // create a second one chasing a database they already have.
    return {
      ok: false,
      status: 500,
      error: 'Your database was created in Supabase, but NavBharatAI could not save its keys. '
        + 'Open Settings → Database and try again — do not create another project.',
      projectRef: created.project.id,
    };
  }

  try { audit('SUPABASE_PROJECT_PROVISIONED', { userId: uid, ok: true }); } catch { /* audit never blocks */ }
  return {
    ok: true,
    projectRef: created.project.id,
    projectName: created.project.name,
    url: creds.credentials.url,
    env,
    schemaApplied,
    ...(schemaNote ? { schemaNote } : {}),
    serverConnection: pooler ? 'pooled' : 'direct',
  };
}
