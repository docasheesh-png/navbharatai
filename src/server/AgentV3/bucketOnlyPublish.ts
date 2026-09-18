/**
 * THE CEILING FIX (ROADMAP §10.3, final step) — publish WITHOUT consuming a Firebase Hosting channel.
 *
 * WHAT THE EARLIER HALVES DID NOT DO. `bucketPublish.ts` mirrors every publish into Cloud Storage and
 * the Cloudflare Worker prefers the bucket — together they made published apps cheaper and faster to
 * serve. What they did NOT do is remove the ceiling, and it is worth being exact about why: the mirror
 * runs AFTER `ensureChannel` + release, so a Firebase channel is still created for every published app,
 * and the channel pool is the thing that runs out. Serving the same channel faster does not un-consume
 * it. The pool is exhausted at roughly the same number of apps either way.
 *
 * SO THE FIX IS TO STOP ASKING FIREBASE FOR A CHANNEL AT ALL. When the bucket and the branded domain
 * are both live, the app is served end-to-end by Cloud Storage behind the Worker, and Firebase has no
 * part in it — no channel, no slot, no cap. An object store has neither a channel concept nor a
 * per-site limit, so the ceiling does not move up: it stops existing.
 *
 * 🔒 THREE PRECONDITIONS, ALL REQUIRED — and the middle one is the subtle one.
 *   1. `PUBLISHED_APPS_BUCKET` — there must be somewhere to put the files.
 *   2. `PUBLISHED_APP_DOMAIN` — there must be a URL that WORKS without Firebase. This is the condition
 *      that is easy to miss and fatal to skip: the default published URL is Firebase's own
 *      `<site>--<sub>.web.app`, which only resolves BECAUSE the channel exists. Skip the channel with
 *      no branded domain configured and the user is handed a link to a host that was never created.
 *      There is no honest fallback URL here, so the absence of the domain must disable the whole path.
 *   3. `PUBLISHED_APPS_BUCKET_ONLY=on` — an explicit opt-in, because this changes where every newly
 *      published app lives. Unset ⇒ byte-identical to today.
 *
 * 🔒 THE SUBDOMAIN IS OURS, AND IT CANNOT COLLIDE WITH FIREBASE'S. Firebase names a channel host
 * `<site>--<sub>.web.app` where `<sub>` is the channel id truncated with a random hash appended — and
 * every channel id this platform creates starts with `v3-` (see `makeChannelId`). A bucket-only app has
 * no channel to ask, so it needs a name we generate. Using the `a-` prefix makes a collision with a
 * Firebase-derived `<sub>` STRUCTURALLY impossible rather than merely unlikely: the two namespaces
 * cannot overlap, so one app can never be served the other's files.
 *
 * The name is a pure function of the workspace id, so a republish lands on the SAME URL — the permanent
 * public link is the whole promise of publishing, and a name that moved would break every share.
 */
import * as crypto from 'crypto';

import { publishedAppsBucket } from './bucketPublish';

/**
 * The prefix that marks a subdomain as ours rather than Firebase's. Must never be `v3-`, which is what
 * `makeChannelId` produces and therefore what every Firebase-derived `<sub>` begins with.
 */
export const BUCKET_ONLY_PREFIX = 'a-';

/** Hex characters of the workspace-id digest kept. 24 hex = 96 bits — collision is not a real risk. */
const HASH_LEN = 24;

/**
 * The public subdomain for a bucket-only published app. Deterministic (a republish keeps the URL),
 * DNS-safe (`[a-z0-9-]`, 26 chars — far inside the 63-char label limit), and in a namespace Firebase
 * cannot produce. Pure.
 */
export function bucketOnlySubdomain(workspaceId: string): string {
  const digest = crypto.createHash('sha256').update(String(workspaceId ?? '')).digest('hex').slice(0, HASH_LEN);
  return `${BUCKET_ONLY_PREFIX}${digest}`;
}

/** Whether a subdomain belongs to the bucket-only namespace (i.e. there is no Firebase channel for it). */
export function isBucketOnlySubdomain(sub: string): boolean {
  return new RegExp(`^${BUCKET_ONLY_PREFIX}[0-9a-f]{${HASH_LEN}}$`).test(String(sub ?? ''));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 🔴 THE CEILING WAS NEVER THE PUBLISHES (admin Monitor capture, 2026-09-18).
//
// Bucket-only publishing had been live and verified for a day, and the channel count still climbed:
// 43 → 46 with the flag on. Every id in the admin's "wasted channels" list began `sn-`, which is
// `snapshotChannelId`, not `makeChannelId`. **Preview SNAPSHOTS were eating the pool.**
//
// A snapshot is the saved `dist/` of a green build, kept so a finished app survives its sandbox
// pausing. It is created on every green build, it is pure static files, and NOTHING in the entire
// server ever deletes one — `snapshotChannelId` appears at exactly two places: the line that builds
// the id and the line that deploys to it. So the pool grew by one channel per workspace that ever
// built successfully, for ever, and no amount of bucket-only publishing could touch it: the bucket
// branch in `deployStatic` was gated on the channel being the PUBLISH channel, and a snapshot passes
// its own id by design.
//
// A snapshot is static files served over a URL. That is precisely what the bucket already does for
// publishes, and the Cloudflare Worker resolves ANY `<sub>.<domain>` against `apps/<sub>/`, so this
// needs no edge change. Its own prefix keeps the three namespaces disjoint by construction:
//   `v3-…`  Firebase publish channel     `a-…`  bucket-only PUBLISH     `s-…`  bucket SNAPSHOT
// A snapshot must never be able to overwrite what somebody deliberately published — the same rule
// that gave it a separate Firebase channel in the first place, carried into the bucket.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The prefix marking a bucket object set as a build SNAPSHOT. Never `a-` (publish) or `v3-`. */
export const SNAPSHOT_BUCKET_PREFIX = 's-';

/**
 * The public subdomain a workspace's build snapshot is served from. Same hash discipline as
 * `bucketOnlySubdomain`, different namespace, so a snapshot can never collide with a published app.
 * Deterministic, so a rebuild overwrites the same objects instead of accumulating new ones. Pure.
 */
export function snapshotSubdomain(workspaceId: string): string {
  const digest = crypto.createHash('sha256').update(String(workspaceId ?? '')).digest('hex').slice(0, HASH_LEN);
  return `${SNAPSHOT_BUCKET_PREFIX}${digest}`;
}

/** Whether a subdomain is a build snapshot's. */
export function isSnapshotSubdomain(sub: string): boolean {
  return new RegExp(`^${SNAPSHOT_BUCKET_PREFIX}[0-9a-f]{${HASH_LEN}}$`).test(String(sub ?? ''));
}

/**
 * May a build snapshot be served from the bucket instead of a Firebase channel?
 *
 * Requires everything bucket-only publishing requires (the bucket, the branded domain, the master
 * switch), because it is the same infrastructure and a half-configured one hands out dead links.
 * `AGENTV3_SNAPSHOT_BUCKET=off` reverts snapshots alone to Firebase channels without touching
 * publishing — two behaviours that ride one switch is how a revert becomes a bigger decision than it
 * should be.
 */
export function snapshotBucketEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.AGENTV3_SNAPSHOT_BUCKET ?? '').trim().toLowerCase() === 'off') return false;
  return bucketOnlyPublishEnabled(env);
}

/** The branded domain published apps are served on, '' when unset. */
export function publishedAppDomain(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.PUBLISHED_APP_DOMAIN || '').trim().replace(/^\.+|\.+$/g, '');
}

/**
 * Is bucket-only publishing switched on AND actually usable? All three preconditions, or false.
 *
 * Deliberately ANDed rather than warned about: a half-configured bucket-only mode hands the user a
 * dead link, and there is no way to notice that from the server — the publish reports success either
 * way. Refusing the path is the only outcome that cannot mislead.
 */
export function bucketOnlyPublishEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!publishedAppsBucket(env)) return false;
  if (!publishedAppDomain(env)) return false;
  return String(env.PUBLISHED_APPS_BUCKET_ONLY ?? '').trim().toLowerCase() === 'on';
}

/**
 * The public URL of a bucket-only published app. Returns '' when no branded domain is configured,
 * which the caller must treat as "this path is not available" — never as a URL.
 */
export function bucketOnlyPublishedUrl(sub: string, env: NodeJS.ProcessEnv = process.env): string {
  const domain = publishedAppDomain(env);
  if (!domain || !sub) return '';
  return `https://${sub}.${domain}`;
}

/** What the mirror must achieve before a bucket-only publish may be reported as live. */
export interface MirrorOutcome {
  uploaded: number;
  failed: number;
  error?: string;
}

/**
 * May a bucket-only publish be reported as LIVE?
 *
 * The bar is EVERY file uploaded, not most of them. A partially-mirrored app is a broken app — a
 * missing stylesheet or chunk is a blank page — and there is no second origin to cover for it, because
 * skipping the channel is the entire point. Anything short of complete falls back to Firebase, which
 * still works and still costs a slot: the ceiling matters, and a broken app for the user matters more.
 */
export function bucketOnlyPublishUsable(mirror: MirrorOutcome): boolean {
  return mirror.uploaded > 0 && mirror.failed === 0 && !mirror.error;
}
