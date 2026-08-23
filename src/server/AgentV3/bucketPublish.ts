/**
 * PUBLISHED APPS → CLOUD STORAGE. The half of ROADMAP §10.3 that runs on our server.
 *
 * THE PROBLEM THIS EXISTS FOR. Every published app takes one Firebase Hosting *preview channel*, and
 * channels are a finite per-site resource. Whatever the exact cap is (Google does not publish it —
 * see `channelInventory.channelCap`), it is a number, and past it publishing stops for EVERY user at
 * once. An object store has no channel concept and no per-site cap, so moving the serving path there
 * removes the ceiling rather than raising it.
 *
 * WHY THIS IS A MIRROR AND NOT A REPLACEMENT (the load-bearing decision). Firebase stays the source
 * of truth and keeps returning the URL. This writes the SAME files to a bucket alongside it, so:
 *   • a bucket that is missing, misconfigured or failing CANNOT break a publish that already worked;
 *   • the Cloudflare Worker can prefer the bucket and fall back to Firebase, so no existing link
 *     breaks and the switch is reversible by editing the Worker alone;
 *   • apps published before this existed migrate on their next publish, with nothing to run.
 * A cutover that deleted the Firebase path in the same change would have no way back.
 *
 * THE TWO THINGS FIREBASE HOSTING DID FOR FREE, and that an object store does not:
 *   1. CONTENT TYPES. Firebase inferred them. GCS serves whatever was set at upload — miss it and the
 *      browser treats the stylesheet as text and renders an unstyled page. `contentTypeFor` is that.
 *   2. CACHE HEADERS. Set per object at upload here, matching the rules the Worker already documents:
 *      a fingerprinted asset can never mean anything else, so it is immutable for a year; HTML is 60
 *      seconds, so a republish is visible within a minute instead of people seeing yesterday's app.
 * The third — SPA fallback for a deep link — belongs to the Worker, because it is a decision about a
 * request that found nothing, and only the thing serving the request can make it.
 */
import * as admin from 'firebase-admin';

/** Where published apps live inside the bucket. One prefix, so the store stays browsable and prunable. */
export const APP_PREFIX = 'published-apps';

/**
 * Which bucket. Falls back to the buckets the platform already has, so this needs no new
 * infrastructure to start working — and returns '' when there is none, which every caller treats as
 * "not configured" rather than as an error.
 */
export function publishedAppsBucket(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PUBLISHED_APPS_BUCKET || env.NAV_STORE_BUCKET || env.FIREBASE_STORAGE_BUCKET || '').trim();
}

/** Is mirroring switched on? Default ON — it cannot affect a publish, and OFF would mean it never
 *  gets exercised before the day it is needed. `PUBLISHED_APPS_MIRROR=off` is the instant revert. */
export function bucketMirrorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!publishedAppsBucket(env)) return false;
  return String(env.PUBLISHED_APPS_MIRROR ?? '').trim().toLowerCase() !== 'off';
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  wasm: 'application/wasm',
};

/**
 * The content type for a path. Pure.
 *
 * An unknown extension falls back to `application/octet-stream`, which makes the browser DOWNLOAD the
 * file rather than render it wrongly — a visible, diagnosable failure instead of a silently broken
 * page. Guessing `text/html` for anything unrecognised would be the dangerous default.
 */
export function contentTypeFor(path: string): string {
  const clean = String(path || '').split('?')[0].split('#')[0];
  const ext = clean.includes('.') ? clean.slice(clean.lastIndexOf('.') + 1).toLowerCase() : '';
  return TYPES[ext] || 'application/octet-stream';
}

/**
 * Does this filename carry a content hash? Pure.
 *
 * Bundlers emit `index-a1b2c3d4.js` / `main.4f2a9c1b.css`: the name changes whenever the content
 * does, so that URL can NEVER mean anything else and is safe to cache forever. Requiring 8+ hex-ish
 * characters keeps ordinary names like `logo-v2.png` out — caching one of those for a year would
 * strand a user on an old asset with no way to refresh it.
 */
export function isFingerprinted(path: string): boolean {
  const file = String(path || '').split('/').pop() || '';
  return /[.-][0-9a-f]{8,}\.[a-z0-9]+$/i.test(file);
}

/**
 * Cache-Control for one object. Pure. Mirrors the rules the Cloudflare Worker already documents, so
 * the edge and the origin cannot disagree about how long something lives.
 */
export function cacheControlFor(path: string): string {
  const clean = String(path || '').toLowerCase();
  // HTML is the entry point: a republish has to be visible quickly or people keep seeing the old app.
  if (clean.endsWith('.html') || clean.endsWith('.htm')) return 'public, max-age=60';
  if (isFingerprinted(clean)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

/** Full object path for a published file. Pure. Leading slashes are stripped so `/index.html` and
 *  `index.html` can never become two different objects for the same page. */
export function objectPathFor(channelId: string, filePath: string): string {
  const id = String(channelId || '').replace(/^\/+|\/+$/g, '');
  const rel = String(filePath || '').replace(/^\/+/, '');
  return `${APP_PREFIX}/${id}/${rel}`;
}

export interface MirrorResult {
  /** False when no bucket is configured or mirroring is off — NOT a failure, just not enabled. */
  attempted: boolean;
  bucket: string;
  uploaded: number;
  failed: number;
  /** The first real error, for the admin log. Never surfaced to a user. */
  error?: string;
}

const CONCURRENCY = 8;

/**
 * Mirror a published app's files into the bucket.
 *
 * NEVER THROWS. This runs beside a publish that has already succeeded on Firebase; letting it fail
 * the publish would trade a working app for a storage detail the user never asked about.
 */
export async function mirrorPublishToBucket(
  channelId: string,
  files: Map<string, Buffer>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MirrorResult> {
  const bucket = publishedAppsBucket(env);
  if (!bucketMirrorEnabled(env)) return { attempted: false, bucket, uploaded: 0, failed: 0 };
  if (!channelId || !files || files.size === 0) return { attempted: false, bucket, uploaded: 0, failed: 0 };

  const entries = [...files.entries()];
  let uploaded = 0;
  let failed = 0;
  let firstError: string | undefined;

  try {
    const store = admin.storage().bucket(bucket);
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const i = cursor++;
        if (i >= entries.length) return;
        const [path, bytes] = entries[i];
        try {
          await store.file(objectPathFor(channelId, path)).save(bytes, {
            resumable: false,
            contentType: contentTypeFor(path),
            metadata: { cacheControl: cacheControlFor(path) },
          });
          uploaded += 1;
        } catch (err: any) {
          failed += 1;
          if (!firstError) firstError = String(err?.message || err);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  } catch (err: any) {
    // Could not even reach the bucket — the publish itself is unaffected.
    return { attempted: true, bucket, uploaded, failed: entries.length - uploaded, error: String(err?.message || err) };
  }

  return { attempted: true, bucket, uploaded, failed, ...(firstError ? { error: firstError } : {}) };
}

/**
 * Remove a published app's objects. Called when an app is unpublished or taken down, so "remove my
 * app" is genuinely true in both places rather than only in Firebase. Never throws.
 */
export async function removePublishFromBucket(
  channelId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ attempted: boolean; deleted: boolean; error?: string }> {
  const bucket = publishedAppsBucket(env);
  if (!bucket || !channelId) return { attempted: false, deleted: false };
  try {
    await admin.storage().bucket(bucket).deleteFiles({ prefix: `${objectPathFor(channelId, '')}` });
    return { attempted: true, deleted: true };
  } catch (err: any) {
    return { attempted: true, deleted: false, error: String(err?.message || err) };
  }
}
