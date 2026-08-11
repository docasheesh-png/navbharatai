import { describe, it, expect, vi } from 'vitest';
import * as crypto from 'crypto';
import { GitHubAppClient, githubConfigFromEnv, repoNameForProject, readableTimeStamp, readableAppNameForRepo, type GitHubConfig } from './GitHubAppClient';

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

describe('openPullRequest', () => {
  it('opens a PR and returns its number + head sha', async () => {
    const client = new GitHubAppClient(cfg, {
      fetchImpl: fakeFetch({
        ...installRoutes,
        'POST /repos/navbharatai-apps/app-x/pulls': { status: 201, body: { number: 7, html_url: 'https://github.com/navbharatai-apps/app-x/pull/7', head: { sha: 'abc123' } } },
      }),
    });
    const pr = await client.openPullRequest('app-x', 'nbi/build-1', 'main', 'Build', 'body');
    expect(pr.number).toBe(7);
    expect(pr.headSha).toBe('abc123');
  });

  it('reuses an existing open PR when GitHub returns 422', async () => {
    const client = new GitHubAppClient(cfg, {
      fetchImpl: fakeFetch({
        ...installRoutes,
        'POST /repos/navbharatai-apps/app-x/pulls': { status: 422, body: { message: 'A pull request already exists' } },
        'GET /repos/navbharatai-apps/app-x/pulls?head=navbharatai-apps%3Anbi%2Fbuild-1&base=main&state=open': { status: 200, body: [{ number: 9, html_url: 'https://github.com/navbharatai-apps/app-x/pull/9', head: { sha: 'def456' } }] },
      }),
    });
    const pr = await client.openPullRequest('app-x', 'nbi/build-1', 'main', 'Build', 'body');
    expect(pr.number).toBe(9);
  });
});

describe('combinedStatus', () => {
  const base = (statusBody: unknown, checksBody: unknown) => new GitHubAppClient(cfg, {
    fetchImpl: fakeFetch({
      ...installRoutes,
      'GET /repos/navbharatai-apps/app-x/commits/sha1/status': { status: 200, body: statusBody },
      'GET /repos/navbharatai-apps/app-x/commits/sha1/check-runs': { status: 200, body: checksBody },
    }),
  });

  it('returns "none" when the repo has no checks at all', async () => {
    expect(await base({ state: 'pending', total_count: 0 }, { check_runs: [] }).combinedStatus('app-x', 'sha1')).toBe('none');
  });

  it('returns "success" when status is success and all check-runs passed', async () => {
    expect(await base({ state: 'success', total_count: 1 }, { check_runs: [{ status: 'completed', conclusion: 'success' }] }).combinedStatus('app-x', 'sha1')).toBe('success');
  });

  it('returns "failure" when a check-run failed', async () => {
    expect(await base({ state: 'success', total_count: 0 }, { check_runs: [{ status: 'completed', conclusion: 'failure' }] }).combinedStatus('app-x', 'sha1')).toBe('failure');
  });

  it('returns "pending" when a check-run is still running', async () => {
    expect(await base({ state: 'success', total_count: 0 }, { check_runs: [{ status: 'in_progress' }] }).combinedStatus('app-x', 'sha1')).toBe('pending');
  });
});

describe('mergePullRequest', () => {
  it('returns true when GitHub reports merged', async () => {
    const client = new GitHubAppClient(cfg, {
      fetchImpl: fakeFetch({ ...installRoutes, 'PUT /repos/navbharatai-apps/app-x/pulls/7/merge': { status: 200, body: { merged: true } } }),
    });
    expect(await client.mergePullRequest('app-x', 7)).toBe(true);
  });

  it('returns false when the merge is blocked', async () => {
    const client = new GitHubAppClient(cfg, {
      fetchImpl: fakeFetch({ ...installRoutes, 'PUT /repos/navbharatai-apps/app-x/pulls/7/merge': { status: 405, body: { merged: false, message: 'not mergeable' } } }),
    });
    expect(await client.mergePullRequest('app-x', 7)).toBe(false);
  });
});

describe('repoNameForProject + config', () => {
  it('makes a deterministic, GitHub-safe repo name (legacy shape)', () => {
    const a = repoNameForProject('User_1', 'My Todo App!');
    expect(a).toBe(repoNameForProject('User_1', 'My Todo App!'));
    expect(a).toMatch(/^app-[a-z0-9_-]+$/);
    expect(a).not.toContain(' ');
    expect(a).not.toContain('!');
  });

  describe('readable repo name (admin 2026-08-10: single word + date + time, as simple as possible)', () => {
    // 18 Jul 2026, 05:30 UTC == 11:00 IST → stamp `18jul26-1100am`.
    const createdAtMs = Date.UTC(2026, 6, 18, 5, 30, 0);
    it('produces a simple <word>-<ddmonyy>-<hhmm><ampm>-<uniq> in IST (single word, not the phrase)', () => {
      const name = repoNameForProject('uid-9', 'sess-abc', { appName: 'Watch store landing page', createdAtMs });
      expect(name).toMatch(/^watch-18jul26-1100am-[0-9a-f]{4}$/); // ONE word, clear date+time, tiny tail
      expect(name).not.toContain(' ');
    });
    it('keeps only the FIRST word of a multi-word app name', () => {
      const name = repoNameForProject('uid-9', 'sess-abc', { appName: 'Grocery Delivery Pro', createdAtMs });
      expect(name).toMatch(/^grocery-18jul26-1100am-[0-9a-f]{4}$/);
    });
    it('keeps the next token when the first word is too short to mean anything (e-commerce)', () => {
      const name = repoNameForProject('uid-9', 'sess-abc', { appName: 'E-Commerce Store', createdAtMs });
      expect(name).toMatch(/^e-commerce-18jul26-1100am-[0-9a-f]{4}$/);
    });
    it('shows the time to the MINUTE, not just the hour', () => {
      const t = Date.UTC(2026, 6, 18, 8, 17, 0); // 13:47 IST
      const name = repoNameForProject('uid-9', 'sess-abc', { appName: 'Blog', createdAtMs: t });
      expect(name).toMatch(/^blog-18jul26-0147pm-[0-9a-f]{4}$/);
    });
    it('is STABLE across turns — same identity → same name (so ensureRepo never spawns a new repo)', () => {
      const a = repoNameForProject('uid-9', 'sess-abc', { appName: 'Watch store', createdAtMs });
      const b = repoNameForProject('uid-9', 'sess-abc', { appName: 'Watch store', createdAtMs });
      expect(a).toBe(b);
    });
    it('the uniq suffix is keyed on projectId — different projects never collide into one repo', () => {
      const a = repoNameForProject('uid-9', 'sess-A', { appName: 'Watch', createdAtMs });
      const b = repoNameForProject('uid-9', 'sess-B', { appName: 'Watch', createdAtMs });
      expect(a).not.toBe(b); // same word + minute, different project → distinct repos (no data mixing)
    });
    it('falls back to the legacy shape when the app name slugs to empty', () => {
      const name = repoNameForProject('uid-9', 'sess-abc', { appName: '!!!', createdAtMs });
      expect(name).toMatch(/^app-uid-9-sess-abc$/);
    });
    it('bounds the total length to a GitHub-safe 90 chars', () => {
      const name = repoNameForProject('uid-9', 'sess-abc', { appName: 'x'.repeat(200), createdAtMs });
      expect(name.length).toBeLessThanOrEqual(90);
    });
  });

  it('readableTimeStamp formats an epoch as <ddmonyy>-<hhmm><am|pm> in IST', () => {
    expect(readableTimeStamp(Date.UTC(2026, 6, 18, 5, 30, 0))).toBe('18jul26-1100am'); // 11:00 IST
    expect(readableTimeStamp(Date.UTC(2026, 6, 18, 18, 30, 0))).toBe('19jul26-1200am'); // 00:00 IST next day
    expect(readableTimeStamp(Date.UTC(2026, 0, 1, 6, 30, 0))).toBe('01jan26-1200pm'); // 12:00 IST noon
    expect(readableTimeStamp(Date.UTC(2026, 6, 18, 8, 17, 0))).toBe('18jul26-0147pm'); // 13:47 IST (to the minute)
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

// ── readableAppNameForRepo — an imported repo names its own mirror ─────────────────────────────
// ROOT CAUSE (mitrify import autopsy 2026-07-27, buildId 321f4f6c): the readable name came only from
// deriveTitle(prompt). On an IMPORT turn the prompt is an instruction, so the user's real GitHub
// account got a repo literally named `import-this-app-from-my-github-repositor-10pm-270726-609c45`
// for an app called `mitrify` — a permanent, confusing artifact in someone else's account.
describe('readableAppNameForRepo (mitrify autopsy 2026-07-27)', () => {
  const INSTRUCTION_TITLE = 'Import this app from my GitHub repository and give me a short survey';

  it('uses the IMPORTED repo name instead of an instruction-shaped title', () => {
    expect(readableAppNameForRepo({
      importedRepo: { owner: 'aashishcpmt093-ui', repo: 'mitrify' },
      fallbackTitle: INSTRUCTION_TITLE,
    })).toBe('mitrify');
  });

  it('produces a sane mirror repo name end-to-end (the exact bug that shipped)', () => {
    const createdAtMs = Date.UTC(2026, 6, 27, 16, 30); // 10pm IST
    const appName = readableAppNameForRepo({
      importedRepo: { owner: 'aashishcpmt093-ui', repo: 'mitrify' },
      fallbackTitle: INSTRUCTION_TITLE,
    });
    const name = repoNameForProject('uid-9', 'sess-abc', { appName, createdAtMs });
    expect(name).toContain('mitrify');
    expect(name).not.toContain('import-this-app');
  });

  it('falls back to the stored title when this turn imports nothing', () => {
    expect(readableAppNameForRepo({ importedRepo: null, fallbackTitle: 'Watch store landing page' }))
      .toBe('Watch store landing page');
    expect(readableAppNameForRepo({ fallbackTitle: 'Watch store landing page' }))
      .toBe('Watch store landing page');
  });

  it('falls back when the repo name would slug to nothing (never yields an empty name)', () => {
    expect(readableAppNameForRepo({ importedRepo: { owner: 'o', repo: '---' }, fallbackTitle: 'My App' }))
      .toBe('My App');
  });

  it('is STABLE across turns — the same import always yields the same repo name', () => {
    const createdAtMs = Date.UTC(2026, 6, 27, 16, 30);
    const mk = (title: string) => repoNameForProject('uid-9', 'sess-abc', {
      appName: readableAppNameForRepo({ importedRepo: { owner: 'o', repo: 'mitrify' }, fallbackTitle: title }),
      createdAtMs,
    });
    // Turn 1's prompt-derived title and turn 2's differ — the repo name must NOT (else ensureRepo
    // spawns a new repo every turn, the exact sprawl repoNameForProject was built to prevent).
    expect(mk('Import this app and survey it')).toBe(mk('now add a dark mode toggle'));
  });
});
