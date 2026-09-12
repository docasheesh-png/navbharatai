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
import { encrypt, secretCreatedAtMs, loadUserVaultRows } from './secrets';
import { planSecretWrite } from './secretScope';
import { appHasOwnDatabase, reusableDatabase } from './databaseReuse';
import { audit } from './audit';
import { loadWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { projectRefFromUrl } from './supabaseData';

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
export async function saveUserSecrets(
  userId: string,
  values: Record<string, string>,
  // WHICH APP ARE THESE FOR? (2026-09-12). Absent ⇒ shared with every app, which is what this function
  // always did — so no existing caller changes. The provisioning path now passes the workspace, so a
  // database written for one app stops appearing in the `.env` of every other app the user builds.
  workspaceId?: string | null,
): Promise<boolean> {
  const db = getServerDb() as any;
  if (!db) return false;
  const scope = String(workspaceId ?? '').trim() || null;
  try {
    const col = db.collection('user_secrets');
    for (const [name, value] of Object.entries(values)) {
      if (!value) continue;
      // Replace rather than accumulate — a stale duplicate would make which key wins ambiguous.
      //
      // 🔒 SCOPE-AWARE SINCE 2026-09-12, and the old version was destructive. It deleted EVERY row of
      // that name, so provisioning a database wiped a key the user had deliberately tied to one of
      // their other apps. Only rows of the SAME scope are this write's to replace. One shared decision —
      // `planSecretWrite` — governs both this path and the Settings save, so the two cannot drift.
      const dupes = await col.where('user_id', '==', userId).where('secret_name', '==', name).get();
      const plan = planSecretWrite(
        dupes.docs.map((d: any) => ({
          id: d.id,
          workspaceId: d.data()?.workspace_id ?? null,
          createdAt: secretCreatedAtMs(d.data()?.created_at),
          deleted: !!d.data()?.deleted,
        })),
        scope,
      );
      if (plan.replace) {
        await col.doc(plan.replace).update({
          encrypted_secret_value: encrypt(value),
          workspace_id: scope,
          created_at: new Date(),
          deleted: false,
        });
        // Soft-delete, like every other path that retires a secret — the vault has never destroyed a
        // user's stored key, and a cleanup is not the place to start.
        for (const id of plan.retire) await col.doc(id).update({ deleted: true });
      } else {
        await col.add({
          user_id: userId,
          secret_name: name,
          encrypted_secret_value: encrypt(value),
          workspace_id: scope,
          created_at: new Date(),
        });
      }
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
  /**
   * TRUE when no project was created because the user already had a database and it was attached to
   * this app instead. Reported rather than hidden: "created" would be a fake success, and the user
   * needs to know their Supabase plan was not spent.
   *
   * `fromWorkspaceId` is the app it came from, NOT its name — resolving a name needs the conversation
   * store, which lives with the routes, and a lib importing a route is the cycle that ends in an
   * import nobody can untangle. The route turns it into a name the user recognises.
   */
  reused?: true;
  fromWorkspaceId?: string;
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
  /**
   * Create a genuinely NEW project even though the user already has a database.
   *
   * The escape hatch for someone who wants this app's data kept apart. Off by default, because the
   * common case is a user reaching for the data they already have, and a free Supabase plan has only
   * two project slots to spend.
   */
  forceNew?: boolean;
}

/**
 * Create a Postgres database inside the USER's own Supabase account and record its keys.
 *
 * Requires an existing OAuth grant — provisioning cannot start one, because consent needs a browser.
 * A caller with no grant gets a 400 telling the user to connect first; it must never pretend it asked.
 */
export async function provisionDatabaseForUser(uid: string, input: ProvisionInput = {}): Promise<ProvisionSuccess | ProvisionFailure> {
  // ── DO THEY ALREADY HAVE ONE? ───────────────────────────────────────────────────────────────────
  //
  // Asked BEFORE the OAuth grant is checked, and that order is deliberate: reusing a database the user
  // already has needs no Supabase account access at all, so a user whose grant has since lapsed can
  // still wire their existing database into a new app instead of meeting "connect Supabase first" for
  // something that requires nothing from Supabase.
  //
  // 🔒 This is also where the leak is closed. A database used to be written SHARED, so every later app
  // received it without asking. Now it reaches an app only when the user presses the button on THAT
  // app — and pressing it hands them the one they have rather than spending a project slot.
  const workspace = String(input.workspaceId ?? '').trim();
  if (workspace && !input.forceNew) {
    const rows = await loadUserVaultRows(uid).catch(() => []);
    if (!appHasOwnDatabase(rows, workspace)) {
      const existing = reusableDatabase(rows, workspace);
      if (existing) {
        // Copy it into THIS app's scope. The values are the user's own and never leave the server.
        if (!await saveUserSecrets(uid, existing.env, workspace)) {
          return {
            ok: false,
            status: 500,
            error: 'Your database could not be attached to this app just now. Nothing was changed — please try again.',
          };
        }
        try { audit('SUPABASE_DATABASE_REUSED', { userId: uid, ok: true }); } catch { /* audit never blocks */ }
        return {
          ok: true,
          reused: true,
          ...(existing.workspaceId ? { fromWorkspaceId: existing.workspaceId } : {}),
          projectRef: projectRefFromUrl(existing.env.VITE_SUPABASE_URL) ?? '',
          projectName: '',
          url: existing.env.VITE_SUPABASE_URL,
          env: existing.env,
          // Nothing was created, so nothing was migrated. `null` is "not attempted", which is what the
          // caller already renders as neither success nor failure — saying `true` would claim we set up
          // tables we never touched.
          schemaApplied: null,
          serverConnection: existing.env.DATABASE_URL && existing.env.DATABASE_URL !== existing.env.DIRECT_URL
            ? 'pooled' : 'direct',
        };
      }
    }
  }

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
  // Scoped to the app it was made for. Before this, a database created for one app was written shared
  // and landed in the `.env` of every app the user built afterwards — see databaseReuse.ts.
  const saved = await saveUserSecrets(uid, env, input.workspaceId);
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
