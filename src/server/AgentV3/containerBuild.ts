// Turning a user's source into a runnable container — without a Dockerfile, and without GitHub.
// (ROADMAP §11, slice 1b. The half that feeds cloudRunHosting.ts an image to deploy.)
//
// WHY BUILDPACKS. Asking the engine to author a Dockerfile means getting base images, layer caching,
// non-root users and signal handling right for every stack a user might build — and being wrong in a
// way that only shows up in production. Google's buildpacks already do that for Node and Python: they
// read the project, install its dependencies and produce an image that starts correctly. Nothing to
// author, nothing to get subtly wrong.
//
// WHY THIS REMOVES GITHUB FROM THE PATH. Render reads code from a repository, which is why hosting a
// backend has meant "first put this app in a repo". Cloud Build reads it from a Cloud Storage object —
// so the app goes straight from NavBharatAI's own durable store to a running service, and the user
// never learns that either system exists.
//
// 🔒 EVERY BUILD IS BOUNDED. Build minutes are one of the four cost lines D5 bills for, so the timeout
// here is a money decision, not a nicety: a build that has not finished in fifteen minutes is not
// going to, and letting it run is spending the user's wallet on nothing.
//
// Pure builders + injectable `fetch`, in the same shape as cloudRunHosting.ts and renderDeploy.ts.

export const BUILD_API = 'https://cloudbuild.googleapis.com/v1';
export const GCS_UPLOAD_API = 'https://storage.googleapis.com/upload/storage/v1';

/**
 * The buildpacks builder. Pinned to a named version rather than `:latest`, deliberately — an image
 * that changes under us would change how every user's app is built, with nothing on our side failing
 * to reveal it. This codebase has paid for stale-vs-floating versions before; a pinned builder is
 * upgraded on purpose, in a commit somebody reviewed.
 */
export const BUILDPACKS_BUILDER = 'gcr.io/buildpacks/builder:v1';

/** The image that runs `pack` inside Cloud Build. */
export const PACK_IMAGE = 'gcr.io/k8s-skaffold/pack';

/** A build that has not finished in this long is not going to. Build minutes are billed (D5). */
export const BUILD_TIMEOUT_SECONDS = 900;

/** The Artifact Registry repository user app images live in, inside the apps project. */
export function appsImageRepo(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.NAVBHARAT_APPS_IMAGE_REPO ?? '').trim() || 'nbai-apps';
}

/**
 * Where source archives are staged for Cloud Build.
 *
 * Defaults to Cloud Build's own convention (`<project>_cloudbuild`), which is the bucket it creates
 * for exactly this purpose — so the common case needs no extra setup step in the admin checklist.
 */
export function buildStagingBucket(projectId: string, env: NodeJS.ProcessEnv = process.env): string {
  return String(env.NAVBHARAT_APPS_BUILD_BUCKET ?? '').trim() || `${projectId}_cloudbuild`;
}

/**
 * The full image address for one app's build.
 *
 * The TAG is what makes a deploy honest: a fresh tag per build means Cloud Run is asked to run
 * precisely the image this build produced. Reusing a moving tag like `latest` would let a deploy
 * silently serve a previous build when a new one failed — a working app reported as the new one.
 * PURE.
 */
export function imageUriFor(projectId: string, region: string, service: string, tag: string, repo = 'nbai-apps'): string {
  return `${region}-docker.pkg.dev/${projectId}/${repo}/${service}:${tag}`;
}

/** A build tag from the moment it was requested: sortable, unique enough, readable in a console. PURE. */
export function buildTag(nowMs: number, salt = ''): string {
  const t = new Date(nowMs).toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const s = String(salt).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 6);
  return s ? `${t}-${s}` : t;
}

/** Where in the staging bucket this app's source goes. PURE. */
export function sourceObjectFor(service: string, tag: string): string {
  return `nbai-source/${service}/${tag}.tar.gz`;
}

export interface BuildRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string | Buffer;
}

/** Upload the source archive. Content type matters — Cloud Build reads it as a gzipped tarball. PURE. */
export function buildUploadSourceRequest(token: string, bucket: string, object: string, data: Buffer): BuildRequest {
  return {
    url: `${GCS_UPLOAD_API}/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(object)}`,
    method: 'POST',
    headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/gzip' },
    body: data,
  };
}

export interface CreateBuildInput {
  bucket: string;
  object: string;
  image: string;
}

/**
 * The Cloud Build job: unpack the staged source, build it with buildpacks, push the image.
 *
 * `--publish` makes `pack` push directly, so the image exists the moment the build succeeds and there
 * is no second step that could fail after we have already reported success. PURE.
 */
export function buildCreateBuildRequest(token: string, projectId: string, region: string, input: CreateBuildInput): BuildRequest {
  return {
    url: `${BUILD_API}/projects/${projectId}/locations/${region}/builds`,
    method: 'POST',
    headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: { storageSource: { bucket: input.bucket, object: input.object } },
      steps: [{
        name: PACK_IMAGE,
        entrypoint: 'pack',
        args: ['build', input.image, `--builder=${BUILDPACKS_BUILDER}`, '--path=.', '--publish'],
      }],
      timeout: `${BUILD_TIMEOUT_SECONDS}s`,
    }),
  };
}

export function buildGetBuildRequest(token: string, projectId: string, region: string, buildId: string): BuildRequest {
  return {
    url: `${BUILD_API}/projects/${projectId}/locations/${region}/builds/${encodeURIComponent(buildId)}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token.trim()}` },
  };
}

/**
 * What a Cloud Build status MEANS, collapsed to the answers a caller can act on.
 *
 * 🔒 AN UNKNOWN STATUS IS ITS OWN ANSWER — the same rule renderDeployStatus.ts follows. Google can add
 * a status tomorrow, and mapping the unfamiliar onto success would report a container that does not
 * exist as ready to deploy. PURE.
 */
export type BuildPhase = 'success' | 'failed' | 'in-progress' | 'unknown';

export function buildPhase(status: string | null | undefined): BuildPhase {
  const s = String(status ?? '').trim().toUpperCase();
  if (!s) return 'unknown';
  if (s === 'SUCCESS') return 'success';
  if (s === 'FAILURE' || s === 'INTERNAL_ERROR' || s === 'TIMEOUT' || s === 'CANCELLED' || s === 'EXPIRED') return 'failed';
  if (s === 'QUEUED' || s === 'WORKING' || s === 'PENDING' || s === 'STATUS_UNKNOWN') return 'in-progress';
  return 'unknown';
}

export interface ParsedBuild {
  id: string;
  status: string;
  phase: BuildPhase;
  /** Cloud Build's own detail, for the ADMIN report — never shown raw to a user. */
  detail: string;
  logUrl: string;
}

/** Read a build from a create (Operation) or a get response. PURE. */
export function parseBuild(raw: unknown): ParsedBuild | null {
  const r = raw && typeof raw === 'object' ? raw as Record<string, any> : null;
  // A create returns an Operation whose `metadata.build` holds the build; a get returns it directly.
  const b = r?.metadata?.build ?? r?.build ?? r;
  if (!b || typeof b !== 'object' || typeof b.id !== 'string' || !b.id.trim()) return null;
  const status = typeof b.status === 'string' ? b.status : '';
  return {
    id: b.id.trim(),
    status,
    phase: buildPhase(status),
    detail: typeof b.statusDetail === 'string' ? b.statusDetail : '',
    logUrl: typeof b.logUrl === 'string' ? b.logUrl : '',
  };
}

/**
 * What to tell a user whose build did not produce a container.
 *
 * A failed build is almost always the APP's problem — a missing dependency, a script that exits — and
 * that is genuinely fixable, so the message says so rather than implying the platform broke. It never
 * invents a cause it does not know. PURE.
 */
export function buildFailureMessage(phase: BuildPhase, status: string): string {
  if (phase === 'failed' && String(status).toUpperCase() === 'TIMEOUT') {
    return `Your app took longer than ${Math.round(BUILD_TIMEOUT_SECONDS / 60)} minutes to build, so it was stopped. `
      + 'That usually means a dependency install that never finishes. Nothing was deployed.';
  }
  if (phase === 'failed') {
    return 'Your app could not be built into something runnable. That is usually a missing dependency or a '
      + 'build script that fails — ask NavBharatAI to fix the build and try again. Nothing was deployed.';
  }
  return 'We could not confirm your app finished building. Nothing was deployed, and your app is unchanged.';
}

export type ContainerBuildResult =
  | { ok: true; image: string; buildId: string }
  | { ok: false; reason: 'upload-failed' | 'refused' | 'build-failed' | 'timed-out'; message: string; buildId?: string; detail?: string };

/**
 * Upload the source, run the build, and wait for an image. NEVER throws.
 *
 * The wait is a bounded poll rather than one long request: a build takes minutes we do not control,
 * and holding a request open for them trades an honest slow answer for a timeout that says nothing.
 */
export async function buildAppContainer(
  opts: {
    token: string;
    projectId: string;
    region: string;
    bucket: string;
    service: string;
    tag: string;
    archive: Buffer;
    imageRepo?: string;
    /** Bounded wait for the build. Never longer than the build's own timeout. */
    maxWaitMs?: number;
    pollMs?: number;
  },
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<ContainerBuildResult> {
  const image = imageUriFor(opts.projectId, opts.region, opts.service, opts.tag, opts.imageRepo ?? 'nbai-apps');
  const object = sourceObjectFor(opts.service, opts.tag);
  try {
    const up = buildUploadSourceRequest(opts.token, opts.bucket, object, opts.archive);
    const upRes = await fetchImpl(up.url, { method: up.method, headers: up.headers, body: up.body as any });
    if (!upRes.ok) {
      return {
        ok: false,
        reason: 'upload-failed',
        message: `Your app's files could not be sent to the build service (HTTP ${upRes.status}). Nothing was `
          + 'deployed, and your app is safe here.',
      };
    }

    const create = buildCreateBuildRequest(opts.token, opts.projectId, opts.region, { bucket: opts.bucket, object, image });
    const createRes = await fetchImpl(create.url, { method: create.method, headers: create.headers, body: create.body as any });
    if (!createRes.ok) {
      return {
        ok: false,
        reason: 'refused',
        message: `The build service refused to start (HTTP ${createRes.status}). Nothing was deployed.`,
      };
    }
    const started = parseBuild(await createRes.json().catch(() => null));
    if (!started) {
      // A 2xx we cannot read is NOT a started build: claiming one would leave the caller waiting for
      // an image that nothing is producing.
      return { ok: false, reason: 'refused', message: 'The build service accepted the request but did not say which build it started. Nothing was deployed.' };
    }

    const deadline = Date.now() + (opts.maxWaitMs ?? BUILD_TIMEOUT_SECONDS * 1000);
    let last: ParsedBuild = started;
    while (Date.now() < deadline) {
      if (last.phase === 'success') return { ok: true, image, buildId: last.id };
      if (last.phase === 'failed') {
        return { ok: false, reason: 'build-failed', message: buildFailureMessage(last.phase, last.status), buildId: last.id, detail: last.detail || last.logUrl };
      }
      await sleep(opts.pollMs ?? 10_000);
      const get = buildGetBuildRequest(opts.token, opts.projectId, opts.region, last.id);
      const getRes = await fetchImpl(get.url, { method: get.method, headers: get.headers });
      const next = getRes.ok ? parseBuild(await getRes.json().catch(() => null)) : null;
      // A lost poll is not a failed build — keep the previous reading and try again inside the window.
      if (next) last = next;
    }
    if (last.phase === 'success') return { ok: true, image, buildId: last.id };
    if (last.phase === 'failed') {
      return { ok: false, reason: 'build-failed', message: buildFailureMessage(last.phase, last.status), buildId: last.id, detail: last.detail || last.logUrl };
    }
    return {
      ok: false,
      reason: 'timed-out',
      message: 'Your app is still building. Nothing was deployed yet — try again in a few minutes.',
      buildId: last.id,
    };
  } catch (e) {
    return {
      ok: false,
      reason: 'refused',
      message: `Could not reach the build service: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`,
    };
  }
}
