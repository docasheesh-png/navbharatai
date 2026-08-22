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

describe('UserGitHubClient.getRepoAccess (own-repo write-access gate)', () => {
  it('reports push access + default branch for a repo the user can write', async () => {
    const client = new UserGitHubClient('t', {
      fetchImpl: fakeFetch({
        ...userRoute,
        'GET /repos/alice/mitrify': { status: 200, body: { full_name: 'alice/mitrify', default_branch: 'develop', permissions: { push: true, admin: true, pull: true } } },
      }),
    });
    expect(await client.getRepoAccess('mitrify')).toEqual({ exists: true, canPush: true, defaultBranch: 'develop' });
  });

  it('reports canPush:false for a repo the user can only read (never write to it)', async () => {
    const client = new UserGitHubClient('t', {
      fetchImpl: fakeFetch({
        ...userRoute,
        'GET /repos/alice/readonly': { status: 200, body: { default_branch: 'main', permissions: { push: false, pull: true } } },
      }),
    });
    expect(await client.getRepoAccess('readonly')).toEqual({ exists: true, canPush: false, defaultBranch: 'main' });
  });

  it('reports exists:false + canPush:false when the repo 404s or the API errors (safe fallback)', async () => {
    const client = new UserGitHubClient('t', {
      fetchImpl: fakeFetch({ ...userRoute, 'GET /repos/alice/missing': { status: 404, body: { message: 'Not Found' } } }),
    });
    expect(await client.getRepoAccess('missing')).toEqual({ exists: false, canPush: false, defaultBranch: 'main' });
  });
});

describe('UserGitHubClient git-data (Revert last merge)', () => {
  it('reads a branch head commit: sha, message, tree, parents', async () => {
    const client = new UserGitHubClient('t', {
      fetchImpl: fakeFetch({
        ...userRoute,
        'GET /repos/alice/app/git/ref/heads/main': { status: 200, body: { object: { sha: 'm1' } } },
        'GET /repos/alice/app/git/commits/m1': { status: 200, body: { sha: 'm1', message: 'Ship (#4)', tree: { sha: 't1' }, parents: [{ sha: 'p0' }] } },
      }),
    });
    expect(await client.getBranchHeadCommit('app', 'main')).toEqual({ sha: 'm1', message: 'Ship (#4)', treeSha: 't1', parents: [{ sha: 'p0' }] });
  });

  it('returns null when the ref or commit is unreadable', async () => {
    const client = new UserGitHubClient('t', {
      fetchImpl: fakeFetch({ ...userRoute, 'GET /repos/alice/app/git/ref/heads/main': { status: 404, body: {} } }),
    });
    expect(await client.getBranchHeadCommit('app', 'main')).toBeNull();
  });

  it('creates a commit and fast-forwards the branch ref (force:false)', async () => {
    const fetchImpl = vi.fn(fakeFetch({
      ...userRoute,
      'GET /repos/alice/app/git/commits/p0': { status: 200, body: { tree: { sha: 'pt0' } } },
      'POST /repos/alice/app/git/commits': { status: 201, body: { sha: 'rev1' } },
      'PATCH /repos/alice/app/git/refs/heads/main': { status: 200, body: { object: { sha: 'rev1' } } },
    }));
    const client = new UserGitHubClient('t', { fetchImpl });
    expect(await client.getCommitTreeSha('app', 'p0')).toBe('pt0');
    expect(await client.createCommit('app', 'Revert "Ship"', 'pt0', ['m1'])).toBe('rev1');
    expect(await client.updateBranchRef('app', 'main', 'rev1')).toBe(true);
    // The ref update must never force-rewrite history.
    const patchCall = fetchImpl.mock.calls.find((c) => (c[1] as { method?: string })?.method === 'PATCH');
    expect(JSON.parse((patchCall![1] as { body: string }).body)).toMatchObject({ sha: 'rev1', force: false });
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

/**
 * REVIEW ROUND ON THE USER'S OWN REPO (ROADMAP D3, the half that was missing).
 *
 * The triage, the prompt and the reply wording all existed and were tested — against a FAKE client.
 * Nothing could actually reach a user's pull request, because UserGitHubClient (the only client
 * authorized against the user's own repo) did not implement the review port at all. These tests pin
 * the real implementation, especially the two ways it is allowed to say "I don't know".
 */
describe('UserGitHubClient — review comments', () => {
  const review = (extra: Record<string, { status: number; body: unknown }>) =>
    new UserGitHubClient('t', { fetchImpl: fakeFetch({ ...userRoute, ...extra }) });

  const inlinePath = 'GET /repos/alice/app/pulls/3/comments?per_page=100';
  const generalPath = 'GET /repos/alice/app/issues/3/comments?per_page=100';

  it('reads BOTH the inline comments and the conversation, under the user login', async () => {
    const client = review({
      [inlinePath]: { status: 200, body: [{ id: 1, body: 'rename this', path: 'src/App.tsx', line: 4, position: 2, user: { login: 'bob' } }] },
      [generalPath]: { status: 200, body: [{ id: 2, body: 'the login page is broken', user: { login: 'bob' } }] },
    });
    const rows = await client.listReviewComments('app', 3);
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
    expect(rows[0].path).toBe('src/App.tsx');
    expect(rows[1].path).toBeUndefined(); // a conversation comment has no anchor, and none is invented
  });

  it('🔒 one failed half yields NOTHING — a half-read review must never look like a whole one', async () => {
    const client = review({
      [inlinePath]: { status: 200, body: [{ id: 1, body: 'please fix this' }] },
      [generalPath]: { status: 500, body: { message: 'server error' } },
    });
    expect(await client.listReviewComments('app', 3)).toEqual([]);
  });

  it('never throws — a network failure is an empty round, not a crashed build', async () => {
    const client = new UserGitHubClient('t', {
      fetchImpl: (async () => { throw new Error('network down'); }) as unknown as typeof fetch,
    });
    expect(await client.listReviewComments('app', 3)).toEqual([]);
  });

  it('refuses a missing repo or PR number without calling GitHub at all', async () => {
    const fetchImpl = vi.fn(fakeFetch(userRoute));
    const client = new UserGitHubClient('t', { fetchImpl });
    expect(await client.listReviewComments('', 3)).toEqual([]);
    expect(await client.listReviewComments('app', 0)).toEqual([]);
    expect(fetchImpl.mock.calls.length).toBe(0);
  });
});

describe('UserGitHubClient — replying to a review comment', () => {
  const review = (extra: Record<string, { status: number; body: unknown }>) =>
    new UserGitHubClient('t', { fetchImpl: fakeFetch({ ...userRoute, ...extra }) });

  it('replies IN THE THREAD when the comment has one', async () => {
    const client = review({ 'POST /repos/alice/app/pulls/3/comments/11/replies': { status: 201, body: { id: 99 } } });
    expect(await client.replyToReviewComment('app', 3, 11, 'done')).toBe(true);
  });

  it('falls back to the conversation when the thread refuses — a silent non-answer reads as ignoring them', async () => {
    const client = review({
      'POST /repos/alice/app/pulls/3/comments/11/replies': { status: 404, body: { message: 'Not Found' } },
      'POST /repos/alice/app/issues/3/comments': { status: 201, body: { id: 100 } },
    });
    expect(await client.replyToReviewComment('app', 3, 11, 'done')).toBe(true);
  });

  it('a conversation comment (no thread id) goes straight to the conversation', async () => {
    const client = review({ 'POST /repos/alice/app/issues/3/comments': { status: 201, body: { id: 100 } } });
    expect(await client.replyToReviewComment('app', 3, 0, 'done')).toBe(true);
  });

  it('reports FALSE when the reply genuinely did not land', async () => {
    const client = review({
      'POST /repos/alice/app/pulls/3/comments/11/replies': { status: 404, body: {} },
      'POST /repos/alice/app/issues/3/comments': { status: 403, body: {} },
    });
    expect(await client.replyToReviewComment('app', 3, 11, 'done')).toBe(false);
  });

  it('never posts an empty body, and never throws', async () => {
    const fetchImpl = vi.fn(fakeFetch(userRoute));
    const client = new UserGitHubClient('t', { fetchImpl });
    expect(await client.replyToReviewComment('app', 3, 11, '')).toBe(false);
    expect(fetchImpl.mock.calls.length).toBe(0);
    const boom = new UserGitHubClient('t', { fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch });
    expect(await boom.replyToReviewComment('app', 3, 11, 'done')).toBe(false);
  });
});
