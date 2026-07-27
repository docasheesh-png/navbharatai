import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

// This route creates a repository on someone's real GitHub account and pushes their app into it, so
// the guards below are about not doing that to the wrong account, and about telling the truth when
// GitHub refuses. The failure cases each need a DIFFERENT fix from the user, which is why they are
// reported separately instead of as one "something went wrong".

const state = {
  uid: null as string | null,
  files: {} as Record<string, string>,
  /** Simulated GitHub. `calls` records what we actually sent. */
  login: 'ravi' as string | null,
  repoExists: false,
  calls: [] as Array<{ method: string; url: string; body?: unknown }>,
  failStatusOn: null as { url: RegExp; status: number } | null,
};

function ghError(status: number) {
  return Object.assign(new Error(`GitHub ${status}`), { response: { status } });
}

vi.mock('axios', () => {
  const check = (url: string) => {
    if (state.failStatusOn && state.failStatusOn.url.test(url)) throw ghError(state.failStatusOn.status);
  };
  return {
    default: {
      get: async (url: string) => {
        state.calls.push({ method: 'GET', url });
        check(url);
        if (url.endsWith('/user')) {
          if (!state.login) throw ghError(401);
          return { data: { login: state.login } };
        }
        if (/\/git\/ref\/heads\//.test(url)) return { data: { object: { sha: 'parent-sha' } } };
        if (/\/repos\/[^/]+\/[^/]+$/.test(url)) {
          if (!state.repoExists) throw ghError(404);
          return { data: { default_branch: 'main' } };
        }
        throw ghError(404);
      },
      post: async (url: string, body: unknown) => {
        state.calls.push({ method: 'POST', url, body });
        check(url);
        if (url.endsWith('/user/repos')) return { data: { default_branch: 'main' } };
        if (/\/git\/blobs$/.test(url)) return { data: { sha: 'blob-sha' } };
        if (/\/git\/trees$/.test(url)) return { data: { sha: 'tree-sha' } };
        if (/\/git\/commits$/.test(url)) return { data: { sha: 'commit-sha' } };
        throw ghError(404);
      },
      patch: async (url: string, body: unknown) => {
        state.calls.push({ method: 'PATCH', url, body });
        check(url);
        return { data: {} };
      },
    },
  };
});

vi.mock('../src/server/lib/authMiddleware', () => ({
  verifyFirebaseToken: async () => state.uid,
}));

vi.mock('../src/server/AgentV3/WorkspaceFileStore', () => ({
  loadWorkspaceFiles: async () => ({ ...state.files }),
}));

const { registerMobileSetupRoutes, repoNameFor, isValidRepoName } =
  await import('../src/server/routes/mobileSetup');

const routes = captureRoutes(registerMobileSetupRoutes);
const setup = routes.get('POST /api/mobile-ship/setup')!;

const UID = 'user123';
const SID = 'sess456';

function call(body: Record<string, unknown>, headers: Record<string, string> = { 'x-github-token': 'gh_tok' }) {
  const res = mockRes();
  return setup(mockReq({ body, headers }), res).then(() => res);
}

beforeEach(() => {
  state.uid = UID;
  state.files = { 'index.html': '<html><body>Hi</body></html>', 'style.css': 'body{}' };
  state.login = 'ravi';
  state.repoExists = false;
  state.calls = [];
  state.failStatusOn = null;
});

describe('repoNameFor / isValidRepoName', () => {
  it('turns an app name into something GitHub accepts', () => {
    expect(repoNameFor('Chai Point ☕')).toBe('chai-point');
    expect(repoNameFor('')).toBe('my-app');
    expect(repoNameFor('!!!')).toBe('my-app');
  });

  it('rejects names GitHub would refuse', () => {
    for (const bad of ['', '.', '..', 'a/b', 'a b', 'x'.repeat(101)]) {
      expect(isValidRepoName(bad), bad).toBe(false);
    }
    expect(isValidRepoName('my-app_2.0')).toBe(true);
  });
});

describe('the guards before anything is created on GitHub', () => {
  it('a signed-out user cannot create a repository', async () => {
    state.uid = null;
    const res = await call({ sessionId: SID, appName: 'X' });
    expect(res.statusCode).toBe(401);
    expect(state.calls).toHaveLength(0);
  });

  it('says GitHub must be connected, and explains why the key stays with the user', async () => {
    const res = await call({ sessionId: SID, appName: 'X' }, {});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/GitHub/i);
    expect(state.calls).toHaveLength(0);
  });

  it('refuses when no app is named', async () => {
    const res = await call({ appName: 'X' });
    expect(res.statusCode).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it('refuses an empty app instead of pushing an empty repository', async () => {
    state.files = {};
    const res = await call({ sessionId: SID, appName: 'X' });
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toMatch(/no files/i);
    expect(state.calls).toHaveLength(0);
  });

  it('refuses a repository name GitHub would not accept', async () => {
    const res = await call({ sessionId: SID, appName: 'X', repo: 'bad name/slash' });
    expect(res.statusCode).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
});

describe('the happy path', () => {
  it('creates the repository, pushes the project, and reports where it went', async () => {
    const res = await call({ sessionId: SID, appName: 'Chai Point', appId: 'com.chai.point' });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.owner).toBe('ravi');
    expect(res.body.repo).toBe('chai-point');
    expect(res.body.repoUrl).toBe('https://github.com/ravi/chai-point');
    expect(res.body.createdRepo).toBe(true);
    expect(res.body.commitSha).toBe('commit-sha');
    expect(res.body.kind).toBe('static');
    expect(res.body.webDir).toBe('www');
  });

  it('takes the account from the TOKEN, never from the request body', async () => {
    // Otherwise a caller could aim someone else's token at a repo name of their choosing.
    const res = await call({ sessionId: SID, appName: 'X', owner: 'somebody-else' });
    expect(res.body.owner).toBe('ravi');
    expect(state.calls.some((c) => c.url.includes('somebody-else'))).toBe(false);
  });

  it('pushes the app files, the workflow and a runnable package.json together', async () => {
    await call({ sessionId: SID, appName: 'X' });
    const tree = state.calls.find((c) => /\/git\/trees$/.test(c.url))?.body as { tree: Array<{ path: string }> };
    const paths = tree.tree.map((t) => t.path);
    expect(paths).toContain('www/index.html');
    expect(paths).toContain('package.json');
    expect(paths).toContain('capacitor.config.ts');
    expect(paths).toContain('.github/workflows/android-aab.yml');
  });

  it('reuses an existing repository instead of failing', async () => {
    state.repoExists = true;
    const res = await call({ sessionId: SID, appName: 'X' });
    expect(res.statusCode).toBe(200);
    expect(res.body.createdRepo).toBe(false);
    expect(state.calls.some((c) => c.url.endsWith('/user/repos'))).toBe(false);
  });

  it('sends the icon as a real blob, because a PNG in a tree’s text field arrives corrupted', async () => {
    await call({ sessionId: SID, appName: 'X', iconDataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
    const blob = state.calls.find((c) => /\/git\/blobs$/.test(c.url));
    expect(blob).toBeTruthy();
    expect((blob!.body as { encoding: string }).encoding).toBe('base64');
    const tree = state.calls.find((c) => /\/git\/trees$/.test(c.url))?.body as { tree: Array<{ path: string; sha?: string }> };
    const icon = tree.tree.find((t) => t.path.startsWith('resources/icon'));
    expect(icon?.sha).toBe('blob-sha');
  });

  it('does not force-push over whatever is already on the branch', async () => {
    await call({ sessionId: SID, appName: 'X' });
    const patch = state.calls.find((c) => c.method === 'PATCH');
    expect((patch!.body as { force: boolean }).force).toBe(false);
  });
});

describe('GitHub refusals are reported so the user knows what to fix', () => {
  it('a missing permission asks for the right one, rather than "try again"', async () => {
    state.failStatusOn = { url: /\/user\/repos$/, status: 403 };
    const res = await call({ sessionId: SID, appName: 'X' });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/permission|workflow/i);
  });

  it('a name already taken says so by name', async () => {
    state.failStatusOn = { url: /\/user\/repos$/, status: 422 };
    const res = await call({ sessionId: SID, appName: 'Chai Point' });
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toContain('chai-point');
  });

  it('an expired GitHub connection asks the user to reconnect', async () => {
    state.login = null;
    const res = await call({ sessionId: SID, appName: 'X' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/reconnect/i);
  });

  it('a branch that moved under us is a conflict, not a silent overwrite', async () => {
    state.failStatusOn = { url: /\/git\/refs\/heads\//, status: 409 };
    const res = await call({ sessionId: SID, appName: 'X' });
    expect(res.statusCode).toBe(409);
  });
});
