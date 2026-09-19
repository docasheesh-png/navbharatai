// THE ONE HOSTING COST THAT NEVER GOES DOWN — and, until this file, nothing deleted it.
//
// 🔴 THE GAP. Every publish of a user app pushes a NEW immutable container image to Artifact Registry
// (`containerBuild.ts` tags each build with the moment it was requested, precisely so a deploy can
// never serve a previous build by accident). Nothing removed the previous one — not a republish, not
// a takedown. `deleteHostedService` gives the Cloud Run SERVICE slot back and leaves every image the
// app ever built sitting in the registry, billed per GB-month, for ever.
//
// 🔑 WHY THIS RANKS ABOVE THE TRAFFIC METER. Every other hosting cost is a FLOW: it rises with
// visitors and falls when they leave, and the ₹20/GB overage is sized against it. Registry storage is
// a STOCK — it only ever accumulates, no overage offsets it, and an app nobody has opened in a year
// still pays for it monthly. A buildpacks Node image is a few hundred MB, so ten apps republished
// weekly is tens of GB a year that no revenue line is attached to.
//
// 🔒 WHY IT IS NOT AN ARTIFACT REGISTRY CLEANUP POLICY, which would be free and server-side and is
// genuinely the better tool for the shape of problem it fits. A native policy can keep the N newest
// versions and delete the rest — but it CANNOT see Cloud Run. It would happily delete the image the
// live service is still running, and with `minInstanceCount: 0` a cold start RE-PULLS that image, so
// the app dies at the next visitor with nothing in our code to explain it. "Keep the newest N" is not
// a substitute for that guard, and the case where it is worst is the one that matters most: when a
// publish has FAILED, traffic stays on an OLDER revision while the newer, broken images push the live
// one out of the newest-N window. That is this repo's own hard-won finding — `cloudbuild.yaml` says it
// in those words about the PLATFORM's image, and the guards below are the same guards.
//
// ⚠️ UPDATED 2026-09-18: the platform's own in-build prune (its Step 5) was REMOVED, because running a
// delete on the DEPLOY PATH let it race a concurrent build's freshly pushed image — a failure mode
// orthogonal to the guards here, and one this sweep cannot have because it runs on a schedule, alone,
// hours from any deploy. The platform registry is now covered by a native cleanup policy set in the
// console, with the Cloud-Run blindness above accepted there for the reason `cloudbuild.yaml` records:
// one service that deploys in order, so the bad case needs a long run of consecutive failed deploys.
//
// A native policy is still worth setting as a BACKSTOP for a registry that has already accumulated a
// backlog; it is an admin action, recorded in the sweep's notes rather than performed from here.
//
// EVERYTHING HERE IS PURE. The sweep that calls it is `imageCleanupSweep.ts`.

export const ARTIFACT_REGISTRY_API = 'https://artifactregistry.googleapis.com/v1';

/**
 * How many of an app's newest images survive, beyond whatever is in use.
 *
 * Three, not one: the newest is normally what is running, so keeping only that would leave nothing to
 * roll back TO the moment a bad publish went out. The platform's own image kept fifteen, and
 * `cloudbuild.yaml` explains why five was too few — but that is one image for one service that deploys
 * many times a day, whereas this is one image per USER APP and the multiplier is the number of apps.
 * Three covers "undo the last publish, and the one before it" and stops there.
 */
export const DEFAULT_KEEP_IMAGES = 3;

/**
 * Nothing younger than this is ever considered, whatever else is true of it.
 *
 * The guard is for an image that exists but is not yet attached to any revision — a publish that is
 * in flight RIGHT NOW. Its image is pushed before the service is updated, so for a window of seconds
 * to minutes it is both the newest thing in the registry and referenced by nothing. Twenty-four hours
 * is far more than that window needs, which is the point: the cost of being generous here is a day of
 * storage, and the cost of being tight is deleting a user's app mid-publish.
 */
export const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The most versions one run may delete.
 *
 * ⚠️ THIS BOUND IS NOT TIDINESS — it is a regression this repo has already paid for once. The first
 * registry cleanup in `cloudbuild.yaml` (since removed — see that file) deleted in an unbounded loop,
 * ran for about an hour against an accumulated backlog, and turned five-minute deploys into timeouts. A backlog drains over a few runs;
 * steady state is a handful of versions a day. Bounded work that always finishes beats complete work
 * that sometimes does not.
 */
export const DEFAULT_MAX_DELETES = 50;

export type CleanupMode = 'off' | 'report' | 'on';

/**
 * Is the sweep deleting, reporting, or asleep?
 *
 * DEFAULT IS `on`, and the reasoning is worth stating because a deleting job defaulting to on is not
 * the obvious choice. Hosting is admin-only today (`NAVBHARAT_CLOUD_PUBLIC` is deliberately unset), so
 * the only apps that exist to clean are the admin's own — the sweep proves itself on them before any
 * user has an app at all, and by the time hosting opens the cost is already bounded. An opt-in flag
 * would mean the one cost that never goes down carries on not going down until somebody remembers.
 *
 * `report` is the middle setting: measure everything, name every version that WOULD go, delete none.
 * PURE.
 */
export function cleanupMode(env: NodeJS.ProcessEnv = process.env): CleanupMode {
  const raw = String(env.NAVBHARAT_IMAGE_CLEANUP ?? '').trim().toLowerCase();
  if (!raw) return 'on';
  if (raw === 'off' || raw === 'false' || raw === '0') return 'off';
  if (raw === 'report' || raw === 'dry' || raw === 'dry-run') return 'report';
  return 'on';
}

/**
 * Read a positive integer knob, treating EMPTY as unset rather than as zero.
 *
 * ⚠️ `Number('')` is 0 — finite, non-negative, and therefore accepted by the obvious implementation.
 * A key set with no value in Cloud Run would then mean "keep zero images" or "delete nothing", either
 * of which is a silent behaviour change with nothing in the logs to explain it. The same trap
 * `hostingStorageCapMb` and `maxHostedSourceMb` document. PURE.
 */
function positiveKnob(raw: unknown, fallback: number, min: number, max: number): number {
  const s = String(raw ?? '').trim();
  if (!s) return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function keepImages(env: NodeJS.ProcessEnv = process.env): number {
  return positiveKnob(env.NAVBHARAT_IMAGE_KEEP, DEFAULT_KEEP_IMAGES, 1, 100);
}

export function minImageAgeMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveKnob(env.NAVBHARAT_IMAGE_MIN_AGE_HOURS, DEFAULT_MIN_AGE_MS / 3_600_000, 1, 24 * 30) * 3_600_000;
}

export function maxDeletesPerRun(env: NodeJS.ProcessEnv = process.env): number {
  return positiveKnob(env.NAVBHARAT_IMAGE_MAX_DELETES, DEFAULT_MAX_DELETES, 1, 500);
}

/** One image in the registry, as `dockerImages` reports it. */
export interface ImageVersion {
  /** The package this image belongs to — for us, the Cloud Run service name. */
  service: string;
  /** `sha256:…`. */
  digest: string;
  /** The resource a DELETE addresses: `…/packages/<service>/versions/sha256:…`. */
  versionName: string;
  /** Epoch ms it was PUSHED, or null when the registry did not say. */
  createdAtMs: number | null;
  /** Tags on this digest. A build tag, normally exactly one. */
  tags: string[];
  /** Compressed size in bytes, or null when the registry did not report one. */
  sizeBytes: number | null;
}

export interface RegistryRequest {
  url: string;
  method: 'GET' | 'DELETE';
  headers: Record<string, string>;
}

function registryHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token.trim()}` };
}

/** Where a repository lives, as the registry addresses it. PURE. */
export function repositoryPath(projectId: string, region: string, repo: string): string {
  return `projects/${projectId}/locations/${region}/repositories/${repo}`;
}

/**
 * List every image in the apps repository.
 *
 * 🔑 `dockerImages`, NOT `packages` + `versions` — and the difference is more than a saved round trip.
 * One call returns every image across every app WITH its tags, its pushed time and its SIZE, so the
 * report can say how much storage was actually reclaimed instead of counting deletions. The versions
 * API reports no size at all, and would need one paged listing per app. PURE.
 */
export function buildListImagesRequest(
  token: string, projectId: string, region: string, repo: string, pageSize = 200, pageToken = '',
): RegistryRequest {
  const params = new URLSearchParams({ pageSize: String(Math.max(1, Math.min(1000, pageSize))) });
  if (pageToken) params.set('pageToken', pageToken);
  return {
    url: `${ARTIFACT_REGISTRY_API}/${repositoryPath(projectId, region, repo)}/dockerImages?${params.toString()}`,
    method: 'GET',
    headers: registryHeaders(token),
  };
}

/**
 * Delete one image.
 *
 * `force=true` deletes the tags pointing at this digest along with it. Without it the registry refuses
 * to remove a tagged version, and every image we produce is tagged — so the un-forced call would fail
 * on literally all of them. PURE.
 */
export function buildDeleteVersionRequest(token: string, versionName: string): RegistryRequest {
  return {
    url: `${ARTIFACT_REGISTRY_API}/${String(versionName).replace(/^\/+/, '')}?force=true`,
    method: 'DELETE',
    headers: registryHeaders(token),
  };
}

/**
 * Turn a `dockerImages` row into the shape the decision works on. PURE.
 *
 * ⚠️ THE AGE COMES FROM `uploadTime`, NEVER `buildTime`, and this is a correctness choice rather than
 * a preference. Buildpacks reuse cached layers, so a freshly pushed image can carry a BUILD time from
 * days ago — which would make a brand-new image look old enough to delete. `cloudbuild.yaml` records
 * running into exactly that with `--sort-by=TIMESTAMP`, and names it as the reason the in-use guard
 * cannot be dropped — and then as half the reason its own prune had to leave the deploy path
 * altogether. Pushed time is the one clock that cannot be stale.
 */
export function parseImageList(raw: unknown): { images: ImageVersion[]; nextPageToken: string } {
  const r = raw && typeof raw === 'object' ? raw as Record<string, any> : null;
  const rows = Array.isArray(r?.dockerImages) ? r!.dockerImages : [];
  const images: ImageVersion[] = [];
  for (const row of rows) {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    if (!name) continue;
    // `…/repositories/<repo>/dockerImages/<service>@sha256:<digest>`
    const leaf = name.split('/').pop() ?? '';
    const at = leaf.lastIndexOf('@');
    if (at <= 0) continue;
    const service = decodeURIComponent(leaf.slice(0, at));
    const digest = leaf.slice(at + 1);
    if (!service || !digest.startsWith('sha256:')) continue;
    const base = name.slice(0, name.lastIndexOf('/dockerImages/'));
    const t = Date.parse(String(row?.uploadTime ?? ''));
    const size = Number(row?.imageSizeBytes);
    images.push({
      service,
      digest,
      versionName: `${base}/packages/${encodeURIComponent(service)}/versions/${digest}`,
      createdAtMs: Number.isFinite(t) ? t : null,
      tags: (Array.isArray(row?.tags) ? row.tags : []).map((x: unknown) => String(x ?? '').trim()).filter(Boolean),
      sizeBytes: Number.isFinite(size) && size >= 0 ? size : null,
    });
  }
  return { images, nextPageToken: typeof r?.nextPageToken === 'string' ? r.nextPageToken : '' };
}

/** List a hosted service's revisions — the in-use guard's only source of truth. PURE. */
export function buildListRevisionsRequest(
  token: string, projectId: string, region: string, service: string,
): RegistryRequest {
  return {
    url: `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/services/${encodeURIComponent(service)}/revisions?pageSize=100`,
    method: 'GET',
    headers: registryHeaders(token),
  };
}

/** The images a service's revisions reference, from a Cloud Run revisions list. PURE. */
export function parseRevisionImages(raw: unknown): string[] {
  const r = raw && typeof raw === 'object' ? raw as Record<string, any> : null;
  const rows = Array.isArray(r?.revisions) ? r!.revisions : [];
  const images: string[] = [];
  for (const rev of rows) {
    for (const c of Array.isArray(rev?.containers) ? rev.containers : []) {
      const img = typeof c?.image === 'string' ? c.image.trim() : '';
      if (img) images.push(img);
    }
  }
  return images;
}

/**
 * Split the image references a service is running into the digests and tags the guard compares on.
 *
 * An image reference is either `…/name@sha256:…` or `…/name:tag`, and a service can hold both shapes
 * at once (Cloud Run rewrites what it was given). Matching only one of them would leave the other
 * unprotected, which is the quiet version of deleting a running image. PURE.
 */
export function splitImageRefs(refs: readonly string[]): { digests: string[]; tags: string[] } {
  const digests = new Set<string>();
  const tags = new Set<string>();
  for (const ref of refs) {
    const s = String(ref ?? '').trim();
    if (!s) continue;
    const at = s.lastIndexOf('@');
    if (at >= 0) {
      const d = s.slice(at + 1).trim();
      if (d) digests.add(d);
      continue;
    }
    // Only a colon AFTER the last slash is a tag — a registry host may carry a port (`host:443/…`).
    const lastSlash = s.lastIndexOf('/');
    const colon = s.indexOf(':', lastSlash + 1);
    if (colon > -1) {
      const t = s.slice(colon + 1).trim();
      if (t) tags.add(t);
    }
  }
  return { digests: [...digests], tags: [...tags] };
}

/**
 * WHAT WE KNOW ABOUT THE SERVICE THAT WOULD BE PROTECTING THESE IMAGES — three answers, not two.
 *
 * 🔴 THE TWO-ANSWER VERSION HAS A TRAP THAT MAKES THE WHOLE FEATURE USELESS, and it is worth naming
 * because it is the natural design. "Either we read the revisions, or we prune nothing" is correct
 * about safety and catastrophic about the largest pile of waste there is: an app that was TAKEN DOWN.
 * Its service is gone, so the revision list 404s, so the cautious rule refuses to prune — for ever.
 * The images of every deleted app would be the one thing this sweep could never touch, which is
 * exactly backwards: they are the only images nothing can possibly be running.
 *
 * So a CONFIRMED absence and a FAILED read are different facts and are kept apart:
 *  • `in-use`     — the revision list was read; these digests and tags are live and are protected.
 *  • `no-service` — the service genuinely does not exist (a 404 from Cloud Run). Nothing can pull
 *                   these images, so only the age floor still applies.
 *  • `unknown`    — we could not tell. Prune NOTHING. Refusing to clean is free; guessing is not.
 */
export type ServiceUsage =
  | { kind: 'in-use'; digests: string[]; tags: string[] }
  | { kind: 'no-service' }
  | { kind: 'unknown'; reason: string };

export interface PruneDecision {
  /** Images safe to delete, oldest first. */
  prune: ImageVersion[];
  /** Images kept, each with the reason — this is what the admin report prints. */
  kept: Array<{ version: ImageVersion; reason: string }>;
}

/**
 * WHICH OF ONE APP'S IMAGES MAY GO. The whole safety model of this feature is these ~40 lines.
 *
 * Order matters: the in-use check runs BEFORE the keep-newest count, so an image that is running is
 * protected whether or not it is recent. That is the failed-publish case — traffic sits on an older
 * revision while newer broken images crowd it out of the newest-N window — and reversing the two
 * would quietly reintroduce it. PURE.
 */
export function decideImagePrune(input: {
  versions: readonly ImageVersion[];
  usage: ServiceUsage;
  keep: number;
  minAgeMs: number;
  now: number;
}): PruneDecision {
  const out: PruneDecision = { prune: [], kept: [] };
  if (input.usage.kind === 'unknown') {
    for (const v of input.versions) {
      out.kept.push({ version: v, reason: `service state unreadable (${input.usage.reason}) — pruning nothing` });
    }
    return out;
  }

  const liveDigests = new Set(input.usage.kind === 'in-use' ? input.usage.digests : []);
  const liveTags = new Set(input.usage.kind === 'in-use' ? input.usage.tags : []);

  // Newest first. An image with no pushed time sorts FIRST, i.e. is treated as the newest thing there
  // is — the safe direction, because the age floor below then protects it too.
  const sorted = [...input.versions].sort((a, b) => (b.createdAtMs ?? Infinity) - (a.createdAtMs ?? Infinity));

  let survivors = 0;
  for (const v of sorted) {
    if (liveDigests.has(v.digest)) {
      out.kept.push({ version: v, reason: 'a live revision runs this digest' });
      survivors++;
      continue;
    }
    const liveTag = v.tags.find((t) => liveTags.has(t));
    if (liveTag) {
      out.kept.push({ version: v, reason: `a live revision runs :${liveTag}` });
      survivors++;
      continue;
    }
    if (survivors < input.keep) {
      out.kept.push({ version: v, reason: `among the newest ${input.keep} (rollback)` });
      survivors++;
      continue;
    }
    // 🔒 An UNDATEABLE image is never deleted. We cannot prove it is old, and the whole design of this
    // file is that we delete only what we can prove is safe to delete.
    if (v.createdAtMs === null) {
      out.kept.push({ version: v, reason: 'the registry did not report when it was pushed' });
      continue;
    }
    if (input.now - v.createdAtMs < input.minAgeMs) {
      out.kept.push({ version: v, reason: `younger than the ${Math.round(input.minAgeMs / 3_600_000)}h floor` });
      continue;
    }
    out.prune.push(v);
  }

  // Oldest first, so a run that hits its per-run bound spends it on the stalest waste.
  out.prune.sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
  return out;
}

/**
 * How much storage a set of images is holding, in MB — and honest when it cannot say.
 *
 * Returns null rather than 0 when NO image reported a size. Zero is a measurement ("these images are
 * empty") and null is the absence of one; printing an invented "0 MB reclaimed" on the admin's own
 * cost report is exactly the kind of number `sandboxCost.ts` refuses to invent. PURE.
 */
export function versionsSizeMb(versions: readonly ImageVersion[]): number | null {
  let total = 0;
  let seen = 0;
  for (const v of versions) {
    if (typeof v.sizeBytes === 'number' && Number.isFinite(v.sizeBytes) && v.sizeBytes >= 0) {
      total += v.sizeBytes;
      seen++;
    }
  }
  if (seen === 0) return null;
  return Math.round((total / (1024 * 1024)) * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE SIBLING. Hunting it is not optional — the fourth absolute rule's step 3 — and it is exactly the
// same root cause one layer down: every publish ALSO uploads a source tarball to the Cloud Build
// staging bucket (`sourceObjectFor` in containerBuild.ts), and nothing has ever deleted one of those
// either. Fixing the images and leaving these would have left the bug class alive in a second place.
//
// 🔑 THE RETENTION RULE IS SIMPLER HERE, AND THE REASON IS WORTH STATING RATHER THAN ASSUMING. A
// source object is read EXACTLY ONCE, by the Cloud Build job it was uploaded for. After that build
// ends it is dead weight — there is no rollback value, so there is no keep-newest-N to balance. The
// age floor IS the whole retention policy: it keeps a recent build's source around long enough to
// answer "why did my publish fail?", and nothing beyond that.
//
// ⚠️ AND A GCS LIFECYCLE RULE *WOULD* BE THE BETTER TOOL HERE — genuinely, unlike for images. There
// is no in-use guard to enforce, so a server-side age rule would do this for free and off our path.
// It is not set from code because it rewrites the configuration of a bucket the admin owns, which is
// their decision and not a side effect of a cleanup job. Until they set one, this does the work.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export const STORAGE_API = 'https://storage.googleapis.com/storage/v1';

/** The prefix `containerBuild.sourceObjectFor` writes under. Nothing else of ours lives here. */
export const SOURCE_PREFIX = 'nbai-source/';

/** One staged source archive. */
export interface SourceObject {
  name: string;
  createdAtMs: number | null;
  sizeBytes: number | null;
}

export function buildListSourceObjectsRequest(
  token: string, bucket: string, pageToken = '', maxResults = 200,
): RegistryRequest {
  const params = new URLSearchParams({
    prefix: SOURCE_PREFIX,
    maxResults: String(Math.max(1, Math.min(1000, maxResults))),
    fields: 'items(name,timeCreated,size),nextPageToken',
  });
  if (pageToken) params.set('pageToken', pageToken);
  return {
    url: `${STORAGE_API}/b/${encodeURIComponent(bucket)}/o?${params.toString()}`,
    method: 'GET',
    headers: registryHeaders(token),
  };
}

export function buildDeleteSourceObjectRequest(token: string, bucket: string, object: string): RegistryRequest {
  return {
    url: `${STORAGE_API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}`,
    method: 'DELETE',
    headers: registryHeaders(token),
  };
}

/** Read a storage listing. PURE. */
export function parseSourceObjectList(raw: unknown): { objects: SourceObject[]; nextPageToken: string } {
  const r = raw && typeof raw === 'object' ? raw as Record<string, any> : null;
  const rows = Array.isArray(r?.items) ? r!.items : [];
  const objects: SourceObject[] = [];
  for (const row of rows) {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    // 🔒 ANYTHING OUTSIDE OUR OWN PREFIX IS IGNORED, even though we asked for the prefix. The bucket
    // is Cloud Build's shared staging bucket and may hold other people's objects; a listing filter is
    // a request, and the thing that decides what we DELETE should not be a parameter we sent.
    if (!name || !name.startsWith(SOURCE_PREFIX)) continue;
    const t = Date.parse(String(row?.timeCreated ?? ''));
    const size = Number(row?.size);
    objects.push({
      name,
      createdAtMs: Number.isFinite(t) ? t : null,
      sizeBytes: Number.isFinite(size) && size >= 0 ? size : null,
    });
  }
  return { objects, nextPageToken: typeof r?.nextPageToken === 'string' ? r.nextPageToken : '' };
}

/** Which staged sources are safe to delete — oldest first. PURE. */
export function decideSourcePrune(input: {
  objects: readonly SourceObject[];
  minAgeMs: number;
  now: number;
}): SourceObject[] {
  const out: SourceObject[] = [];
  for (const o of input.objects) {
    // Undateable ⇒ kept, for the same reason an undateable image is: we cannot prove it is old.
    if (o.createdAtMs === null) continue;
    if (input.now - o.createdAtMs < input.minAgeMs) continue;
    out.push(o);
  }
  return out.sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
}

/** MB held by a set of staged sources, or null when none reported a size. PURE. */
export function sourcesSizeMb(objects: readonly SourceObject[]): number | null {
  let total = 0;
  let seen = 0;
  for (const o of objects) {
    if (typeof o.sizeBytes === 'number' && Number.isFinite(o.sizeBytes) && o.sizeBytes >= 0) { total += o.sizeBytes; seen++; }
  }
  if (seen === 0) return null;
  return Math.round((total / (1024 * 1024)) * 10) / 10;
}
