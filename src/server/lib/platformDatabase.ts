// A database NavBharatAI resells — created in OUR Supabase org, on OUR bill.
//
// This is the opposite of supabaseProvision.ts, where the project lives in the user's own org and
// the bill is theirs. Here a project we cannot hand over must be deleted, because an idle Supabase
// project keeps costing us whether or not the user got the keys. Nothing in this file touches the
// wallet. The caller charges only after `ok: true`, and deletes again if that charge does not land.

import crypto from 'crypto';
import {
  createProject, waitUntilReady, fetchProjectCredentials, fetchPoolerConnection, deleteProject,
  projectNameFor, envForProject, databaseEnvFor,
  type PoolerConnection,
} from './supabaseProvision';

export interface PlatformSupabaseConfig {
  token: string;
  orgId: string;
  region: string;
}

/** Null when the platform org is not configured. Callers charge ₹0 and say so. */
export function platformSupabaseConfig(env: NodeJS.ProcessEnv = process.env): PlatformSupabaseConfig | null {
  const token = String(env.NAVBHARAT_SUPABASE_TOKEN ?? '').trim();
  const orgId = String(env.NAVBHARAT_SUPABASE_ORG ?? '').trim();
  if (!token || !orgId) return null;
  const region = String(env.NAVBHARAT_SUPABASE_REGION ?? '').trim() || 'ap-south-1';
  return { token, orgId, region };
}

export interface PlatformDbDeps {
  createProject: typeof createProject;
  waitUntilReady: typeof waitUntilReady;
  fetchProjectCredentials: typeof fetchProjectCredentials;
  fetchPoolerConnection: (token: string, projectRef: string) => Promise<PoolerConnection | null>;
  deleteProject: typeof deleteProject;
  password: () => string;
}

const defaultDeps: PlatformDbDeps = {
  createProject,
  waitUntilReady,
  fetchProjectCredentials,
  fetchPoolerConnection,
  deleteProject,
  password: () => crypto.randomBytes(24).toString('base64url'),
};

export type PlatformDatabaseResult =
  | { ok: true; projectRef: string; url: string; env: Record<string, string> }
  | { ok: false; message: string; cleaned: boolean };

/**
 * Create a project, wait until Supabase says it is healthy, and return the keys.
 *
 * Any failure after a project id exists deletes it. `cleaned: false` means the delete did not
 * succeed — the caller must still not charge, and must not pretend it is gone.
 * The password is inside `env` and nowhere else. This function does not log it.
 */
export async function createPlatformDatabase(
  input: { token: string; orgId: string; region: string; appLabel?: string | null; timeoutMs?: number },
  deps: Partial<PlatformDbDeps> = {},
): Promise<PlatformDatabaseResult> {
  const d = { ...defaultDeps, ...deps };
  const dbPass = d.password();
  const created = await d.createProject({
    token: input.token,
    orgId: input.orgId,
    name: projectNameFor(input.appLabel),
    region: input.region,
    dbPass,
  });
  if (!created.ok) return { ok: false, message: created.message, cleaned: true };

  const discard = async (message: string): Promise<PlatformDatabaseResult> => {
    const gone = await d.deleteProject(input.token, created.project.id).catch(() => ({ ok: false as const }));
    return {
      ok: false,
      cleaned: gone.ok === true,
      message: gone.ok
        ? message
        : `${message} It could not be confirmed deleted, and nothing was charged.`,
    };
  };

  const ready = await d.waitUntilReady(input.token, created.project.id, { timeoutMs: input.timeoutMs ?? 150_000 });
  if (!ready.ok) {
    return discard('The database did not become ready, so it was removed. Nothing was charged.');
  }
  const creds = await d.fetchProjectCredentials(input.token, created.project.id);
  if (!creds.ok) {
    return discard('The database came up but its keys could not be read, so it was removed. Nothing was charged.');
  }
  const pooler = await d.fetchPoolerConnection(input.token, created.project.id).catch(() => null);
  const env = {
    ENGINEER_DB_PROVIDER: 'supabase',
    ...envForProject(creds.credentials),
    ...databaseEnvFor(created.project.id, dbPass, pooler),
  };
  return { ok: true, projectRef: created.project.id, url: creds.credentials.url, env };
}
