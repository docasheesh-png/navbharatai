import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_PREFIX } from '../src/server/AgentV3/bucketPublish';

/**
 * THE CEILING FIX WAS BUILT, MERGED, TESTED — AND SWITCHED OFF BY ONE EMPTY STRING (2026-09-15).
 *
 * `bucketPublish.ts` mirrored every publish into Cloud Storage. `bucketOnlyPublish.ts` could skip
 * Firebase entirely. The Cloudflare Worker could serve from the bucket. Every piece shipped green.
 * And `const APPS_BUCKET = ''` in the Worker meant the whole bucket origin below it was unreachable
 * code, so publishes kept taking a Firebase preview channel until the admin's Publish Capacity card
 * read "36 of about 50 in use" — the exact failure the feature existed to prevent.
 *
 * Nothing failed while that was true, which is why it went unnoticed for three weeks and why it
 * needs a test rather than a comment: the Worker silently falls back to Firebase for an app it
 * cannot find in the bucket, and an empty bucket name is indistinguishable from "not mirrored yet".
 *
 * ⚠️ These assertions read the DEPLOYED FILE, not a copy of its values. The Worker is deployed by
 * pasting this file into the Cloudflare dashboard, so the file in the repo is the only record of
 * what is running — if the two drift, this is the file a later session will trust.
 */
const worker = readFileSync(join(__dirname, '..', 'infra/cloudflare/mitrify-apps-worker.js'), 'utf8');

/** Pull a top-level `const NAME = '…'` out of the Worker source. */
const constant = (name: string): string => {
  const m = worker.match(new RegExp(`^const ${name} = '([^']*)'`, 'm'));
  expect(m, `${name} is not declared as a single-quoted top-level const in the Worker`).toBeTruthy();
  return m![1];
};

describe('the Worker is actually pointed at the published-apps bucket', () => {
  it('🔒 APPS_BUCKET is set — an empty string silently disables the whole ceiling fix', () => {
    const bucket = constant('APPS_BUCKET');
    expect(bucket, 'APPS_BUCKET is empty: every publish will keep consuming a Firebase channel').not.toBe('');
    // Cloud Storage bucket naming, so a placeholder or a pasted URL cannot pass as a name.
    expect(bucket).toMatch(/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/);
  });

  it('🔒 the Worker READS from the same prefix the server WRITES to', () => {
    // Two files, two languages, no import between them. A prefix changed on one side alone would
    // 404 every app at the edge and fall through to Firebase — i.e. it would look like the bucket
    // path "just not working" rather than a mismatch.
    expect(constant('APP_PREFIX')).toBe(APP_PREFIX);
  });

  it('the Firebase fallback survives — every app published before the bucket must keep working', () => {
    // The bucket origin is a PREFERENCE, never a replacement. Removing this fallback because "apps
    // live in the bucket now" would break every link published before the mirror existed.
    expect(worker).toContain('fall through to Firebase');
    expect(worker).toContain('const originHost = `${FIREBASE_PROJECT}--${sub}.web.app`;');
  });

  it('a deep link into a single-page app is still rewritten to index.html', () => {
    // Firebase Hosting did this for free; an object store returns 404. Without it, moving to the
    // bucket turns every refresh on /dashboard into a blank page.
    expect(worker).toContain('const spa = await fetch(`${base}/index.html`);');
  });
});

/**
 * 🔴 THE SECOND INCIDENT, AND THE ONE THIS SECTION EXISTS FOR (2026-09-17).
 *
 * `APPS_BUCKET` was fixed in the repo on 2026-09-15 and the test above has passed ever since — and
 * the Worker running at the edge was still the old one, because this file is deployed by PASTING it
 * into the Cloudflare dashboard and nothing links the two. When the server switched to bucket-only
 * publishing, every published app died with Firebase's "Site Not Found". The code was right in the
 * repo, right in the dashboard editor, and old at the edge.
 *
 * What made it expensive was not the mistake; it was that the mistake was UNOBSERVABLE. Five
 * different explanations fitted the same symptom and none could be ruled out from outside, because
 * the Worker had no way to say what it was. `GET /__nbai` is that way.
 *
 * ⚠️ These assertions do NOT prove what is deployed — nothing in CI can. They prove the endpoint
 * exists and that its version string still describes this file, which is what makes a one-second
 * check at the edge meaningful instead of a number nobody trusts.
 */
describe('the Worker can say which copy of itself is running', () => {
  it('exposes GET /__nbai and reports the bucket it is actually reading from', () => {
    expect(worker).toContain("if (url.pathname === '/__nbai')");
    expect(worker).toContain('version: WORKER_VERSION');
    // The bucket is the ONE field the whole diagnostic is for — reporting a version without it
    // would tell you the code is new and still not tell you whether it can find an app.
    expect(worker).toContain('appsBucket: APPS_BUCKET || null');
  });

  it('answers BEFORE the cache and is never stored — a stale diagnostic is worse than none', () => {
    const diagnostic = worker.indexOf("url.pathname === '/__nbai'");
    const cacheLookup = worker.indexOf('await cache.match(cacheKey)');
    expect(diagnostic).toBeGreaterThan(-1);
    expect(cacheLookup).toBeGreaterThan(-1);
    expect(diagnostic).toBeLessThan(cacheLookup);
    expect(worker).toContain("'cache-control': 'no-store'");
  });

  it('🔒 WORKER_VERSION still matches this file — a version string that lies is worse than none', () => {
    // The contract is simply "bump it when you change the file". Encoded as a hash of everything
    // EXCEPT the version line itself (which necessarily changes when it is bumped), pinned here.
    // A failure means one of two things and the message says which:
    //   • you changed the Worker → bump WORKER_VERSION, then paste the printed hash in below;
    //   • you bumped it without changing anything else → paste the printed hash in below.
    const version = constant('WORKER_VERSION');
    expect(version, 'WORKER_VERSION must be a non-empty string').toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$/);

    const body = worker.replace(/^const WORKER_VERSION = '[^']*';$/m, '');
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
    const PINNED = 'ce798a2c2b0658ad';
    expect(
      hash,
      `The Worker changed but WORKER_VERSION/the pin did not.\n` +
      `  1. Bump WORKER_VERSION in infra/cloudflare/mitrify-apps-worker.js (it is ${version} today).\n` +
      `  2. Set PINNED in this test to: ${hash}\n` +
      `  3. PASTE the file into the Cloudflare dashboard and press Deploy — CI cannot do this, and\n` +
      `     skipping it is exactly the drift this test was written after.`,
    ).toBe(PINNED);
  });
});
