import { describe, it, expect, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { cloudflareProjectName, buildCloudflareManifest, cloudflareProvider } from './CloudflareProvider';
import { getDeployProvider, deployProviderStatus } from './DeployProviders';

describe('CloudflareProvider (R5 §5.1 — token-gated, no lock-in)', () => {
  const prevTok = process.env.CLOUDFLARE_API_TOKEN;
  const prevAcc = process.env.CLOUDFLARE_ACCOUNT_ID;
  afterEach(() => {
    if (prevTok === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = prevTok;
    if (prevAcc === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = prevAcc;
  });

  it('self-registers as a static provider', () => {
    expect(getDeployProvider('cloudflare')).toBeTruthy();
    expect(cloudflareProvider.kind).toBe('static');
  });

  it('is configured ONLY when BOTH token and account id are set', () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    expect(cloudflareProvider.isConfigured({})).toBe(false);
    const off = deployProviderStatus({}).find((p) => p.id === 'cloudflare');
    expect(off?.configured).toBe(false);
    expect(off?.requirement).toContain('CLOUDFLARE_API_TOKEN');

    process.env.CLOUDFLARE_API_TOKEN = 'tok';           // only one → still not configured
    expect(cloudflareProvider.isConfigured({})).toBe(false);
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc';           // both → configured
    expect(cloudflareProvider.isConfigured({})).toBe(true);
  });

  it('treats a blank token/account as not configured', () => {
    process.env.CLOUDFLARE_API_TOKEN = '  ';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc';
    expect(cloudflareProvider.isConfigured({})).toBe(false);
  });

  it('deploy rejects honestly (no fake URL) when unconfigured, and NEVER leaks the token in the error', async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    await expect(cloudflareProvider.deploy('agentv3-u1-s1', new Map([['index.html', Buffer.from('x')]]), {}))
      .rejects.toThrow(/CLOUDFLARE_API_TOKEN/);
    // configured but empty build → honest "no files", not a fake success
    process.env.CLOUDFLARE_API_TOKEN = 'super-secret-token-value';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc123';
    await expect(cloudflareProvider.deploy('agentv3-u1-s1', new Map(), {})).rejects.toThrow(/No built files/);
    // the secret token must never appear in a thrown message
    try {
      await cloudflareProvider.deploy('agentv3-u1-s1', new Map(), {});
    } catch (e) {
      expect((e as Error).message).not.toContain('super-secret-token-value');
    }
  });
});

describe('cloudflareProjectName', () => {
  it('is deterministic, DNS-safe, and within Cloudflare\'s 58-char project-name limit', () => {
    expect(cloudflareProjectName('agentv3-User_42')).toBe('nbai-v3-agentv3-user-42');
    expect(cloudflareProjectName('ws-abc')).toBe(cloudflareProjectName('ws-abc'));
    expect(cloudflareProjectName('!!!')).toBe('nbai-v3-app');
    const long = cloudflareProjectName('agentv3-' + 'x'.repeat(200));
    expect(long.length).toBeLessThanOrEqual(58);
    expect(long).not.toMatch(/-$/); // no trailing hyphen
  });
});

describe('buildCloudflareManifest — BINARY-SAFE (the corruption bug the review caught)', () => {
  it('hashes the RAW bytes so a non-UTF8 binary asset survives byte-for-byte', () => {
    // Bytes that are INVALID utf8 — a utf8 round-trip (the rejected approach) would corrupt these.
    const png = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x89, 0x50, 0x4e, 0x47]);
    const { manifest, bySha } = buildCloudflareManifest(new Map([['assets/logo.png', png]]));
    const sha = manifest['/assets/logo.png'];
    // hash must equal sha256 of the RAW buffer (NOT of buf.toString('utf8'))
    expect(sha).toBe(crypto.createHash('sha256').update(png).digest('hex'));
    expect(sha).not.toBe(crypto.createHash('sha256').update(png.toString('utf8')).digest('hex'));
    // the stored buffer is the exact original bytes
    expect(Buffer.compare(bySha.get(sha)!, png)).toBe(0);
  });

  it('normalizes paths (leading slash, backslashes) and maps sha→buffer', () => {
    const { manifest, bySha } = buildCloudflareManifest(new Map([
      ['index.html', Buffer.from('<h1>hi</h1>')],
      ['assets\\app.js', Buffer.from('1')],
    ]));
    expect(Object.keys(manifest)).toContain('/index.html');
    expect(Object.keys(manifest)).toContain('/assets/app.js');
    for (const [, sha] of Object.entries(manifest)) {
      expect(sha).toMatch(/^[a-f0-9]{64}$/); // sha256
      expect(bySha.get(sha)).toBeInstanceOf(Buffer);
    }
  });
});
