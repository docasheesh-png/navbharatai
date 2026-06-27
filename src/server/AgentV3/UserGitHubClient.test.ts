import { describe, it, expect, vi } from 'vitest';
import { UserGitHubClient } from './UserGitHubClient';

/** Build a fake fetch that routes by `METHOD path` → { status, body }. */
function fakeFetch(routes: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = String(url).replace('https://api.github.com', '');
    const key = `${method} ${path}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected request: ${key}`);
    return { status: route.status, json: async () => route.body } as unknown as Response;
  }) as unknown as typeof fetch;
}

const userRoute = { 'GET /user': { status: 200, body: { login: 'alice' } } };

describe('UserGitHubClient.getLogin', () => {
  it('reads and caches the authenticated user login', async () => {
    const fetchImpl = vi.fn(fakeFetch(userRoute));
    const client = new UserGitHubClient('ghu_tok', { fetchImpl });
    expect(await client.getLogin()).toBe('alice');
    const after = fetchImpl.mock.calls.length;
    expect(await client.getLogin()).toBe('alice'); // cached
    expect(fetchImpl.mock.calls.length).toBe(after);
  });

  it('sends the user token as a Bearer credential', async () => {
    const fetchImpl = vi.fn(fakeFetch(userRoute));
    await new UserGitHubClient('ghu_secret', { fetchImpl }).getLogin();
    const init = fetchImpl.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe('Bearer ghu_secret');
  });
});

describe('UserGitHubClient.ensureRepo', () => {
  it('reuses an existing repo in the user account (created=false)', async () => {
    const client = new UserGitHubClient('t', {
      fetchImpl: fakeFetch({
        ...userRoute,
        'GET /repos/alice/app-1-todo': { status: 200, body: { full_name: 'alice/app-1-todo', clone_url: 'https://github.com/alice/app-1-todo.git', html_url: 'https://github.com/alice/app-1-todo', default_branch: 'main' } },
      }),
    });
    const repo = await client.ensureRepo('app-1-todo');
    expect(repo.created).toBe(false);
    expect(repo.fullName).toBe('alice/app-1-todo');
  });

  it('creates the repo under /user/repos when missing (created=true)', async () => {
    const client = new UserGitHubClient('t', {
      fetchImpl: fakeFetch({
        ...userRoute,
        'GET /repos/alice/app-1-new': { status: 404, body: { message: 'Not Found' } },
        'POST /user/repos': { status: 201, body: { full_name: 'alice/app-1-new', clone_url: 'https://github.com/alice/app-1-new.git', html_url: 'https://github.com/alice/app-1-new', default_branch: 'main' } },
      }),
    });
    const repo = await client.ensureRepo('app-1-new');
    expect(repo.created).toBe(true);
    expect(repo.fullName).toBe('alice/app-1-new');
  });

  it('authedCloneUrl embeds the user token + login', () => {
    const client = new UserGitHubClient('ghu_x');
    expect(client.authedCloneUrl('app-y', 'alice')).toBe('https://x-access-token:ghu_x@github.com/alice/app-y.git');
  });
});

describe('UserGitHubClient PR flow (PrCapableClient)', () => {
  const base = (extra: Record<string, { status: number; body: unknown }>) => new UserGitHubClient('t', { fetchImpl: fakeFetch({ ...userRoute, ...extra }) });

  it('opens a PR in the user repo', async () => {
    const client = base({ 'POST /repos/alice/app/pulls': { status: 201, body: { number: 3, html_url: 'https://github.com/alice/app/pull/3', head: { sha: 'sha3' } } } });
    const pr = await client.openPullRequest('app', 'nbi/build-1', 'main', 'Build', 'b');
    expect(pr.number).toBe(3);
    expect(pr.headSha).toBe('sha3');
  });

  it('reuses an existing open PR on 422', async () => {
    const client = base({
      'POST /repos/alice/app/pulls': { status: 422, body: { message: 'exists' } },
      'GET /repos/alice/app/pulls?head=alice%3Anbi%2Fbuild-1&base=main&state=open': { status: 200, body: [{ number: 8, html_url: 'u', head: { sha: 's' } }] },
    });
    const pr = await client.openPullRequest('app', 'nbi/build-1', 'main', 'Build', 'b');
    expect(pr.number).toBe(8);
  });

  it('returns "none" when the repo has no checks, "failure" on a failed run', async () => {
    const none = base({
      'GET /repos/alice/app/commits/s1/status': { status: 200, body: { state: 'pending', total_count: 0 } },
      'GET /repos/alice/app/commits/s1/check-runs': { status: 200, body: { check_runs: [] } },
    });
    expect(await none.combinedStatus('app', 's1')).toBe('none');

    const fail = base({
      'GET /repos/alice/app/commits/s2/status': { status: 200, body: { state: 'success', total_count: 0 } },
      'GET /repos/alice/app/commits/s2/check-runs': { status: 200, body: { check_runs: [{ status: 'completed', conclusion: 'failure' }] } },
    });
    expect(await fail.combinedStatus('app', 's2')).toBe('failure');
  });

  it('merges a PR in the user repo', async () => {
    const client = base({ 'PUT /repos/alice/app/pulls/3/merge': { status: 200, body: { merged: true } } });
    expect(await client.mergePullRequest('app', 3)).toBe(true);
  });
});
