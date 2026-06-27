import { describe, it, expect, afterEach } from 'vitest';
import { netlifySiteName, buildNetlifyDigest, netlifyProvider } from './NetlifyProvider';
import { getDeployProvider, deployProviderStatus } from './DeployProviders';

describe('NetlifyProvider (R5 §5.1 — token-gated, no lock-in)', () => {
  const prev = process.env.NETLIFY_AUTH_TOKEN;
  afterEach(() => {
    if (prev === undefined) delete process.env.NETLIFY_AUTH_TOKEN;
    else process.env.NETLIFY_AUTH_TOKEN = prev;
  });

  it('self-registers as a static provider', () => {
    expect(getDeployProvider('netlify')).toBeTruthy();
    expect(netlifyProvider.kind).toBe('static');
  });

  it('is configured only when NETLIFY_AUTH_TOKEN is set', () => {
    delete process.env.NETLIFY_AUTH_TOKEN;
    expect(netlifyProvider.isConfigured({})).toBe(false);
    const off = deployProviderStatus({}).find((p) => p.id === 'netlify');
    expect(off?.configured).toBe(false);
    expect(off?.requirement).toContain('NETLIFY_AUTH_TOKEN');

    process.env.NETLIFY_AUTH_TOKEN = 'tok';
    expect(netlifyProvider.isConfigured({})).toBe(true);
  });

  it('treats a blank token as not configured', () => {
    process.env.NETLIFY_AUTH_TOKEN = '  ';
    expect(netlifyProvider.isConfigured({})).toBe(false);
  });

  it('deploy rejects honestly with no token / no files', async () => {
    delete process.env.NETLIFY_AUTH_TOKEN;
    await expect(netlifyProvider.deploy('agentv3-u1-s1', new Map([['index.html', Buffer.from('x')]]), {}))
      .rejects.toThrow(/NETLIFY_AUTH_TOKEN/);
    process.env.NETLIFY_AUTH_TOKEN = 'tok';
    await expect(netlifyProvider.deploy('agentv3-u1-s1', new Map(), {})).rejects.toThrow(/No built files/);
  });
});

describe('netlifySiteName', () => {
  it('is deterministic and DNS-safe', () => {
    expect(netlifySiteName('agentv3-User_42')).toBe('nbai-v3-agentv3-user-42');
    expect(netlifySiteName('ws-abc')).toBe(netlifySiteName('ws-abc'));
    expect(netlifySiteName('!!!')).toBe('nbai-v3-app');
  });
});

describe('buildNetlifyDigest', () => {
  it('builds a {/path: sha1} map with leading slashes and a sha→buffer map', () => {
    const { digest, bySha, byPath } = buildNetlifyDigest(new Map([
      ['index.html', Buffer.from('<h1>hi</h1>')],
      ['assets\\app.js', Buffer.from('1')],
    ]));
    expect(Object.keys(digest)).toContain('/index.html');
    expect(Object.keys(digest)).toContain('/assets/app.js');
    for (const [path, sha] of Object.entries(digest)) {
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(bySha.get(sha)).toBeInstanceOf(Buffer);
      expect(byPath.get(path)).toBeInstanceOf(Buffer);
    }
  });
});
