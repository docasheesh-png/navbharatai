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

/** The honest requirement line shown when Render can't deploy yet. Pure. */
export function renderRequirement(env: NodeJS.ProcessEnv = process.env): string {
  return renderConfigured(env)
    ? 'Render is configured — a real deploy can run.'
    : 'Set RENDER_API_KEY (Settings → Secrets & Keys) to deploy your backend to Render.';
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
export async function deployBackendToRender(
  opts: { repoUrl?: string; appName?: string; apiKey?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<RenderDeployResult> {
  const apiKey = (opts.apiKey ?? process.env.RENDER_API_KEY ?? '').trim();
  if (!apiKey) {
    return { ok: false, reason: 'not-configured', message: renderRequirement({ RENDER_API_KEY: '' } as NodeJS.ProcessEnv) };
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
