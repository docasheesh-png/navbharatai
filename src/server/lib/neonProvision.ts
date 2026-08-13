/**
 * neonProvision — REAL per-app PostgreSQL provisioning on Neon (api.neon.tech) for MANAGED backend
 * hosting ("Deploy to NavBharatAI Cloud").
 *
 * WHY NEON, WHY HERE: a managed user backend needs a database the moment it boots, and on the
 * managed tier the platform provisions it (unlike BYO, where the standing rule keeps the DB on the
 * user's own account — that rule is untouched; this module only serves the managed tier). Neon is
 * the fit because a project scales to zero when idle and the API is project-per-tenant by design —
 * one API call per user app, no shared-database tenancy games.
 *
 * HONESTY (same contract as renderDeploy.ts): without NEON_API_KEY every entry point reports
 * `configured:false` with the exact next action; with the key it makes REAL API calls; no path ever
 * fabricates a connection string. The request BUILDERS are pure so the exact API shapes are
 * unit-tested without a live key.
 */

const NEON_API_BASE = 'https://console.neon.tech/api/v2';

/** True when the platform's Neon key is present (managed DB provisioning can run). */
export function neonConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.NEON_API_KEY === 'string' && env.NEON_API_KEY.trim().length > 0;
}

/** Honest requirement line when Neon can't provision yet. */
export function neonRequirement(): string {
  return 'Set NEON_API_KEY on the server (Neon console → Account settings → API keys) to enable managed databases.';
}

/** Neon region for new projects. Default is Singapore — closest Neon region to the Mumbai Cloud Run
 * fleet; overridable per environment without a deploy. */
export function neonRegionId(env: NodeJS.ProcessEnv = process.env): string {
  const v = (env.MANAGED_BACKEND_NEON_REGION ?? '').trim();
  return v || 'aws-ap-southeast-1';
}

export interface NeonRequest {
  url: string;
  method: 'GET' | 'POST' | 'DELETE';
  headers: Record<string, string>;
  body?: string;
}

function neonHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/** Build the "create one project for this app" request. Pure + tested. */
export function buildCreateProjectRequest(apiKey: string, projectName: string, regionId: string): NeonRequest {
  return {
    url: `${NEON_API_BASE}/projects`,
    method: 'POST',
    headers: neonHeaders(apiKey),
    body: JSON.stringify({ project: { name: projectName, region_id: regionId } }),
  };
}

/** Build the "delete this project" request (app deletion cleanup). Pure + tested. */
export function buildDeleteProjectRequest(apiKey: string, projectId: string): NeonRequest {
  return {
    url: `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}`,
    method: 'DELETE',
    headers: neonHeaders(apiKey),
  };
}

/**
 * Parse Neon's create-project response down to what the engine stores. Neon returns the ready-to-use
 * connection URI at `connection_uris[0].connection_uri` on creation — the ONE moment it is available
 * without a separate password reset, so the caller must persist it. Pure + tested.
 */
export function parseCreateProjectResponse(json: any): { projectId: string; connectionUri: string } | null {
  const id = json?.project?.id;
  const uri = Array.isArray(json?.connection_uris) ? json.connection_uris[0]?.connection_uri : undefined;
  if (typeof id !== 'string' || !id || typeof uri !== 'string' || !uri.startsWith('postgres')) return null;
  return { projectId: id, connectionUri: uri };
}

export type NeonProvisionResult =
  | { ok: true; projectId: string; connectionUri: string }
  | { ok: false; reason: 'not-configured' | 'api-error'; message: string };

/**
 * Create the app's database project on Neon and return its connection string. Honest at every
 * branch. `fetchImpl` injected for tests; defaults to global fetch.
 */
export async function provisionNeonDatabase(
  opts: { projectName: string; env?: NodeJS.ProcessEnv },
  fetchImpl: typeof fetch = fetch,
): Promise<NeonProvisionResult> {
  const env = opts.env ?? process.env;
  const key = (env.NEON_API_KEY ?? '').trim();
  if (!key) return { ok: false, reason: 'not-configured', message: neonRequirement() };
  try {
    const req = buildCreateProjectRequest(key, opts.projectName, neonRegionId(env));
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = typeof json?.message === 'string' ? ` — ${json.message}` : '';
      return { ok: false, reason: 'api-error', message: `Neon API returned ${res.status} while creating the database${detail}.` };
    }
    const parsed = parseCreateProjectResponse(json);
    if (!parsed) {
      return { ok: false, reason: 'api-error', message: 'Neon created the project but the response carried no connection URI — check the Neon console before retrying.' };
    }
    return { ok: true, ...parsed };
  } catch (e) {
    return { ok: false, reason: 'api-error', message: `Could not reach the Neon API: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export type NeonDeleteResult = { ok: true } | { ok: false; message: string };

/** Delete the app's Neon project (called on app deletion — data goes with it, caller confirms first). */
export async function deleteNeonDatabase(
  projectId: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<NeonDeleteResult> {
  const key = (env.NEON_API_KEY ?? '').trim();
  if (!key) return { ok: false, message: neonRequirement() };
  try {
    const req = buildDeleteProjectRequest(key, projectId);
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
    // 404 counts as deleted — the goal state ("project gone") already holds; only genuine API
    // failures (auth, 5xx) report an error the caller must surface.
    if (!res.ok && res.status !== 404) {
      return { ok: false, message: `Neon API returned ${res.status} while deleting project ${projectId}.` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `Could not reach the Neon API: ${e instanceof Error ? e.message : String(e)}` };
  }
}
