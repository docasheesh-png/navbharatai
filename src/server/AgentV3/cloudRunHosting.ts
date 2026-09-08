// NAVBHARAT CLOUD — running a USER's app on Cloud Run, in NavBharatAI's own infrastructure.
// (ROADMAP §11, slice 1. Admin-approved 2026-09-07: D1 hosting, D4 separate project, D5 cost + 20%.)
//
// WHY THIS EXISTS. Until now the only way to host an app with a server half was for the user to open
// Render, create an account, generate an API key and paste it back — a five-step path through two
// other websites. Researched the same day: Replit, Lovable, Base44, Bolt, v0 and Emergent ALL host the
// backend themselves, and none of them makes a third-party key the default path. That gap is a product
// decision, not a code defect, and this module is the first half of closing it.
//
// WHY CLOUD RUN AND NOT A VM. `minInstanceCount: 0` is not a default here — it IS the cost model. An
// app nobody visits costs nothing, which is what makes hosting affordable to give away at cost + 20%
// (D5). Render's free tier is always-on and therefore sleeps after 15 idle minutes; Cloud Run bills per
// request and genuinely reaches zero.
//
// 🔒 THE ONE RULE THIS FILE ENFORCES ABOVE ALL OTHERS — user code never runs in the platform's project.
// Everything NavBharatAI owns lives in one GCP project: Firestore, the wallet, every user record, the
// server itself. A user's hosted app drawing an abuse complaint or a runaway bill must not be able to
// reach any of that. So `appsProject()` fails CLOSED when the apps project is not configured, and
// REFUSES a value equal to the platform's own project — because that particular misconfiguration would
// silently undo the decision while everything appeared to work. See ROADMAP §11.
//
// Pure builders + an injectable `fetch`, in the same shape as renderDeploy.ts, so every rule below is
// unit-tested without a network and without a Google project.

/** Cloud Run Admin API v2. Fixed — never taken from user input. */
export const RUN_API = 'https://run.googleapis.com/v2';

/**
 * The platform's own project. Naming it here is what lets `appsProject` REFUSE it: an operator who
 * points the apps project at the platform has not made a typo, they have removed the isolation, and
 * nothing else in the system would notice.
 */
export const PLATFORM_PROJECT = 'gen-lang-client-0866594388';

/**
 * Where user apps run. Mumbai, deliberately: this is an India-first product and the people opening
 * these apps are in India, so the latency that matters is theirs, not the platform's. Tunable because
 * a region is an operational choice, not a law.
 */
export const DEFAULT_REGION = 'asia-south1';

export type AppsProjectProblem = 'not-configured' | 'is-platform-project';

export interface AppsProjectResult {
  projectId: string | null;
  problem: AppsProjectProblem | null;
  /** What an operator should do about it. '' when the project resolved. */
  message: string;
}

/**
 * The GCP project user apps deploy into — or an honest refusal.
 *
 * 🔒 FAILS CLOSED, TWICE OVER. Unset means hosting is unavailable and says so; it must NEVER fall back
 * to the platform's project, because a working fallback is exactly how an isolation decision gets
 * quietly reversed with nothing failing to reveal it. And a value that IS the platform project is
 * refused by name for the same reason. PURE.
 */
export function appsProject(env: NodeJS.ProcessEnv = process.env): AppsProjectResult {
  const raw = String(env.NAVBHARAT_APPS_PROJECT ?? '').trim();
  if (!raw) {
    return {
      projectId: null,
      problem: 'not-configured',
      message: 'App hosting is not switched on yet. Set NAVBHARAT_APPS_PROJECT to the separate Google '
        + 'Cloud project that user apps run in.',
    };
  }
  if (raw === PLATFORM_PROJECT) {
    return {
      projectId: null,
      problem: 'is-platform-project',
      message: 'NAVBHARAT_APPS_PROJECT is set to NavBharatAI\'s own project. User apps must run in a '
        + 'separate project, so hosting stays off until it points somewhere else.',
    };
  }
  return { projectId: raw, problem: null, message: '' };
}

/** The region user apps run in. */
export function appsRegion(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.NAVBHARAT_APPS_REGION ?? '').trim() || DEFAULT_REGION;
}

/**
 * THE COST CAPS — every one of these is money, not tuning.
 *
 * `maxInstanceCount` is the single most important number in this file: it is the ceiling on what one
 * app can spend in an hour, whatever its traffic or its bugs. Google's own guidance is to start at 3,
 * and a starter app that genuinely outgrows 3 instances is a conversation, not an accident.
 *
 * `minInstanceCount: 0` is the scale-to-zero guarantee — the reason an idle app costs nothing.
 * Raising it is the paid "always-on" tier (ROADMAP §11 slice 7) and must never become the default.
 *
 * Concurrency is deliberately HIGH: more requests per instance means fewer instances, which is both
 * cheaper and faster than the intuitive low number.
 */
export const HOSTING_CAPS = {
  minInstanceCount: 0,
  maxInstanceCount: 3,
  cpu: '1',
  memory: '512Mi',
  /** Requests one instance serves at once. */
  concurrency: 80,
  /** A request that has not finished in this long is not going to. */
  timeoutSeconds: 300,
} as const;

/** Characters Cloud Run allows in a service name, and the length it truncates at. */
const NAME_MAX = 63;

/** A short, stable hash — enough to make a name unique without making it unreadable. PURE. */
function shortHash(input: string, len = 8): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + input.charCodeAt(i) + 1, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).replace(/[^a-z0-9]/g, '').slice(0, len).padEnd(len, '0');
}

/**
 * The Cloud Run service name for a workspace.
 *
 * 🔒 DETERMINISTIC, because that is what makes a redeploy an UPDATE rather than a new service. A name
 * derived from anything that changes — a title, a timestamp — would leave a trail of abandoned
 * services in the user's project, each one a cost and none of them serving the app.
 *
 * Cloud Run's rules: lowercase letters, digits and hyphens, must start with a letter, must not end
 * with one, 63 characters. The readable half is a courtesy to whoever opens the console; the hash is
 * what guarantees uniqueness. PURE.
 */
/**
 * The workspace's fingerprint inside its service name — the half that never changes.
 *
 * 🔴 WHY THIS IS EXPORTED, and it is a real defect it prevents. A service name is `<app-slug>-<hash>`,
 * and the slug comes from the app's NAME, which the user can change. Matching a service to a workspace
 * by its full name therefore breaks the moment somebody renames their app: the live service stops
 * matching any record, the inventory calls it an ORPHAN, and an orphan is offered for reclaim — which
 * deletes it. A rename would take the app off the internet.
 *
 * The hash is derived from the workspace id alone, so it survives every rename. Matching on it is what
 * makes the inventory safe. PURE.
 */
export function workspaceServiceTag(workspaceId: string): string {
  return shortHash(String(workspaceId ?? ''));
}

/** Does this Cloud Run service belong to this workspace? Rename-proof — see workspaceServiceTag. PURE. */
export function serviceBelongsTo(service: string, workspaceId: string): boolean {
  const tag = workspaceServiceTag(workspaceId);
  return !!tag && String(service ?? '').endsWith(`-${tag}`);
}

export function serviceNameFor(workspaceId: string, appName?: string | null): string {
  const hash = workspaceServiceTag(workspaceId);
  const slug = String(appName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')          // a service name must START with a letter
    .slice(0, NAME_MAX - hash.length - 5);
  const stem = slug || 'app';
  return `${stem}-${hash}`.slice(0, NAME_MAX).replace(/-+$/, '');
}

export interface RunRequest {
  url: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  body?: string;
}

function runHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' };
}

/** Where a service lives, as the API addresses it. PURE. */
export function servicePath(projectId: string, region: string, service: string): string {
  return `projects/${projectId}/locations/${region}/services/${service}`;
}

export interface ServiceSpecInput {
  /** The already-built container image (Artifact Registry). Slice 1b produces this. */
  image: string;
  /** The environment the app boots with — from planBackendEnv, which never sends a platform key. */
  envVars?: Array<{ key: string; value: string }>;
  /** Recorded on the service so the console, the reaper and any audit can tell whose app this is. */
  workspaceId: string;
}

/**
 * The service definition Cloud Run is given.
 *
 * Every limit comes from HOSTING_CAPS rather than being written inline, so there is exactly one place
 * where the cost ceiling of a hosted app is decided. PURE.
 */
export function buildServiceSpec(input: ServiceSpecInput): Record<string, unknown> {
  return {
    template: {
      containers: [{
        image: input.image,
        resources: { limits: { cpu: HOSTING_CAPS.cpu, memory: HOSTING_CAPS.memory } },
        ...(input.envVars && input.envVars.length > 0
          ? { env: input.envVars.map((e) => ({ name: e.key, value: e.value })) }
          : {}),
      }],
      scaling: {
        minInstanceCount: HOSTING_CAPS.minInstanceCount,
        maxInstanceCount: HOSTING_CAPS.maxInstanceCount,
      },
      maxInstanceRequestConcurrency: HOSTING_CAPS.concurrency,
      timeout: `${HOSTING_CAPS.timeoutSeconds}s`,
    },
    ingress: 'INGRESS_TRAFFIC_ALL',
    labels: { 'nbai-workspace': shortHash(input.workspaceId, 12) },
  };
}

export function buildCreateServiceRequest(
  token: string, projectId: string, region: string, service: string, spec: Record<string, unknown>,
): RunRequest {
  return {
    url: `${RUN_API}/projects/${projectId}/locations/${region}/services?serviceId=${encodeURIComponent(service)}`,
    method: 'POST',
    headers: runHeaders(token),
    body: JSON.stringify(spec),
  };
}

/**
 * Replace an existing service's definition.
 *
 * ⚠️ No `updateMask`, deliberately: the spec above is the WHOLE intended state, including the caps. A
 * masked update could leave a previous revision's higher `maxInstanceCount` in place — i.e. leave the
 * old cost ceiling standing while appearing to apply the new one.
 */
export function buildUpdateServiceRequest(
  token: string, projectId: string, region: string, service: string, spec: Record<string, unknown>,
): RunRequest {
  return {
    url: `${RUN_API}/${servicePath(projectId, region, service)}`,
    method: 'PATCH',
    headers: runHeaders(token),
    body: JSON.stringify(spec),
  };
}

export function buildGetServiceRequest(
  token: string, projectId: string, region: string, service: string,
): RunRequest {
  return {
    url: `${RUN_API}/${servicePath(projectId, region, service)}`,
    method: 'GET',
    headers: runHeaders(token),
  };
}

/**
 * Let the public open the app.
 *
 * A separate, explicit call — never a field on the create. A published app that nobody can open is
 * useless, and a service that becomes public as a side effect of some other setting is how something
 * ends up public that was not meant to be. One call, one purpose, easy to find in an audit. PURE.
 */
export function buildMakePublicRequest(
  token: string, projectId: string, region: string, service: string,
): RunRequest {
  return {
    url: `${RUN_API}/${servicePath(projectId, region, service)}:setIamPolicy`,
    method: 'POST',
    headers: runHeaders(token),
    body: JSON.stringify({ policy: { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] } }),
  };
}

/**
 * 🔴 THE CEILING THIS EXISTS FOR: **1,000 Cloud Run services per project per region, and Google does
 * not raise it** (verified 2026-09-07). It is a hard cap, not a quota request.
 *
 * That is the same shape as the Firebase channel ceiling in ROADMAP §10, and §10's lesson is the one
 * that matters here: the cap was not reached by working apps, it was reached by DEAD ones nobody
 * deleted. A hosted app that is unpublished must give its slot back, or the ceiling arrives early and
 * for a stupid reason.
 */
export const SERVICES_PER_PROJECT_CAP = 1000;

/** Remove a hosted app's service, giving its slot back. */
export function buildDeleteServiceRequest(
  token: string, projectId: string, region: string, service: string,
): RunRequest {
  return {
    url: `${RUN_API}/${servicePath(projectId, region, service)}`,
    method: 'DELETE',
    headers: runHeaders(token),
  };
}

/** List the services that EXIST — the only count the cap actually applies to. */
export function buildListServicesRequest(
  token: string, projectId: string, region: string, pageSize = 100, pageToken = '',
): RunRequest {
  const params = new URLSearchParams({ pageSize: String(Math.max(1, Math.min(1000, pageSize))) });
  if (pageToken) params.set('pageToken', pageToken);
  return {
    url: `${RUN_API}/projects/${projectId}/locations/${region}/services?${params.toString()}`,
    method: 'GET',
    headers: runHeaders(token),
  };
}

/** The service ids in a list response, plus the token for the next page. PURE. */
export function parseServiceList(raw: unknown): { names: string[]; nextPageToken: string } {
  const r = raw && typeof raw === 'object' ? raw as Record<string, any> : null;
  const rows = Array.isArray(r?.services) ? r!.services : [];
  const names: string[] = [];
  for (const s of rows) {
    const full = typeof s?.name === 'string' ? s.name : '';
    const leaf = full.split('/').pop() ?? '';
    if (leaf) names.push(leaf);
  }
  return { names, nextPageToken: typeof r?.nextPageToken === 'string' ? r.nextPageToken : '' };
}

/**
 * Delete a hosted app's service. NEVER throws.
 *
 * 🔒 A 404 IS SUCCESS. Unpublishing an app whose service is already gone must not report a failure —
 * the caller's goal is "this app is not hosted any more", and it is already true. Idempotent by
 * construction, so a retried takedown can never fail on its second attempt.
 */
export async function deleteHostedService(
  opts: { token: string; projectId: string; region: string; service: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; alreadyGone: boolean; message: string }> {
  try {
    const req = buildDeleteServiceRequest(opts.token, opts.projectId, opts.region, opts.service);
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
    if (res.status === 404) return { ok: true, alreadyGone: true, message: '' };
    if (!res.ok) {
      return { ok: false, alreadyGone: false, message: hostingFailureMessage(res.status, opts.projectId) };
    }
    return { ok: true, alreadyGone: false, message: '' };
  } catch (e) {
    return {
      ok: false,
      alreadyGone: false,
      message: `Could not reach Google Cloud to remove this app: ${e instanceof Error ? e.message : String(e)}.`,
    };
  }
}

/** A Cloud Run service, narrowed to what we use. */
export interface ParsedService {
  name: string;
  /** The public https URL, once Cloud Run has assigned one. */
  uri: string;
  /** True when the service reports itself ready to serve. */
  ready: boolean;
}

/**
 * Read a service response.
 *
 * 🔒 `ready` IS EARNED, never assumed. Cloud Run answers the create call long before the revision is
 * serving, so treating a 200 as "live" would hand the user a URL that refuses connections — the same
 * lie this deploy path has already had to unlearn twice (a domain reported connected while serving an
 * error page, a Render deploy reported live the moment the request was accepted). PURE.
 */
export function parseService(raw: unknown): ParsedService | null {
  const s = raw && typeof raw === 'object' ? raw as Record<string, any> : null;
  if (!s || typeof s.name !== 'string' || !s.name.trim()) return null;
  const conditions = Array.isArray(s.conditions) ? s.conditions : [];
  const ready = conditions.some(
    (c: any) => c && c.type === 'Ready' && String(c.state ?? '').toUpperCase() === 'CONDITION_SUCCEEDED',
  );
  return {
    name: s.name.trim(),
    uri: typeof s.uri === 'string' ? s.uri.trim().replace(/\/+$/, '') : '',
    ready,
  };
}

/**
 * A Google refusal turned into the step that actually fixes it.
 *
 * The likeliest failures here are not the user's doing at all — they are the admin checklist in
 * ROADMAP §11 being incomplete — so the message names the missing step rather than echoing a status
 * code nobody can act on. PURE.
 */
export function hostingFailureMessage(status: number, projectId: string): string {
  if (status === 401 || status === 403) {
    return `NavBharatAI is not allowed to deploy into ${projectId} yet. Grant its service account the `
      + 'Cloud Run Admin and Service Account User roles in that project, then try again.';
  }
  if (status === 404) {
    return `The hosting project ${projectId} was not found, or the Cloud Run API is not enabled in it. `
      + 'Enable Cloud Run there and check the project id.';
  }
  if (status === 429) {
    return 'Google is rate-limiting deploys to the hosting project right now. Nothing was lost — try again in a minute.';
  }
  if (status === 400) {
    return 'Google refused the service settings for this app. Nothing was deployed, and your app is unchanged.';
  }
  return `Hosting could not deploy this app (HTTP ${status}). Nothing was lost — your app is safe here.`;
}

export type HostingResult =
  | { ok: true; url: string; service: string; ready: boolean }
  | { ok: false; reason: 'not-configured' | 'refused' | 'no-url'; message: string };

/**
 * Create or update the app's Cloud Run service, make it public, and report its URL. NEVER throws —
 * every branch returns something a user can be shown verbatim.
 *
 * Create-then-update rather than get-then-decide: a 409 already means "it exists", so asking first
 * would be an extra round trip to learn what the create tells us anyway.
 */
export async function deployAppToCloudRun(
  opts: {
    token: string;
    projectId: string;
    region: string;
    workspaceId: string;
    appName?: string | null;
    image: string;
    envVars?: Array<{ key: string; value: string }>;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<HostingResult> {
  const service = serviceNameFor(opts.workspaceId, opts.appName);
  const spec = buildServiceSpec({ image: opts.image, envVars: opts.envVars, workspaceId: opts.workspaceId });
  try {
    const create = buildCreateServiceRequest(opts.token, opts.projectId, opts.region, service, spec);
    let res = await fetchImpl(create.url, { method: create.method, headers: create.headers, body: create.body });
    if (res.status === 409) {
      const upd = buildUpdateServiceRequest(opts.token, opts.projectId, opts.region, service, spec);
      res = await fetchImpl(upd.url, { method: upd.method, headers: upd.headers, body: upd.body });
    }
    if (!res.ok) {
      return { ok: false, reason: 'refused', message: hostingFailureMessage(res.status, opts.projectId) };
    }

    // Public access is its own call, and its failure is REPORTED rather than swallowed: a service
    // nobody can open is not a successful deploy, however well the deploy itself went.
    const pub = buildMakePublicRequest(opts.token, opts.projectId, opts.region, service);
    const pubRes = await fetchImpl(pub.url, { method: pub.method, headers: pub.headers, body: pub.body });
    if (!pubRes.ok) {
      return {
        ok: false,
        reason: 'refused',
        message: 'Your app was deployed but could not be opened to the public, so its link would not work '
          + 'for anyone else yet. Try deploying again in a moment.',
      };
    }

    const get = buildGetServiceRequest(opts.token, opts.projectId, opts.region, service);
    const getRes = await fetchImpl(get.url, { method: get.method, headers: get.headers });
    const parsed = getRes.ok ? parseService(await getRes.json().catch(() => null)) : null;
    // No URL is a refusal, not a success with a blank field: the caller is about to point a domain at
    // this address, and pointing one at '' is worse than not pointing it at all.
    if (!parsed?.uri) {
      return {
        ok: false,
        reason: 'no-url',
        message: 'Your app was deployed, but its address could not be read back yet. Give it a minute, then check again.',
      };
    }
    return { ok: true, url: parsed.uri, service, ready: parsed.ready };
  } catch (e) {
    return {
      ok: false,
      reason: 'refused',
      message: `Could not reach Google Cloud to deploy your app: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`,
    };
  }
}
