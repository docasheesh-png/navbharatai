/**
 * cloudRunBackend — the REAL managed-backend deploy engine ("Deploy to NavBharatAI Cloud").
 *
 * WHAT IT DOES: takes a user app's source files and runs them as a container on NavBharatAI's OWN
 * GCP project (Cloud Run, Mumbai by default) — source → tar.gz → GCS → Cloud Build (docker build +
 * push to Artifact Registry) → Cloud Run service with the plan's hard resource caps → public URL.
 * This is the platform-billed MANAGED tier; the BYO tier (renderDeploy.ts, backendDeployConfig.ts —
 * user's own account, user's own bill) is untouched and remains the free default.
 *
 * DELIBERATE SHAPE — poll-driven, not wait-driven: `startManagedDeploy` does the cheap fast part
 * (upload + start build) and returns ids; `advanceManagedDeploy` is called from the status poll and
 * moves the deploy forward from SOURCE-OF-TRUTH state (Cloud Build status, Cloud Run status), never
 * from remembered state. A server restart mid-deploy loses nothing — the next poll resumes exactly
 * where reality is. Same honesty contract as renderDeploy.ts: no key/project → `configured:false`
 * with the exact missing pieces; every failure names its stage; no path fakes success.
 *
 * Request BUILDERS are pure (unit-tested without GCP); orchestration takes an injected fetch.
 */

import { GoogleAuth } from 'google-auth-library';
import { createHash } from 'crypto';
import { envFlag } from './envFlag';
import { tarGzFromFiles } from './tarGz';
import { backendDeployConfig } from '../../lib/backendDeployConfig';
import { type BackendLimits, cloudRunResourceLimits } from './backendLimits';

// ---------------------------------------------------------------------------------------------
// enablement + configuration (honest "what is missing" — never a bare boolean lie)
// ---------------------------------------------------------------------------------------------

/** Master kill switch. OFF by default — this engine spends the platform's money, the admin opts in. */
export function managedBackendEnabled(): boolean {
  return envFlag('AGENTV3_MANAGED_BACKEND', false);
}

export function managedBackendRegion(env: NodeJS.ProcessEnv = process.env): string {
  return (env.MANAGED_BACKEND_REGION ?? '').trim() || 'asia-south1'; // Mumbai
}

export function managedBackendArRepo(env: NodeJS.ProcessEnv = process.env): string {
  return (env.MANAGED_BACKEND_AR_REPO ?? '').trim() || 'nb-user-apps';
}

export interface ManagedBackendConfig {
  configured: boolean;
  /** Every missing env, so the admin fixes ALL of them in one pass — not one per error. */
  missing: string[];
  project: string;
  region: string;
  buildBucket: string;
  arRepo: string;
}

export function managedBackendConfig(env: NodeJS.ProcessEnv = process.env): ManagedBackendConfig {
  const project = (env.MANAGED_BACKEND_GCP_PROJECT ?? '').trim();
  const buildBucket = (env.MANAGED_BACKEND_BUILD_BUCKET ?? '').trim();
  const missing: string[] = [];
  if (!project) missing.push('MANAGED_BACKEND_GCP_PROJECT');
  if (!buildBucket) missing.push('MANAGED_BACKEND_BUILD_BUCKET');
  return {
    configured: missing.length === 0,
    missing,
    project,
    region: managedBackendRegion(env),
    buildBucket,
    arRepo: managedBackendArRepo(env),
  };
}

// ---------------------------------------------------------------------------------------------
// naming (pure) — one place decides every derived name, so they can never drift apart
// ---------------------------------------------------------------------------------------------

/** Short, stable, non-reversible uid handle for resource names (never the raw uid — it leaks). */
export function uidHandle(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 8);
}

/** Sanitise an app id/name into a Cloud-Run-legal slug fragment. */
export function appSlug(appId: string): string {
  const s = (appId || 'app').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return (s || 'app').slice(0, 20).replace(/-+$/, '');
}

/** Cloud Run service id: `nb-{uid8}-{slug}` — ≤63 chars, starts with a letter, by construction. */
export function serviceNameFor(uid: string, appId: string): string {
  return `nb-${uidHandle(uid)}-${appSlug(appId)}`;
}

/** The app's subdomain label under the wildcard apps domain: `{slug}-{uid8}` (unique per app). */
export function subdomainFor(uid: string, appId: string): string {
  return `${appSlug(appId)}-${uidHandle(uid)}`;
}

/** Full Artifact Registry image path for one deploy attempt. */
export function imagePathFor(cfg: ManagedBackendConfig, serviceId: string, tag: string): string {
  return `${cfg.region}-docker.pkg.dev/${cfg.project}/${cfg.arRepo}/${serviceId}:${tag}`;
}

// ---------------------------------------------------------------------------------------------
// GCP auth — ambient service account (Cloud Run metadata in prod, ADC locally), like
// firebaseCustomDomain.ts. Null token = honest "engine cannot authenticate", never a throw.
// ---------------------------------------------------------------------------------------------

let _auth: GoogleAuth | null = null;
function auth(): GoogleAuth {
  if (!_auth) _auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return _auth;
}

export async function gcpAccessToken(): Promise<string | null> {
  try {
    const client = await auth().getClient();
    const t = await client.getAccessToken();
    return t?.token ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// pure request builders — the exact wire shapes, unit-tested without GCP
// ---------------------------------------------------------------------------------------------

export interface GcpRequest {
  url: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  body?: string | Buffer;
}

function jsonHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
}

/** Upload the source tarball to the build bucket (simple media upload). Pure. */
export function buildGcsUploadRequest(token: string, bucket: string, objectName: string, tgz: Buffer): GcpRequest {
  return {
    url: `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`,
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/gzip' },
    body: tgz,
  };
}

/** Start the Cloud Build that docker-builds the source and pushes the image. Pure. */
export function buildStartBuildRequest(
  token: string,
  opts: { project: string; bucket: string; object: string; image: string },
): GcpRequest {
  return {
    url: `https://cloudbuild.googleapis.com/v1/projects/${encodeURIComponent(opts.project)}/builds`,
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({
      source: { storageSource: { bucket: opts.bucket, object: opts.object } },
      steps: [{ name: 'gcr.io/cloud-builders/docker', args: ['build', '-t', opts.image, '.'] }],
      images: [opts.image],
      timeout: '600s',
    }),
  };
}

export function buildGetBuildRequest(token: string, project: string, buildId: string): GcpRequest {
  return {
    url: `https://cloudbuild.googleapis.com/v1/projects/${encodeURIComponent(project)}/builds/${encodeURIComponent(buildId)}`,
    method: 'GET',
    headers: jsonHeaders(token),
  };
}

/** The Cloud Run v2 service template for one user app — limits are REQUIRED, not defaulted in. */
export function cloudRunServiceBody(opts: {
  image: string;
  limits: BackendLimits;
  env: Record<string, string>;
}): Record<string, any> {
  return {
    labels: { 'nbai-managed': 'true' },
    ingress: 'INGRESS_TRAFFIC_ALL',
    template: {
      containers: [{
        image: opts.image,
        resources: { limits: cloudRunResourceLimits(opts.limits), cpuIdle: true },
        env: Object.entries(opts.env).map(([name, value]) => ({ name, value })),
      }],
      scaling: { minInstanceCount: 0, maxInstanceCount: opts.limits.maxInstances },
      maxInstanceRequestConcurrency: opts.limits.concurrency,
      timeout: `${opts.limits.timeoutSeconds}s`,
    },
  };
}

export function buildCreateServiceRequest(
  token: string,
  opts: { project: string; region: string; serviceId: string; body: Record<string, any> },
): GcpRequest {
  return {
    url: `https://run.googleapis.com/v2/projects/${opts.project}/locations/${opts.region}/services?serviceId=${encodeURIComponent(opts.serviceId)}`,
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify(opts.body),
  };
}

export function buildUpdateServiceRequest(
  token: string,
  opts: { project: string; region: string; serviceId: string; body: Record<string, any> },
): GcpRequest {
  return {
    url: `https://run.googleapis.com/v2/projects/${opts.project}/locations/${opts.region}/services/${opts.serviceId}`,
    method: 'PATCH',
    headers: jsonHeaders(token),
    body: JSON.stringify(opts.body),
  };
}

export function buildGetServiceRequest(token: string, project: string, region: string, serviceId: string): GcpRequest {
  return {
    url: `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${serviceId}`,
    method: 'GET',
    headers: jsonHeaders(token),
  };
}

export function buildDeleteServiceRequest(token: string, project: string, region: string, serviceId: string): GcpRequest {
  return {
    url: `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${serviceId}`,
    method: 'DELETE',
    headers: jsonHeaders(token),
  };
}

/** Make the service publicly invokable (user apps are public websites). Pure. */
export function buildSetPublicRequest(token: string, project: string, region: string, serviceId: string): GcpRequest {
  return {
    url: `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${serviceId}:setIamPolicy`,
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ policy: { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] } }),
  };
}

// ---------------------------------------------------------------------------------------------
// parse helpers (pure)
// ---------------------------------------------------------------------------------------------

export type BuildPhase = 'QUEUED' | 'WORKING' | 'SUCCESS' | 'FAILURE' | 'INTERNAL_ERROR' | 'TIMEOUT' | 'CANCELLED' | 'UNKNOWN';

export function parseBuildStatus(json: any): { phase: BuildPhase; logUrl?: string } {
  const s = typeof json?.status === 'string' ? json.status : 'UNKNOWN';
  const known: BuildPhase[] = ['QUEUED', 'WORKING', 'SUCCESS', 'FAILURE', 'INTERNAL_ERROR', 'TIMEOUT', 'CANCELLED'];
  return {
    phase: (known as string[]).includes(s) ? (s as BuildPhase) : 'UNKNOWN',
    logUrl: typeof json?.logUrl === 'string' ? json.logUrl : undefined,
  };
}

export function parseServiceStatus(json: any): { ready: boolean; url: string | null; deployedImage: string | null } {
  const url = typeof json?.uri === 'string' && json.uri ? json.uri : null;
  const term = json?.terminalCondition;
  const ready = term?.type === 'Ready' && term?.state === 'CONDITION_SUCCEEDED';
  const img = json?.template?.containers?.[0]?.image;
  return { ready, url, deployedImage: typeof img === 'string' ? img : null };
}

// ---------------------------------------------------------------------------------------------
// orchestration — start (fast) and advance (poll-driven), both honest at every stage
// ---------------------------------------------------------------------------------------------

export type StartDeployResult =
  | { ok: true; buildId: string; image: string; objectName: string }
  | { ok: false; stage: 'config' | 'auth' | 'source' | 'upload' | 'build-start'; message: string };

/**
 * Kick off a managed deploy: ensure a Dockerfile (reusing the SAME generator the BYO cloud-run path
 * ships — one Dockerfile truth, rule 2), pack, upload to GCS, start the Cloud Build. Returns ids the
 * caller persists; it does NOT wait for the build.
 */
export async function startManagedDeploy(
  opts: {
    serviceId: string;
    files: Record<string, string>;
    /** package.json-derived hints for the Dockerfile generator. */
    appName: string;
    tag: string;
    env?: NodeJS.ProcessEnv;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<StartDeployResult> {
  const cfg = managedBackendConfig(opts.env);
  if (!cfg.configured) {
    return { ok: false, stage: 'config', message: `Managed backend is not configured — set ${cfg.missing.join(', ')} on the server.` };
  }

  // Source checks are pure and instant — they run BEFORE auth so a broken project fails fast (and
  // the checks stay unit-testable without GCP credentials).
  const files = { ...opts.files };
  if (!files['package.json']) {
    return { ok: false, stage: 'source', message: 'The app has no package.json — a Node backend needs one (with a "start" script) to be deployed.' };
  }
  if (!files['Dockerfile']) {
    // Same generator the BYO path uses — the managed tier must never grow a second, drifting Dockerfile.
    let startCommand = 'npm start';
    let nodeMajor: number | undefined;
    try {
      const pkg = JSON.parse(files['package.json']);
      if (typeof pkg?.scripts?.start === 'string' && pkg.scripts.start.trim()) startCommand = 'npm start';
      else return { ok: false, stage: 'source', message: 'package.json has no "start" script — add one (e.g. "node server.js") and retry.' };
      const m = /^(?:[^0-9]*)(\d+)/.exec(String(pkg?.engines?.node ?? ''));
      if (m) nodeMajor = Number(m[1]);
    } catch {
      return { ok: false, stage: 'source', message: 'package.json is not valid JSON — fix it and retry.' };
    }
    const plan = backendDeployConfig('cloud-run', { name: opts.appName, startCommand, nodeMajor });
    files['Dockerfile'] = plan.files['Dockerfile'];
    if (!files['.dockerignore'] && plan.files['.dockerignore']) files['.dockerignore'] = plan.files['.dockerignore'];
  }

  let tgz: Buffer;
  try {
    tgz = tarGzFromFiles(files);
  } catch (e) {
    return { ok: false, stage: 'source', message: `Could not pack the source: ${e instanceof Error ? e.message : String(e)}` };
  }

  const token = await gcpAccessToken();
  if (!token) {
    return { ok: false, stage: 'auth', message: 'The server could not authenticate to Google Cloud — check the service account (ADC) configuration.' };
  }

  const objectName = `sources/${opts.serviceId}/${opts.tag}.tgz`;
  try {
    const up = buildGcsUploadRequest(token, cfg.buildBucket, objectName, tgz);
    const res = await fetchImpl(up.url, { method: up.method, headers: up.headers, body: up.body });
    if (!res.ok) {
      return { ok: false, stage: 'upload', message: `Source upload failed (GCS returned ${res.status}) — check the ${cfg.buildBucket} bucket and the service account's storage role.` };
    }
  } catch (e) {
    return { ok: false, stage: 'upload', message: `Could not reach Cloud Storage: ${e instanceof Error ? e.message : String(e)}` };
  }

  const image = imagePathFor(cfg, opts.serviceId, opts.tag);
  try {
    const req = buildStartBuildRequest(token, { project: cfg.project, bucket: cfg.buildBucket, object: objectName, image });
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
    const json: any = await res.json().catch(() => null);
    const buildId = json?.metadata?.build?.id;
    if (!res.ok || typeof buildId !== 'string' || !buildId) {
      return { ok: false, stage: 'build-start', message: `Cloud Build refused the build (HTTP ${res.status}) — check the Cloud Build API and service-account roles.` };
    }
    return { ok: true, buildId, image, objectName };
  } catch (e) {
    return { ok: false, stage: 'build-start', message: `Could not reach Cloud Build: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export type AdvanceResult =
  | { phase: 'building' }
  | { phase: 'deploying' }
  | { phase: 'live'; url: string }
  | { phase: 'failed'; message: string; logUrl?: string };

/**
 * Move a deploy forward from REALITY: read Cloud Build; on SUCCESS create/update the Cloud Run
 * service with the built image (+ make it public) and report its readiness. Idempotent — safe to
 * call on every poll; a replayed step converges instead of duplicating.
 */
export async function advanceManagedDeploy(
  opts: {
    serviceId: string;
    buildId: string;
    image: string;
    limits: BackendLimits;
    appEnv: Record<string, string>;
    env?: NodeJS.ProcessEnv;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<AdvanceResult> {
  const cfg = managedBackendConfig(opts.env);
  if (!cfg.configured) return { phase: 'failed', message: `Managed backend is not configured — set ${cfg.missing.join(', ')}.` };
  const token = await gcpAccessToken();
  if (!token) return { phase: 'failed', message: 'The server could not authenticate to Google Cloud.' };

  // 1) Where is the build?
  let build: { phase: BuildPhase; logUrl?: string };
  try {
    const req = buildGetBuildRequest(token, cfg.project, opts.buildId);
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
    build = parseBuildStatus(await res.json().catch(() => null));
  } catch (e) {
    return { phase: 'failed', message: `Could not read the build status: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (build.phase === 'QUEUED' || build.phase === 'WORKING') return { phase: 'building' };
  if (build.phase !== 'SUCCESS') {
    return { phase: 'failed', message: `The container build ended ${build.phase} — open the build log for the exact compiler/npm error.`, logUrl: build.logUrl };
  }

  // 2) Build done — is the service already running this image?
  let existing: { found: boolean; ready: boolean; url: string | null; deployedImage: string | null };
  try {
    const req = buildGetServiceRequest(token, cfg.project, cfg.region, opts.serviceId);
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
    if (res.status === 404) existing = { found: false, ready: false, url: null, deployedImage: null };
    else {
      const parsed = parseServiceStatus(await res.json().catch(() => null));
      existing = { found: true, ...parsed };
    }
  } catch (e) {
    return { phase: 'failed', message: `Could not read the service status: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (existing.found && existing.deployedImage === opts.image) {
    if (existing.ready && existing.url) return { phase: 'live', url: existing.url };
    return { phase: 'deploying' }; // revision still rolling out
  }

  // 3) Point the service at the new image (create on first deploy, update after).
  const body = cloudRunServiceBody({ image: opts.image, limits: opts.limits, env: opts.appEnv });
  try {
    const req = existing.found
      ? buildUpdateServiceRequest(token, { project: cfg.project, region: cfg.region, serviceId: opts.serviceId, body })
      : buildCreateServiceRequest(token, { project: cfg.project, region: cfg.region, serviceId: opts.serviceId, body });
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
    if (!res.ok && res.status !== 409) { // 409 = concurrent create already happened — converge, don't fail
      return { phase: 'failed', message: `Cloud Run rejected the deploy (HTTP ${res.status}) — check the service account's run.admin role.` };
    }
  } catch (e) {
    return { phase: 'failed', message: `Could not reach Cloud Run: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 4) Public invoker — idempotent; a user site that 403s for visitors is not "live".
  try {
    const req = buildSetPublicRequest(token, cfg.project, cfg.region, opts.serviceId);
    await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
  } catch {
    /* transient IAM failure surfaces as a 403 site; the next poll retries it */
  }

  return { phase: 'deploying' };
}

export type ServiceProbe =
  | { found: true; ready: boolean; url: string | null }
  | { found: false };

/** Read-only service probe for status endpoints and the router. */
export async function probeService(
  serviceId: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ServiceProbe | { error: string }> {
  const cfg = managedBackendConfig(env);
  if (!cfg.configured) return { error: `Managed backend is not configured — set ${cfg.missing.join(', ')}.` };
  const token = await gcpAccessToken();
  if (!token) return { error: 'The server could not authenticate to Google Cloud.' };
  try {
    const req = buildGetServiceRequest(token, cfg.project, cfg.region, serviceId);
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
    if (res.status === 404) return { found: false };
    const parsed = parseServiceStatus(await res.json().catch(() => null));
    return { found: true, ready: parsed.ready, url: parsed.url };
  } catch (e) {
    return { error: `Could not reach Cloud Run: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Delete the app's Cloud Run service (app deletion). 404 = already gone = success. */
export async function deleteManagedService(
  serviceId: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const cfg = managedBackendConfig(env);
  if (!cfg.configured) return { ok: false, message: `Managed backend is not configured — set ${cfg.missing.join(', ')}.` };
  const token = await gcpAccessToken();
  if (!token) return { ok: false, message: 'The server could not authenticate to Google Cloud.' };
  try {
    const req = buildDeleteServiceRequest(token, cfg.project, cfg.region, serviceId);
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
    if (!res.ok && res.status !== 404) return { ok: false, message: `Cloud Run returned ${res.status} while deleting ${serviceId}.` };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `Could not reach Cloud Run: ${e instanceof Error ? e.message : String(e)}` };
  }
}
