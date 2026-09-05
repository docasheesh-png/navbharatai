// DID THE BACKEND ACTUALLY COME UP? (admin 2026-09-05)
//
// 🔴 THE GAP THIS CLOSES. `deployBackendToRender` reported success the moment Render ACCEPTED the
// request — and that is all it ever knew. "Deploy triggered" is true; "your app is live" was never
// checked. A build that fails, a service that boots and crashes on a missing variable, a start command
// that exits immediately: every one of those produced the same cheerful message, and the user found
// out by opening their own site.
//
// That is this deploy path's recurring bug class, stated plainly: **each layer reports its own narrow
// success as the whole outcome.** The records existed, so DNS was "done". The host accepted the
// domain, so it was "connected". Render accepted the request, so it was "deployed". Each was true and
// none of them meant the user had a working site.
//
// So this module asks the two questions that actually matter, in order:
//   1. what does the HOST say about this deploy — live, still building, or failed?
//   2. and does the address actually ANSWER?
//
// The second outranks the first. A host's status is a claim about its own pipeline; an HTTP response
// from the real URL is the app itself replying. When they disagree, the app wins.
//
// PURE parsing + a never-throwing probe, in the same shape as renderDeploy.ts.

const RENDER_API_BASE = 'https://api.render.com/v1';

export interface RenderRequest {
  url: string;
  method: 'GET';
  headers: Record<string, string>;
}

function renderHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json' };
}

/** The most recent deploys for a service, newest first. */
export function buildListDeploysRequest(apiKey: string, serviceId: string, limit = 1): RenderRequest {
  return {
    url: `${RENDER_API_BASE}/services/${encodeURIComponent(serviceId)}/deploys?limit=${Math.max(1, Math.min(20, Math.floor(limit)))}`,
    method: 'GET',
    headers: renderHeaders(apiKey),
  };
}

/**
 * What a deploy status MEANS, collapsed to the three answers a user can act on.
 *
 * 🔒 AN UNKNOWN STATUS IS ITS OWN ANSWER, not a failure and not a success. Render can add a status
 * tomorrow, and mapping the unfamiliar onto either verdict would make this function confidently wrong
 * about the one case it has never seen. `'unknown'` is reported as "we could not tell", which is the
 * only honest thing to say about a word we do not recognise. PURE.
 */
export type DeployPhase = 'live' | 'failed' | 'in-progress' | 'unknown';

export function deployPhase(status: string | null | undefined): DeployPhase {
  const s = String(status ?? '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (s === 'live') return 'live';
  if (s.endsWith('_failed') || s === 'canceled' || s === 'cancelled' || s === 'deactivated') return 'failed';
  if (s === 'created' || s.endsWith('_in_progress') || s === 'queued' || s === 'building') return 'in-progress';
  return 'unknown';
}

export interface ParsedDeploy {
  id: string;
  status: string;
}

/** Normalise a `/deploys` item (`{ deploy: {...} }` or the object itself). Pure. */
export function parseDeploy(raw: any): ParsedDeploy | null {
  const d = raw && typeof raw === 'object' ? (raw.deploy ?? raw) : null;
  if (!d || typeof d.id !== 'string' || !d.id.trim()) return null;
  return { id: d.id.trim(), status: typeof d.status === 'string' ? d.status : '' };
}

/** The newest deploy in a `/deploys` response, or null when there is none we can read. Pure. */
export function latestDeploy(raw: any): ParsedDeploy | null {
  const rows = Array.isArray(raw) ? raw : [];
  for (const row of rows) {
    const d = parseDeploy(row);
    if (d) return d;
  }
  return null;
}

export interface BackendProbe {
  /** Did the address answer at all? A 500 is an answer; a refused connection is not. */
  answered: boolean;
  status: number;
}

/**
 * Ask the app itself. NEVER throws.
 *
 * 🔒 ANSWERING IS THE TEST, NOT A 200. A backend whose root path returns 404 because it only serves
 * `/api/...` is a perfectly healthy backend, and calling it broken would be a confident false alarm on
 * a working app. What distinguishes a live service from a dead one is whether anything replies at all
 * — so a 4xx counts as alive and only a 5xx is reported as the app failing on its own.
 */
export async function probeBackend(url: string, fetchImpl: typeof fetch = fetch): Promise<BackendProbe> {
  const target = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(target)) return { answered: false, status: 0 };
  try {
    const res = await fetchImpl(target, { method: 'GET', redirect: 'follow' });
    return { answered: true, status: res.status };
  } catch {
    return { answered: false, status: 0 };
  }
}

export interface DeployVerdict {
  phase: DeployPhase;
  /** The host's own status word, for the admin diagnostics — never shown raw to a user. */
  status: string;
  probe: BackendProbe | null;
  /** One plain sentence for a non-technical user. */
  message: string;
  /** True only when we have POSITIVE evidence the app is serving. */
  live: boolean;
}

/**
 * Turn the two pieces of evidence into one honest sentence.
 *
 * 🔒 THE PROBE OUTRANKS THE STATUS, and the order is the whole point. A host status is a claim about
 * the host's own pipeline; an HTTP reply from the real address is the app answering for itself. So a
 * service Render calls `live` that refuses every connection is NOT reported as live — that exact
 * mismatch is what a user sees as "you said it worked". PURE.
 */
export function deployVerdict(phase: DeployPhase, status: string, probe: BackendProbe | null): DeployVerdict {
  const base = { phase, status, probe };
  if (probe?.answered && probe.status < 500) {
    return { ...base, live: true, message: 'Your backend is live and answering.' };
  }
  if (phase === 'failed') {
    return {
      ...base,
      live: false,
      message: 'Your backend did not start. Open your backend host\'s logs for this service — the last lines say '
        + 'why. The most common causes are a missing setting and a start command that exits immediately.',
    };
  }
  if (probe?.answered && probe.status >= 500) {
    return {
      ...base,
      live: false,
      message: 'Your backend is running but answering with an error. That is the app itself failing, not the '
        + 'hosting — check its logs, and that every setting it needs is saved.',
    };
  }
  if (phase === 'in-progress') {
    return {
      ...base,
      live: false,
      message: 'Your backend is still building. This usually takes a few minutes — it goes live by itself when '
        + 'the build finishes.',
    };
  }
  // Either we could not read a status, or we read one we do not recognise. Both mean the same thing to
  // the user, and neither is evidence of failure.
  return {
    ...base,
    live: false,
    message: 'Your deploy was accepted, but we could not confirm your backend is answering yet. Give it a minute, '
      + 'then open the address above.',
  };
}

/**
 * The current, EVIDENCE-BACKED state of a service's newest deploy. Never throws.
 *
 * A single reading — no polling loop. The caller decides how often to ask, which keeps a request from
 * being held open for minutes on a build we do not control.
 */
export async function readDeployVerdict(
  opts: { apiKey: string; serviceId: string; serviceUrl?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<DeployVerdict> {
  let phase: DeployPhase = 'unknown';
  let status = '';
  try {
    const req = buildListDeploysRequest(opts.apiKey, opts.serviceId);
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
    if (res.ok) {
      const d = latestDeploy(await res.json().catch(() => null));
      if (d) { status = d.status; phase = deployPhase(d.status); }
    }
  } catch { /* an unreadable status is 'unknown', which is exactly what it is */ }
  // Probe only once the host is not actively mid-build: hitting a URL that does not exist yet costs a
  // request and tells us nothing we did not already know from the status.
  const probe = phase === 'in-progress' || !opts.serviceUrl
    ? null
    : await probeBackend(opts.serviceUrl, fetchImpl);
  return deployVerdict(phase, status, probe);
}
