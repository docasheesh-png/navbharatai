import { describe, it, expect, vi } from 'vitest';
import * as crypto from 'crypto';
import { GitHubAppClient, githubConfigFromEnv, repoNameForProject, type GitHubConfig } from './GitHubAppClient';

// A real RSA keypair so the JWT signature can be genuinely verified.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const cfg: GitHubConfig = { appId: '4146547', privateKey, org: 'navbharatai-apps' };

/** Build a fake fetch that routes by `METHOD path` → { status, body }. */
function fakeFetch(routes: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (url: string, init?: { method?: string }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = String(url).replace('https://api.github.com', '');
    const key = `${method} ${path}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected request: ${key}`);
    return { status: route.status, json: async () => route.body } as unknown as Response;
  }) as unknown as typeof fetch;
}

const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const installRoutes = {
  'GET /orgs/navbharatai-apps/installation': { status: 200, body: { id: 42 } },
  'POST /app/installations/42/access_tokens': { status: 201, body: { token: 'ghs_test', expires_at: futureIso } },
};

describe('createAppJwt', () => {
  it('produces a verifiable RS256 JWT issued by the app id', () => {
    const client = new GitHubAppClient(cfg, { now: () => 1_000_000_000_000 });
    const jwt = client.createAppJwt();
    const [h, p, s] = jwt.split('.');
    expect(h && p && s).toBeTruthy();
    // Signature verifies against the public key over header.payload.
    const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload.iss).toBe('4146547');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });
});

describe('getInstallationToken', () => {
  it('exchanges the JWT for an installation token and caches it', async () => {
    const fetchImpl = vi.fn(fakeFetch(installRoutes));
    const client = new GitHubAppClient(cfg, { fetchImpl });
    expect(await client.getInstallationToken()).toBe('ghs_test');
    const callsAfterFirst = fetchImpl.mock.calls.length;
    expect(await client.getInstallationToken()).toBe('ghs_test'); // cached
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst); // no extra network call
  });
});

describe('ensureRepo', () => {
  it('reuses an existing repo (created=false)', async () => {
    const client = new GitHubAppClient(cfg, {
      fetchImpl: fakeFetch({
        ...installRoutes,
        'GET /repos/navbharatai-apps/app-u1-todo': { status: 200, body: { full_name: 'navbharatai-apps/app-u1-todo', clone_url: 'https://github.com/navbharatai-apps/app-u1-todo.git', html_url: 'https://github.com/navbharatai-apps/app-u1-todo', default_branch: 'main' } },
      }),
    });
    const repo = await client.ensureRepo('app-u1-todo');
    expect(repo.created).toBe(false);
    expect(repo.fullName).toBe('navbharatai-apps/app-u1-todo');
    expect(repo.defaultBranch).toBe('main');
  });

  it('creates the repo when it does not exist (created=true)', async () => {
    const client = new GitHubAppClient(cfg, {
      fetchImpl: fakeFetch({
        ...installRoutes,
        'GET /repos/navbharatai-apps/app-u1-new': { status: 404, body: { message: 'Not Found' } },
        'POST /orgs/navbharatai-apps/repos': { status: 201, body: { full_name: 'navbharatai-apps/app-u1-new', clone_url: 'https://github.com/navbharatai-apps/app-u1-new.git', html_url: 'https://github.com/navbharatai-apps/app-u1-new', default_branch: 'main' } },
      }),
    });
    const repo = await client.ensureRepo('app-u1-new');
    expect(repo.created).toBe(true);
    expect(repo.fullName).toBe('navbharatai-apps/app-u1-new');
  });

  it('authedCloneUrl embeds the token', () => {
    const client = new GitHubAppClient(cfg);
    expect(client.authedCloneUrl('app-x', 'ghs_test')).toBe('https://x-access-token:ghs_test@github.com/navbharatai-apps/app-x.git');
  });
});

describe('repoNameForProject + config', () => {
  it('makes a deterministic, GitHub-safe repo name', () => {
    const a = repoNameForProject('User_1', 'My Todo App!');
    expect(a).toBe(repoNameForProject('User_1', 'My Todo App!'));
    expect(a).toMatch(/^app-[a-z0-9_-]+$/);
    expect(a).not.toContain(' ');
    expect(a).not.toContain('!');
  });

  it('githubConfigFromEnv returns null unless all 3 vars are set, and normalises \\n', () => {
    const prev = { id: process.env.GITHUB_APP_ID, key: process.env.GITHUB_APP_PRIVATE_KEY, org: process.env.GITHUB_ORG };
    delete process.env.GITHUB_APP_ID; delete process.env.GITHUB_APP_PRIVATE_KEY; delete process.env.GITHUB_ORG;
    expect(githubConfigFromEnv()).toBeNull();
    process.env.GITHUB_APP_ID = '1'; process.env.GITHUB_APP_PRIVATE_KEY = 'a\\nb'; process.env.GITHUB_ORG = 'o';
    expect(githubConfigFromEnv()).toEqual({ appId: '1', privateKey: 'a\nb', org: 'o' });
    // restore
    if (prev.id === undefined) delete process.env.GITHUB_APP_ID; else process.env.GITHUB_APP_ID = prev.id;
    if (prev.key === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY; else process.env.GITHUB_APP_PRIVATE_KEY = prev.key;
    if (prev.org === undefined) delete process.env.GITHUB_ORG; else process.env.GITHUB_ORG = prev.org;
  });
});
