import { describe, it, expect } from 'vitest';

import {
  BUCKET_ONLY_PREFIX,
  bucketOnlySubdomain,
  isBucketOnlySubdomain,
  bucketOnlyPublishEnabled,
  bucketOnlyPublishedUrl,
  bucketOnlyPublishUsable,
  publishedAppDomain,
} from './bucketOnlyPublish';
// The REAL producer of Firebase channel ids — so the namespace-separation test is a contract test
// against what actually runs, not against a copy of the rule.
import { makeChannelId } from './Deployment';

const envWith = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  PUBLISHED_APPS_BUCKET: 'navbharatai-published-apps',
  PUBLISHED_APP_DOMAIN: 'mitrify.in',
  PUBLISHED_APPS_BUCKET_ONLY: 'on',
  ...over,
} as NodeJS.ProcessEnv);

describe('bucketOnlySubdomain', () => {
  it('is deterministic — a republish keeps the same public URL', () => {
    expect(bucketOnlySubdomain('ws-123')).toBe(bucketOnlySubdomain('ws-123'));
  });

  it('is DNS-safe and well inside the 63-char label limit', () => {
    for (const ws of ['ws-123', 'AGENTV3_weird/id..', '', 'x'.repeat(500)]) {
      const sub = bucketOnlySubdomain(ws);
      expect(sub).toMatch(/^[a-z0-9-]+$/);
      expect(sub.length).toBeLessThanOrEqual(63);
    }
  });

  it('different workspaces get different subdomains', () => {
    expect(bucketOnlySubdomain('ws-a')).not.toBe(bucketOnlySubdomain('ws-b'));
  });

  it('🔒 CANNOT collide with a Firebase-derived subdomain — the namespaces are disjoint by prefix', () => {
    // Every channel id this platform creates starts with `v3-`, and Firebase derives its <sub> from
    // that id. Ours starts with `a-`. A collision is therefore structurally impossible, not just rare.
    for (const ws of ['ws-1', 'agentv3-ryn1xjbfr', 'x']) {
      expect(makeChannelId(ws).startsWith('v3-')).toBe(true);
      expect(bucketOnlySubdomain(ws).startsWith(BUCKET_ONLY_PREFIX)).toBe(true);
      expect(bucketOnlySubdomain(ws).startsWith('v3-')).toBe(false);
      expect(isBucketOnlySubdomain(makeChannelId(ws))).toBe(false);
    }
    // A real Firebase <sub> (channel id truncated + random hash) is never mistaken for ours.
    expect(isBucketOnlySubdomain('v3-agentv3-ryn1xjbfr-c8f1c-ic0rtytl')).toBe(false);
    expect(isBucketOnlySubdomain(bucketOnlySubdomain('ws-1'))).toBe(true);
  });
});

describe('bucketOnlyPublishEnabled — all THREE preconditions are required', () => {
  it('is on only when bucket + branded domain + explicit opt-in are all present', () => {
    expect(bucketOnlyPublishEnabled(envWith())).toBe(true);
  });

  it('is OFF without a bucket (nowhere to put the files)', () => {
    expect(bucketOnlyPublishEnabled(envWith({ PUBLISHED_APPS_BUCKET: '' }))).toBe(false);
  });

  it('🔒 is OFF without a branded domain — skipping the channel would hand the user a dead link', () => {
    // The default published URL is Firebase's own host, which only resolves BECAUSE the channel
    // exists. With no branded domain there is no working URL to return, so the path must not run.
    expect(bucketOnlyPublishEnabled(envWith({ PUBLISHED_APP_DOMAIN: '' }))).toBe(false);
  });

  it('is OFF without the explicit opt-in (default = today’s behaviour, byte-identical)', () => {
    expect(bucketOnlyPublishEnabled(envWith({ PUBLISHED_APPS_BUCKET_ONLY: '' }))).toBe(false);
    expect(bucketOnlyPublishEnabled(envWith({ PUBLISHED_APPS_BUCKET_ONLY: 'off' }))).toBe(false);
    expect(bucketOnlyPublishEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('accepts the opt-in case-insensitively and trimmed, but nothing else', () => {
    expect(bucketOnlyPublishEnabled(envWith({ PUBLISHED_APPS_BUCKET_ONLY: ' ON ' }))).toBe(true);
    expect(bucketOnlyPublishEnabled(envWith({ PUBLISHED_APPS_BUCKET_ONLY: 'yes' }))).toBe(false);
    expect(bucketOnlyPublishEnabled(envWith({ PUBLISHED_APPS_BUCKET_ONLY: 'true' }))).toBe(false);
  });
});

describe('publishedAppDomain + bucketOnlyPublishedUrl', () => {
  it('strips stray dots so a mis-typed domain still builds one clean host', () => {
    expect(publishedAppDomain({ PUBLISHED_APP_DOMAIN: '.mitrify.in.' } as NodeJS.ProcessEnv)).toBe('mitrify.in');
  });

  it('builds https://<sub>.<domain>', () => {
    expect(bucketOnlyPublishedUrl('a-abc', envWith())).toBe('https://a-abc.mitrify.in');
  });

  it('🔒 returns "" (never a URL) when there is no domain or no sub', () => {
    expect(bucketOnlyPublishedUrl('a-abc', envWith({ PUBLISHED_APP_DOMAIN: '' }))).toBe('');
    expect(bucketOnlyPublishedUrl('', envWith())).toBe('');
  });
});

describe('bucketOnlyPublishUsable — every file, or fall back', () => {
  it('accepts only a COMPLETE mirror', () => {
    expect(bucketOnlyPublishUsable({ uploaded: 12, failed: 0 })).toBe(true);
  });

  it('🔒 rejects a partial mirror — a missing chunk is a blank page, and there is no second origin', () => {
    expect(bucketOnlyPublishUsable({ uploaded: 11, failed: 1 })).toBe(false);
    expect(bucketOnlyPublishUsable({ uploaded: 0, failed: 0 })).toBe(false);
    expect(bucketOnlyPublishUsable({ uploaded: 12, failed: 0, error: 'boom' })).toBe(false);
  });
});
