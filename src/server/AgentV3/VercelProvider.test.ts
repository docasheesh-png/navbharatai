import { describe, it, expect, afterEach } from 'vitest';
import { vercelProjectName, buildVercelManifest, vercelProvider } from './VercelProvider';
import { getDeployProvider, deployProviderStatus } from './DeployProviders';

describe('VercelProvider (R5 §5.1 — token-gated, no lock-in)', () => {
  const prev = process.env.VERCEL_TOKEN;
  afterEach(() => {
    if (prev === undefined) delete process.env.VERCEL_TOKEN;
    else process.env.VERCEL_TOKEN = prev;
  });

  it('self-registers into the deploy registry as a static provider', () => {
    expect(getDeployProvider('vercel')).toBeTruthy();
    expect(vercelProvider.kind).toBe('static');
  });

  it('is configured only when VERCEL_TOKEN is set (honest, never fake)', () => {
    delete process.env.VERCEL_TOKEN;
    expect(vercelProvider.isConfigured({})).toBe(false);
    const offStatus = deployProviderStatus({}).find((p) => p.id === 'vercel');
    expect(offStatus?.configured).toBe(false);
    expect(offStatus?.requirement).toContain('VERCEL_TOKEN');

    process.env.VERCEL_TOKEN = 'tok_123';
    expect(vercelProvider.isConfigured({})).toBe(true);
    expect(deployProviderStatus({}).find((p) => p.id === 'vercel')?.configured).toBe(true);
  });

  it('treats a blank/whitespace token as not configured', () => {
    process.env.VERCEL_TOKEN = '   ';
    expect(vercelProvider.isConfigured({})).toBe(false);
  });

  it('deploy rejects honestly when no token is set', async () => {
    delete process.env.VERCEL_TOKEN;
    await expect(vercelProvider.deploy('agentv3-u1-s1', new Map([['index.html', Buffer.from('x')]]), {}))
      .rejects.toThrow(/VERCEL_TOKEN/);
  });

  it('deploy rejects honestly when there are no built files', async () => {
    process.env.VERCEL_TOKEN = 'tok_123';
    await expect(vercelProvider.deploy('agentv3-u1-s1', new Map(), {}))
      .rejects.toThrow(/No built files/);
  });
});

describe('vercelProjectName', () => {
  it('produces a valid lowercase, hyphenated project name', () => {
    expect(vercelProjectName('agentv3-User_42-SESS')).toBe('nbai-v3-agentv3-user-42-sess');
  });
  it('handles empty/garbage ids without producing an invalid name', () => {
    expect(vercelProjectName('!!!')).toBe('nbai-v3-app');
  });
  it('is deterministic (idempotent project per workspace)', () => {
    expect(vercelProjectName('ws-abc')).toBe(vercelProjectName('ws-abc'));
  });
});

describe('buildVercelManifest', () => {
  it('computes sha1 per file, normalizes paths, and maps sha→buffer', () => {
    const files = new Map<string, Buffer>([
      ['index.html', Buffer.from('<h1>hi</h1>')],
      ['/assets\\app.js', Buffer.from('console.log(1)')],
    ]);
    const { manifest, bySha } = buildVercelManifest(files);
    expect(manifest).toHaveLength(2);
    // leading slash stripped + backslashes → forward slashes
    expect(manifest.some((m) => m.file === 'assets/app.js')).toBe(true);
    expect(manifest.some((m) => m.file === 'index.html')).toBe(true);
    for (const m of manifest) {
      expect(m.sha).toMatch(/^[a-f0-9]{40}$/);
      expect(m.size).toBeGreaterThan(0);
      expect(bySha.get(m.sha)).toBeInstanceOf(Buffer);
    }
  });
});
