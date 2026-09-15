import { describe, it, expect } from 'vitest';
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
