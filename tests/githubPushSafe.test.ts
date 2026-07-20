import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

// Mock axios so we can drive the GitHub API responses without a network call and assert exactly
// how the branch ref is updated (the force-push data-loss guard).
vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() },
}));
import axios from 'axios';

async function getRoutes() {
  const { registerGithubRoutes } = await import('../src/server/routes/github');
  return captureRoutes(registerGithubRoutes);
}

const ax = axios as unknown as { get: any; post: any; put: any; patch: any };
const files = { 'README.md': '# hi' };
const req = (body: any) => mockReq({ body, headers: { authorization: 'Bearer tok' } });

function wireHappyGetPost() {
  ax.get.mockImplementation((url: string) => {
    if (url.includes('/git/ref/heads/')) return Promise.resolve({ data: { object: { sha: 'base1' } } });
    return Promise.resolve({ data: {} }); // repo-exists check, user profile, etc.
  });
  ax.post.mockImplementation((url: string) => {
    if (url.includes('/git/trees')) return Promise.resolve({ data: { sha: 'tree1' } });
    if (url.includes('/git/commits')) return Promise.resolve({ data: { sha: 'commit1' } });
    return Promise.resolve({ data: {} });
  });
}

describe('github push — safe (non-force) branch ref update', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('push-enhanced: happy path updates the ref WITHOUT force and returns 200', async () => {
    wireHappyGetPost();
    ax.patch.mockResolvedValue({ data: {} });

    const routes = await getRoutes();
    const res = mockRes();
    await routes.get('POST /api/github/push-enhanced')!(req({ owner: 'acme', repo: 'app', files, branch: 'main' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // The critical guarantee: the ref PATCH must carry force:false, never force:true.
    expect(ax.patch).toHaveBeenCalledTimes(1);
    expect(ax.patch.mock.calls[0][1]).toMatchObject({ sha: 'commit1', force: false });
    expect(ax.patch.mock.calls.every((c: any[]) => c[1].force !== true)).toBe(true);
  });

  it('push-enhanced: a non-fast-forward (GitHub 422) → honest 409, never overwrites', async () => {
    wireHappyGetPost();
    ax.patch.mockRejectedValue({ response: { status: 422, data: { message: 'Update is not a fast forward' } } });

    const routes = await getRoutes();
    const res = mockRes();
    await routes.get('POST /api/github/push-enhanced')!(req({ owner: 'acme', repo: 'app', files, branch: 'main' }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.nonFastForward).toBe(true);
    expect(res.body.error).toMatch(/newer commits/i);
  });

  it('legacy /api/github/push also updates the ref without force', async () => {
    ax.get.mockResolvedValue({ data: { object: { sha: 'base1' } } });
    ax.post.mockImplementation((url: string) => {
      if (url.includes('/git/trees')) return Promise.resolve({ data: { sha: 'tree1' } });
      if (url.includes('/git/commits')) return Promise.resolve({ data: { sha: 'commit1' } });
      return Promise.resolve({ data: {} });
    });
    ax.patch.mockResolvedValue({ data: {} });

    const routes = await getRoutes();
    const res = mockRes();
    await routes.get('POST /api/github/push')!(req({ owner: 'acme', repo: 'app', files, branch: 'main' }), res);

    expect(res.statusCode).toBe(200);
    expect(ax.patch.mock.calls[0][1].force).toBe(false);
  });

  it('legacy /api/github/push: non-fast-forward → 409', async () => {
    ax.get.mockResolvedValue({ data: { object: { sha: 'base1' } } });
    ax.post.mockImplementation((url: string) => {
      if (url.includes('/git/trees')) return Promise.resolve({ data: { sha: 'tree1' } });
      if (url.includes('/git/commits')) return Promise.resolve({ data: { sha: 'commit1' } });
      return Promise.resolve({ data: {} });
    });
    ax.patch.mockRejectedValue({ response: { status: 422, data: { message: 'not a fast forward' } } });

    const routes = await getRoutes();
    const res = mockRes();
    await routes.get('POST /api/github/push')!(req({ owner: 'acme', repo: 'app', files, branch: 'main' }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.nonFastForward).toBe(true);
  });

  it('push-enhanced error path does NOT leak the raw GitHub response body', async () => {
    ax.get.mockImplementation((url: string) => {
      if (url.includes('/git/ref/heads/')) return Promise.resolve({ data: { object: { sha: 'base1' } } });
      return Promise.resolve({ data: {} });
    });
    // A tree/commit failure carrying a token-bearing URL in the raw body must never reach the client.
    ax.post.mockRejectedValue({ response: { status: 500, data: { message: 'boom', leak: 'https://x-access-token:abc123@github.com/o/r' } } });

    const routes = await getRoutes();
    const res = mockRes();
    await routes.get('POST /api/github/push-enhanced')!(req({ owner: 'acme', repo: 'app', files, branch: 'main' }), res);

    expect(res.body.details).toBeUndefined();              // raw body field removed
    expect(JSON.stringify(res.body)).not.toContain('x-access-token');
    expect(JSON.stringify(res.body)).not.toContain('abc123');
  });
});
