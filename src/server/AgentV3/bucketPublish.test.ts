import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  contentTypeFor, cacheControlFor, isFingerprinted, objectPathFor,
  publishedAppsBucket, bucketMirrorEnabled, mirrorPublishToBucket, removePublishFromBucket,
  APP_PREFIX,
} from './bucketPublish';

describe('contentTypeFor — the thing Firebase Hosting did for free', () => {
  it('names the types a built app is actually made of', () => {
    expect(contentTypeFor('index.html')).toContain('text/html');
    expect(contentTypeFor('assets/main.css')).toContain('text/css');
    expect(contentTypeFor('assets/index-a1b2c3d4.js')).toContain('text/javascript');
    expect(contentTypeFor('logo.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('font.woff2')).toBe('font/woff2');
    expect(contentTypeFor('manifest.webmanifest')).toBe('application/manifest+json');
  });

  it('is case-insensitive and ignores a query string', () => {
    expect(contentTypeFor('IMAGE.PNG')).toBe('image/png');
    expect(contentTypeFor('style.css?v=2')).toContain('text/css');
  });

  it('falls back to octet-stream for the unknown — a visible failure, not a wrong render', () => {
    // Guessing text/html here would make the browser try to RENDER an unknown file. A download is an
    // honest, diagnosable failure instead.
    expect(contentTypeFor('weird.qqq')).toBe('application/octet-stream');
    expect(contentTypeFor('noextension')).toBe('application/octet-stream');
    expect(contentTypeFor('')).toBe('application/octet-stream');
  });
});

describe('isFingerprinted / cacheControlFor', () => {
  it('recognises bundler hashes', () => {
    expect(isFingerprinted('assets/index-a1b2c3d4.js')).toBe(true);
    expect(isFingerprinted('main.4f2a9c1b.css')).toBe(true);
  });

  it('does NOT treat an ordinary versioned name as a content hash', () => {
    // Caching logo-v2.png for a year would strand every visitor on it with no way to refresh.
    expect(isFingerprinted('logo-v2.png')).toBe(false);
    expect(isFingerprinted('index.html')).toBe(false);
    expect(isFingerprinted('assets/style.css')).toBe(false);
  });

  it('holds fingerprinted assets for a year and HTML for a minute', () => {
    expect(cacheControlFor('assets/index-a1b2c3d4.js')).toContain('immutable');
    expect(cacheControlFor('assets/index-a1b2c3d4.js')).toContain('31536000');
    // HTML is the entry point: a republish has to become visible quickly.
    expect(cacheControlFor('index.html')).toBe('public, max-age=60');
    expect(cacheControlFor('about/index.HTML')).toBe('public, max-age=60');
  });

  it('gives everything else a modest life rather than forever', () => {
    expect(cacheControlFor('logo.png')).toBe('public, max-age=3600');
  });
});

describe('objectPathFor', () => {
  it('namespaces every app under one prefix', () => {
    expect(objectPathFor('v3-abc', 'index.html')).toBe(`${APP_PREFIX}/v3-abc/index.html`);
    expect(objectPathFor('v3-abc', 'assets/app.js')).toBe(`${APP_PREFIX}/v3-abc/assets/app.js`);
  });

  it('normalises a leading slash, so one page can never become two objects', () => {
    expect(objectPathFor('v3-abc', '/index.html')).toBe(objectPathFor('v3-abc', 'index.html'));
  });
});

describe('configuration — off is a real state, not a failure', () => {
  it('reads the bucket from the platform buckets it already has', () => {
    expect(publishedAppsBucket({ PUBLISHED_APPS_BUCKET: 'mine' } as any)).toBe('mine');
    expect(publishedAppsBucket({ NAV_STORE_BUCKET: 'store' } as any)).toBe('store');
    expect(publishedAppsBucket({} as any)).toBe('');
  });

  it('is off with no bucket, on by default with one, and off on the kill switch', () => {
    expect(bucketMirrorEnabled({} as any)).toBe(false);
    expect(bucketMirrorEnabled({ NAV_STORE_BUCKET: 'b' } as any)).toBe(true);
    expect(bucketMirrorEnabled({ NAV_STORE_BUCKET: 'b', PUBLISHED_APPS_MIRROR: 'off' } as any)).toBe(false);
  });
});

describe('mirrorPublishToBucket — can never break a publish', () => {
  const files = new Map([['index.html', Buffer.from('<html></html>')]]);

  it('does nothing, honestly, when no bucket is configured', async () => {
    const r = await mirrorPublishToBucket('v3-abc', files, {} as any);
    expect(r.attempted).toBe(false);
    expect(r.uploaded).toBe(0);
    expect(r.failed).toBe(0);
  });

  it('does nothing for an empty file set or a missing channel', async () => {
    expect((await mirrorPublishToBucket('v3-abc', new Map(), { NAV_STORE_BUCKET: 'b' } as any)).attempted).toBe(false);
    expect((await mirrorPublishToBucket('', files, { NAV_STORE_BUCKET: 'b' } as any)).attempted).toBe(false);
  });

  it('reports failure instead of throwing when the bucket is unreachable', async () => {
    // Under vitest there is no initialised Firebase app, so this exercises the real failure path:
    // the publish that already succeeded must not be undone by it.
    const r = await mirrorPublishToBucket('v3-abc', files, { NAV_STORE_BUCKET: 'nope' } as any);
    expect(r.attempted).toBe(true);
    expect(r.uploaded).toBe(0);
    expect(r.error).toBeTruthy();
  });

  it('removal never throws either', async () => {
    await expect(removePublishFromBucket('v3-abc', { NAV_STORE_BUCKET: 'nope' } as any)).resolves.toBeTruthy();
    expect((await removePublishFromBucket('v3-abc', {} as any)).attempted).toBe(false);
  });
});

describe('the publish path stays safe (locked)', () => {
  const deployment = readFileSync(resolve(__dirname, 'Deployment.ts'), 'utf8');

  it('mirrors AFTER the Firebase release, never before', () => {
    const release = deployment.indexOf('/releases?versionName=');
    const mirror = deployment.indexOf('mirrorPublishToBucket(');
    expect(release).toBeGreaterThan(-1);
    expect(mirror).toBeGreaterThan(release);
  });

  it('mirrors ONLY the workspace publish channel, never a preview snapshot', () => {
    // A snapshot passes its own channelId; mirroring those would double storage for versions nobody
    // browses to. The check is on the id, so a future caller cannot forget a parameter.
    expect(deployment).toContain('if (channelId === makeChannelId(workspaceId))');
  });

  it('removes the bucket copy on takedown, so "remove my app" is true in both places', () => {
    expect(deployment).toContain('removePublishFromBucket(channelId)');
  });
});

describe('the Cloudflare Worker (locked)', () => {
  const worker = readFileSync(resolve(__dirname, '../../../infra/cloudflare/mitrify-apps-worker.js'), 'utf8');

  it('ships with the bucket origin EMPTY, so behaviour is unchanged until it is set', () => {
    // The revert is one empty string. Shipping it pre-filled would switch the origin the moment the
    // Worker is redeployed, before the bucket exists.
    expect(worker).toMatch(/const APPS_BUCKET = '';/);
  });

  it('falls back to Firebase, so apps published before the mirror keep working', () => {
    expect(worker).toContain('fall through to Firebase');
  });

  it('has the SPA fallback Firebase gave us for free', () => {
    // Without it, every deep link on every published app 404s the day the origin switches.
    expect(worker).toContain('serveFromBucket');
    expect(worker).toContain('index.html');
  });

  it('does NOT serve index.html in place of a missing asset', () => {
    // Returning HTML with a 200 where a script was expected produces a confusing parse error rather
    // than an honest 404.
    expect(worker).toMatch(/if \(\/\\\.\[a-z0-9\]\{1,8\}\$\/i\.test\(key\)\) return null;/);
  });

  it('uses the bucket only for GET/HEAD — an object store cannot answer a form POST', () => {
    expect(worker).toContain('if (APPS_BUCKET && cacheable)');
  });

  it('agrees with the server about where objects live', () => {
    expect(worker).toContain("const APP_PREFIX = 'published-apps'");
    expect(APP_PREFIX).toBe('published-apps');
  });
});
