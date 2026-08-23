// renderDeploy — REAL separate-backend deploy to Render (slice 4 of the frontend/backend-split feature).
//
// NavBharatAI generates the backend's render.yaml (slice 1) and injects it into the project (slice 2). This
// module is the server-side engine that actually talks to the Render API with the admin/user's RENDER_API_KEY
// to TRIGGER a real deploy of the connected backend service and return its live URL.
//
// HONESTY (NavBharatAI rule 2 — no fake deploys): every path is real. Without the key it reports
// `configured:false`; with the key it makes real Render API calls; if the user hasn't connected their repo to
// Render yet (a one-time step Render requires in its own UI), it says so honestly with the exact next action —
// it never pretends a deploy happened.
//
// The request BUILDERS are pure (no I/O) so the exact Render API shapes are unit-tested without a live key.

const RENDER_API_BASE = 'https://api.render.com/v1';

/** True when a Render API key is configured on this server (so a real deploy can run). */
export function renderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.RENDER_API_KEY === 'string' && env.RENDER_API_KEY.trim().length > 0;
}

/**
 * THE USER'S OWN RENDER KEY WINS (root-caused 2026-08-07).
 *
 * The old gate asked only `process.env.RENDER_API_KEY`, while every message told the user to "Set
 * RENDER_API_KEY (Settings → Secrets & API Keys)". Nothing ever read that vault entry — so a user who
 * followed the instruction exactly, saved their key and retried, got the byte-identical refusal. The
 * app was giving an instruction it did not implement.
 *
 * It matters beyond the wrong words. NavBharatAI's standing rule is that user apps run on the USER's
 * own accounts and billing; deploying every user's backend with one server-side key would put all of
 * them inside a single Render account paid for by whoever owns that key. So the user's own key is
 * PREFERRED, and the server key is only the fallback. PURE.
 */
export function resolveRenderKey(
  vaultSecrets?: Record<string, string> | null,
  env: NodeJS.ProcessEnv = process.env,
): { key: string; source: 'user' | 'server' } | null {
  const user = String(vaultSecrets?.RENDER_API_KEY ?? '').trim();
  if (user) return { key: user, source: 'user' };
  const server = String(env.RENDER_API_KEY ?? '').trim();
  if (server) return { key: server, source: 'server' };
  return null;
}

/** True when SOMETHING can deploy — the user's own key or the server's. PURE. */
export function renderDeployAvailable(
  vaultSecrets?: Record<string, string> | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveRenderKey(vaultSecrets, env) !== null;
}

/**
 * The honest requirement line shown when Render can't deploy yet.
 *
 * When a key IS available it names WHOSE account the deploy will land in, because that determines who
 * gets the bill — "Render is configured" hid the one fact the user most needed. PURE.
 */
export function renderRequirement(
  envOrVault: NodeJS.ProcessEnv | null = process.env,
  vaultSecrets?: Record<string, string> | null,
): string {
  const env = (envOrVault ?? {}) as NodeJS.ProcessEnv;
  const resolved = resolveRenderKey(vaultSecrets, env);
  if (resolved?.source === 'user') return 'Deploying to YOUR own Render account, using the key you saved in Settings → Secrets & API Keys.';
  if (resolved?.source === 'server') return 'Render is configured — a real deploy can run.';
  return 'Save your own RENDER_API_KEY in Settings → Secrets & API Keys to deploy your backend to Render (Render → Account Settings → API Keys).';
}

export interface RenderRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

/** Auth + JSON headers for the Render API. Pure. */
function renderHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/** Build the "list my services" request (paths only, no secrets logged). Pure + tested. */
export function buildListServicesRequest(apiKey: string, limit = 50): RenderRequest {
  return {
    url: `${RENDER_API_BASE}/services?limit=${Math.max(1, Math.min(100, Math.floor(limit)))}`,
    method: 'GET',
    headers: renderHeaders(apiKey),
  };
}

/** Build the "trigger a deploy for this service" request. Pure + tested. */
export function buildTriggerDeployRequest(apiKey: string, serviceId: string): RenderRequest {
  return {
    url: `${RENDER_API_BASE}/services/${encodeURIComponent(serviceId)}/deploys`,
    method: 'POST',
    headers: renderHeaders(apiKey),
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  };
}

/** A Render service, narrowed to what we use. */
export interface RenderService {
  id: string;
  name: string;
  type?: string;
  repo?: string;
  dashboardUrl?: string;
  serviceUrl?: string;
}

/** Normalise a raw Render `/services` list item (shape: `{ service: {...} }` or the service itself). Pure. */
export function parseRenderService(raw: any): RenderService | null {
  const s = raw && typeof raw === 'object' ? (raw.service ?? raw) : null;
  if (!s || typeof s.id !== 'string') return null;
  return {
    id: s.id,
    name: typeof s.name === 'string' ? s.name : s.id,
    type: typeof s.type === 'string' ? s.type : undefined,
    repo: typeof s.repo === 'string' ? s.repo : undefined,
    dashboardUrl: typeof s.dashboardUrl === 'string' ? s.dashboardUrl : undefined,
    serviceUrl: typeof s?.serviceDetails?.url === 'string' ? s.serviceDetails.url : undefined,
  };
}

/**
 * Pick the Render service that matches this repo/app, or null. Match by repo URL first (most reliable),
 * then by a sanitised name equality. Pure so the matching rule is tested. `repoUrl` is the GitHub repo the
 * backend was pushed to; `appName` is the sanitised service name we put in render.yaml.
 */
export function matchRenderService(services: RenderService[], opts: { repoUrl?: string; appName?: string }): RenderService | null {
  const repo = (opts.repoUrl || '').replace(/\.git$/, '').toLowerCase();
  if (repo) {
    const byRepo = services.find((s) => (s.repo || '').replace(/\.git$/, '').toLowerCase() === repo);
    if (byRepo) return byRepo;
  }
  const name = (opts.appName || '').toLowerCase();
  if (name) {
    const byName = services.find((s) => s.name.toLowerCase() === name);
    if (byName) return byName;
  }
  return null;
}

export type RenderDeployResult =
  | { ok: true; url: string; serviceId: string; serviceName: string }
  | { ok: false; reason: 'not-configured' | 'no-service' | 'api-error'; message: string };

/**
 * Trigger a REAL Render deploy of the user's backend. Lists their services, matches the one for this repo/app,
 * and triggers a deploy; returns the live service URL. Honest at every branch — no fake success.
 *
 * `fetchImpl` is injected so the orchestration is testable without network; defaults to global fetch.
 */
/**
 * The backend's LIVE URL, without deploying anything. Returns '' when it cannot be established.
 *
 * 🔒 WHY A LOOKUP SEPARATE FROM THE DEPLOY. Publishing a SPLIT frontend needs one thing from the
 * backend — the address to bake into the bundle — and needs it BEFORE the frontend build runs.
 * Triggering a deploy to obtain it would be a side effect nobody asked for on every publish, and
 * would still race: a deploy that has just started is not yet serving. Reading the service's existing
 * URL is both cheaper and more honest.
 *
 * 🔒 AND '' IS A REFUSAL, NOT A DEFAULT. The caller must NOT publish a split frontend without this —
 * a bundle built with no backend address is the silent-failure site this whole feature exists to
 * prevent: it loads, it looks right, and every request goes nowhere.
 */
export async function findBackendUrl(
  opts: { repoUrl?: string; appName?: string; apiKey?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const apiKey = (opts.apiKey ?? process.env.RENDER_API_KEY ?? '').trim();
  if (!apiKey) return '';
  try {
    const req = buildListServicesRequest(apiKey);
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
    if (!res.ok) return '';
    const json = await res.json().catch(() => null);
    const services = (Array.isArray(json) ? json : [])
      .map(parseRenderService)
      .filter((s): s is RenderService => s !== null);
    const match = matchRenderService(services, opts);
    // Only a real SERVICE url is an API address. The dashboard link is a web page for a human, and
    // baking it into a frontend would point every request at Render's own UI.
    return match?.serviceUrl?.trim() ? match.serviceUrl.trim().replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

export async function deployBackendToRender(
  opts: { repoUrl?: string; appName?: string; apiKey?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<RenderDeployResult> {
  const apiKey = (opts.apiKey ?? process.env.RENDER_API_KEY ?? '').trim();
  if (!apiKey) {
    return { ok: false, reason: 'not-configured', message: renderRequirement({ RENDER_API_KEY: '' } as NodeJS.ProcessEnv, null) };
  }
  let services: RenderService[] = [];
  try {
    const req = buildListServicesRequest(apiKey);
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
    if (!res.ok) {
      return { ok: false, reason: 'api-error', message: `Render API returned ${res.status} while listing services. Check that RENDER_API_KEY is valid.` };
    }
    const json = await res.json().catch(() => null);
    const arr = Array.isArray(json) ? json : [];
    services = arr.map(parseRenderService).filter((s): s is RenderService => s !== null);
  } catch (e) {
    return { ok: false, reason: 'api-error', message: `Could not reach the Render API: ${e instanceof Error ? e.message : String(e)}` };
  }

  const service = matchRenderService(services, opts);
  if (!service) {
    // Render requires a one-time repo connect in its own UI; we generated render.yaml, but the Blueprint
    // must be created once. Honest next step — never a fake deploy.
    return {
      ok: false,
      reason: 'no-service',
      message: 'No matching Render service found yet. One-time step: in Render → New → Blueprint, pick your repo '
        + '(it already has render.yaml). After that, deploys can be triggered from here.',
    };
  }

  try {
    const req = buildTriggerDeployRequest(apiKey, service.id);
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
    if (!res.ok) {
      return { ok: false, reason: 'api-error', message: `Render API returned ${res.status} while triggering the deploy for "${service.name}".` };
    }
    const url = service.serviceUrl || service.dashboardUrl || `https://dashboard.render.com/`;
    return { ok: true, url, serviceId: service.id, serviceName: service.name };
  } catch (e) {
    return { ok: false, reason: 'api-error', message: `Could not trigger the Render deploy: ${e instanceof Error ? e.message : String(e)}` };
  }
}
