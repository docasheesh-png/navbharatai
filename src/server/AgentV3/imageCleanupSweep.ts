// THE DAILY IMAGE CLEANUP — the one hosting cost that only ever went up.
//
// Reads every image in the apps registry, asks Cloud Run which of them are actually running, and
// deletes what it can PROVE is safe to delete. The rules live in `imageRetention.ts` and are pure;
// this file is the wiring, the bounds, and the honest report.
//
// 🔒 NEVER THROWS. A sweep that crashed would take the whole scheduler down with it — every other
// scheduled job included — and the failure mode of this one must always be "we cleaned less than we
// could have", never "the platform broke".
//
// 🔒 AND IT IS DELIBERATELY THE ONLY DELETING PATH. A publish does not clean up after itself, which
// looks like the obvious place to do it. It is not: at publish time the new service revision has only
// just been created, so "the old image is unused now" is an assumption about a state that is still
// settling. A sweep a day later reads the state instead of assuming it — and it also sees the images
// of apps that were TAKEN DOWN, which no publish will ever run for again.

import { GoogleAuth } from 'google-auth-library';
import { appsProject, appsRegion } from './cloudRunHosting';
import { appsImageRepo, buildStagingBucket } from './containerBuild';
import {
  buildListImagesRequest, parseImageList, buildListRevisionsRequest, parseRevisionImages,
  buildDeleteVersionRequest, splitImageRefs, decideImagePrune, versionsSizeMb,
  cleanupMode, keepImages, minImageAgeMs, maxDeletesPerRun,
  buildListSourceObjectsRequest, parseSourceObjectList, buildDeleteSourceObjectRequest,
  decideSourcePrune, sourcesSizeMb,
  type ImageVersion, type ServiceUsage, type SourceObject,
} from './imageRetention';

export interface ImageCleanupResult {
  /** 'off' | 'report' | 'on' — what the run was allowed to do. */
  mode: string;
  /** Images seen across the whole repository. */
  scanned: number;
  /** Apps (registry packages) the scan covered. */
  apps: number;
  /** Images actually deleted. Always 0 in `report` mode. */
  deleted: number;
  /** Images the rules would have deleted — equals `deleted` on a complete `on` run. */
  eligible: number;
  /** MB reclaimed, or null when the registry reported no sizes. */
  reclaimedMb: number | null;
  /** True when the per-run delete bound stopped the run early — more waste remains. */
  boundHit: boolean;
  /**
   * Was the registry read in full?
   *
   * 🔒 REPORTED, NOT ASSUMED — the same reason `SweepResult.registryComplete` exists. An empty list
   * means both "nothing to clean" and "the read failed", and a run that concluded the first from the
   * second would look exactly like a tidy month.
   */
  complete: boolean;
  /** Staged Cloud Build source archives deleted. The rule-3 sibling of the image leak. */
  sourcesDeleted: number;
  /** MB of staged source reclaimed, or null when storage reported no sizes. */
  sourcesReclaimedMb: number | null;
  /** One admin line per app. Never user-facing — these name our own infrastructure. */
  notes: string[];
}

function emptyResult(mode: string): ImageCleanupResult {
  return {
    mode, scanned: 0, apps: 0, deleted: 0, eligible: 0, reclaimedMb: null, boundHit: false,
    complete: false, sourcesDeleted: 0, sourcesReclaimedMb: null, notes: [],
  };
}

/**
 * What is this app's service running right now?
 *
 * The three answers are the safety model — see `ServiceUsage`. Note that a 404 is a FACT (the service
 * does not exist, so nothing can pull its images) while every other failure is an absence of one.
 */
async function readServiceUsage(
  token: string, projectId: string, region: string, service: string, fetchImpl: typeof fetch,
): Promise<ServiceUsage> {
  try {
    const req = buildListRevisionsRequest(token, projectId, region, service);
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
    if (res.status === 404) return { kind: 'no-service' };
    if (!res.ok) return { kind: 'unknown', reason: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    if (body === null) return { kind: 'unknown', reason: 'unreadable response' };
    const { digests, tags } = splitImageRefs(parseRevisionImages(body));
    return { kind: 'in-use', digests, tags };
  } catch (e) {
    return { kind: 'unknown', reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function runImageCleanupSweep(opts?: {
  now?: number;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Hard ceiling on pages read, so a runaway registry cannot make this run for ever. */
  maxPages?: number;
}): Promise<ImageCleanupResult> {
  const env = opts?.env ?? process.env;
  const mode = cleanupMode(env);
  const out = emptyResult(mode);
  if (mode === 'off') {
    out.complete = true;
    return out;
  }

  const nowMs = opts?.now ?? Date.now();
  const fetchImpl = opts?.fetchImpl ?? fetch;

  const project = appsProject(env);
  if (!project.projectId) {
    out.notes.push(`Image cleanup skipped: ${project.message}`);
    return out;
  }
  const region = appsRegion(env);
  const repo = appsImageRepo(env);

  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const token = await auth.getAccessToken().catch(() => null);
  if (!token) {
    out.notes.push('Image cleanup skipped: could not authenticate with Google Cloud. Nothing was deleted.');
    return out;
  }

  // ── 1. Everything in the repository, grouped by app ────────────────────────────────────────────
  const byService = new Map<string, ImageVersion[]>();
  let pageToken = '';
  let pages = 0;
  const maxPages = Math.max(1, opts?.maxPages ?? 25);
  let readComplete = false;
  while (pages < maxPages) {
    pages++;
    const req = buildListImagesRequest(token, project.projectId, region, repo, 200, pageToken);
    let body: unknown = null;
    try {
      const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
      if (res.status === 404) {
        // The repository does not exist yet — nothing has ever been published. Not a failure.
        out.complete = true;
        return out;
      }
      if (!res.ok) {
        out.notes.push(`Could not list images (HTTP ${res.status}) — cleaned only what was already read.`);
        break;
      }
      body = await res.json().catch(() => null);
    } catch (e) {
      out.notes.push(`Could not reach the registry (${e instanceof Error ? e.message : String(e)}) — cleaned only what was already read.`);
      break;
    }
    if (body === null) {
      out.notes.push('The registry answered with something unreadable — cleaned only what was already read.');
      break;
    }
    const { images, nextPageToken } = parseImageList(body);
    for (const img of images) {
      const list = byService.get(img.service) ?? [];
      list.push(img);
      byService.set(img.service, list);
      out.scanned++;
    }
    if (!nextPageToken) { readComplete = true; break; }
    pageToken = nextPageToken;
  }
  if (!readComplete && pages >= maxPages) {
    out.notes.push(`Stopped after ${maxPages} pages — the rest is read on the next run.`);
  }
  out.complete = readComplete;
  out.apps = byService.size;

  // ⚠️ NO EARLY RETURN ON AN EMPTY REGISTRY, and a test pins it. There used to be one, and it was
  // wrong for a reason that is invisible from here: staged build SOURCES are cleaned in step 3, and
  // they outlive their images — a repository drained to zero (or one that never built) can still be
  // holding a bucket full of tarballs. Returning early made the sibling fix dead code in exactly the
  // case it was needed most.

  // ── 2. Per app: what is live, what may go ──────────────────────────────────────────────────────
  const keep = keepImages(env);
  const minAge = minImageAgeMs(env);
  const maxDeletes = maxDeletesPerRun(env);
  const removed: ImageVersion[] = [];

  for (const [service, versions] of byService) {
    const usage = await readServiceUsage(token, project.projectId, region, service, fetchImpl);
    const decision = decideImagePrune({ versions, usage, keep, minAgeMs: minAge, now: nowMs });
    out.eligible += decision.prune.length;

    if (decision.prune.length === 0) {
      if (usage.kind === 'unknown') {
        out.notes.push(`${service}: ${versions.length} image(s), service state unreadable (${usage.reason}) — nothing deleted.`);
      }
      continue;
    }

    const where = usage.kind === 'no-service' ? 'app no longer hosted' : 'superseded';
    if (mode === 'report') {
      const mb = versionsSizeMb(decision.prune);
      out.notes.push(`${service}: would delete ${decision.prune.length} of ${versions.length} image(s) (${where})${mb === null ? '' : `, ~${mb} MB`}.`);
      continue;
    }

    let deletedHere = 0;
    for (const v of decision.prune) {
      if (out.deleted >= maxDeletes) { out.boundHit = true; break; }
      const req = buildDeleteVersionRequest(token, v.versionName);
      let ok = false;
      try {
        const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
        // A 404 is success: the goal is "this image is gone", and it already is.
        ok = res.ok || res.status === 404;
        if (!ok) out.notes.push(`${service}: could not delete ${v.digest.slice(0, 19)}… (HTTP ${res.status}).`);
      } catch (e) {
        out.notes.push(`${service}: could not delete ${v.digest.slice(0, 19)}… (${e instanceof Error ? e.message : String(e)}).`);
      }
      if (ok) { out.deleted++; deletedHere++; removed.push(v); }
    }
    if (deletedHere > 0) {
      const mb = versionsSizeMb(removed.slice(-deletedHere));
      out.notes.push(`${service}: deleted ${deletedHere} of ${versions.length} image(s) (${where})${mb === null ? '' : `, ~${mb} MB reclaimed`}.`);
    }
    if (out.boundHit) break;
  }

  out.reclaimedMb = removed.length > 0 ? versionsSizeMb(removed) : null;

  // ── 3. The sibling: staged Cloud Build sources, which nothing has ever deleted either ──────────
  await sweepStagedSources({
    token, bucket: buildStagingBucket(project.projectId, env),
    minAgeMs: minAge, maxDeletes, mode, now: nowMs, fetchImpl, out,
  });

  if (out.boundHit) {
    out.notes.push(`Stopped at the ${maxDeletes}-delete bound for this run; the backlog drains over the next few days. `
      + 'For a large one-off drain, set a native Artifact Registry cleanup policy instead of raising this — '
      + 'it runs server-side and off our path.');
  }
  return out;
}


/**
 * DELETE THE STAGED SOURCE ARCHIVES A BUILD NO LONGER NEEDS.
 *
 * Bounded by the same per-run budget as the images and sharing its `boundHit` flag, so one run can
 * never become unbounded by having two halves that each think they are the only one spending. Its own
 * failures are notes, never throws — see this file's header.
 */
async function sweepStagedSources(o: {
  token: string;
  bucket: string;
  minAgeMs: number;
  maxDeletes: number;
  mode: string;
  now: number;
  fetchImpl: typeof fetch;
  out: ImageCleanupResult;
}): Promise<void> {
  const objects: SourceObject[] = [];
  let pageToken = '';
  for (let page = 0; page < 25; page++) {
    const req = buildListSourceObjectsRequest(o.token, o.bucket, pageToken);
    let body: unknown = null;
    try {
      const res = await o.fetchImpl(req.url, { method: req.method, headers: req.headers });
      // The staging bucket is created by Cloud Build on its first run; before that it does not exist,
      // and there is nothing staged to clean. Not a failure.
      if (res.status === 404) return;
      if (!res.ok) {
        o.out.notes.push(`Could not list staged build sources (HTTP ${res.status}) — none removed.`);
        return;
      }
      body = await res.json().catch(() => null);
    } catch (e) {
      o.out.notes.push(`Could not reach storage for staged build sources (${e instanceof Error ? e.message : String(e)}) — none removed.`);
      return;
    }
    if (body === null) return;
    const { objects: page1, nextPageToken } = parseSourceObjectList(body);
    objects.push(...page1);
    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }

  const stale = decideSourcePrune({ objects, minAgeMs: o.minAgeMs, now: o.now });
  if (stale.length === 0) return;

  if (o.mode === 'report') {
    const mb = sourcesSizeMb(stale);
    o.out.notes.push(`staged sources: would delete ${stale.length} of ${objects.length}${mb === null ? '' : `, ~${mb} MB`}.`);
    return;
  }

  const gone: SourceObject[] = [];
  for (const obj of stale) {
    if (o.out.deleted + o.out.sourcesDeleted >= o.maxDeletes) { o.out.boundHit = true; break; }
    const req = buildDeleteSourceObjectRequest(o.token, o.bucket, obj.name);
    try {
      const res = await o.fetchImpl(req.url, { method: req.method, headers: req.headers });
      // A 404 is success — the goal is "this object is gone", and it already is.
      if (res.ok || res.status === 404) { o.out.sourcesDeleted++; gone.push(obj); }
      else o.out.notes.push(`staged sources: could not delete ${obj.name} (HTTP ${res.status}).`);
    } catch (e) {
      o.out.notes.push(`staged sources: could not delete ${obj.name} (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
  if (gone.length > 0) {
    o.out.sourcesReclaimedMb = sourcesSizeMb(gone);
    o.out.notes.push(`staged sources: deleted ${gone.length} of ${objects.length}${o.out.sourcesReclaimedMb === null ? '' : `, ~${o.out.sourcesReclaimedMb} MB reclaimed`}.`);
  }
}
