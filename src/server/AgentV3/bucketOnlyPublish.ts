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
