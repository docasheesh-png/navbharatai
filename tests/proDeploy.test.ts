import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deployCloudflarePages } from '../src/server/pro/ProDeploy';

// ─── Cloudflare Pages — deployCloudflarePages ───────────────────────────────
// All three network calls in deployCloudflarePages use native `fetch`, which
// vi.stubGlobal replaces entirely so no real HTTP goes out.

const ACCOUNT_ID = 'abc123account';
const PROJECT_NAME = 'my-test-app';
const TOKEN = 'cf_token_xyz';
const FILES: Record<string, string> = {
  'index.html': '<h1>Hello</h1>',
  'style.css': 'body { margin: 0; }',
};

const CF_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects`;

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Three-call mock: GET project (found) → skip create → POST deploy. */
function mockExistingProject(deployUrl = `${PROJECT_NAME}.pages.dev`) {
  return vi.fn()
    .mockResolvedValueOnce(jsonResp({ success: true, result: { name: PROJECT_NAME } })) // GET project
    .mockResolvedValueOnce(jsonResp({ success: true, result: { url: deployUrl } }));    // POST deploy
}

/** Three-call mock: GET project (not found) → POST create → POST deploy. */
function mockNewProject(deployUrl = `${PROJECT_NAME}.pages.dev`) {
  return vi.fn()
    .mockResolvedValueOnce(jsonResp({ success: false }, 404))                          // GET project → 404
    .mockResolvedValueOnce(jsonResp({ success: true, result: { name: PROJECT_NAME } })) // POST create
    .mockResolvedValueOnce(jsonResp({ success: true, result: { url: deployUrl } }));   // POST deploy
}

describe('deployCloudflarePages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('skips project creation when the project already exists', async () => {
    const fetchMock = mockExistingProject();
    vi.stubGlobal('fetch', fetchMock);

    const url = await deployCloudflarePages(TOKEN, ACCOUNT_ID, PROJECT_NAME, FILES);
    expect(url).toMatch(/pages\.dev/);
    // Only 2 calls: GET (found, 200) + POST deploy
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('creates the project when it returns 404, then deploys', async () => {
    const fetchMock = mockNewProject();
    vi.stubGlobal('fetch', fetchMock);

    const url = await deployCloudflarePages(TOKEN, ACCOUNT_ID, PROJECT_NAME, FILES);
    expect(url).toMatch(/pages\.dev/);
    // 3 calls: GET (404) + POST create + POST deploy
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const createCall = fetchMock.mock.calls[1];
    expect(createCall[0]).toBe(CF_BASE);
    expect(createCall[1].method).toBe('POST');
  });

  it('sends a FormData body containing a manifest on the deploy call', async () => {
    const fetchMock = mockExistingProject();
    vi.stubGlobal('fetch', fetchMock);

    await deployCloudflarePages(TOKEN, ACCOUNT_ID, PROJECT_NAME, FILES);

    const deployCall = fetchMock.mock.calls[1]; // 2nd call is POST deploy
    const [url, init] = deployCall;
    expect(url).toContain(`${PROJECT_NAME}/deployments`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);

    const form = init.body as FormData;
    expect(form.get('manifest')).toBeInstanceOf(Blob);
  });

  it('returns the URL from result.url in the API response', async () => {
    vi.stubGlobal('fetch', mockExistingProject('deploy-abc.my-test-app.pages.dev'));
    const url = await deployCloudflarePages(TOKEN, ACCOUNT_ID, PROJECT_NAME, FILES);
    expect(url).toBe('https://deploy-abc.my-test-app.pages.dev');
  });

  it('falls back to {projectName}.pages.dev when result.url is absent', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResp({ success: true, result: {} }))          // GET project (found)
      .mockResolvedValueOnce(jsonResp({ success: true, result: {} })),          // POST deploy (no url)
    );

    const url = await deployCloudflarePages(TOKEN, ACCOUNT_ID, PROJECT_NAME, FILES);
    expect(url).toBe(`https://${PROJECT_NAME}.pages.dev`);
  });

  it('throws a descriptive error on HTTP 4xx from deploy endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResp({ success: true }))                       // GET project
      .mockResolvedValueOnce(jsonResp({ error: 'Invalid API token' }, 401)),    // POST deploy → 401
    );

    await expect(
      deployCloudflarePages(TOKEN, ACCOUNT_ID, PROJECT_NAME, FILES),
    ).rejects.toThrow(/401/);
  });

  it('throws when the deploy response has success=false', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResp({ success: true }))                        // GET project
      .mockResolvedValueOnce(jsonResp({ success: false, errors: [{ message: 'quota exceeded' }] })), // deploy
    );

    await expect(
      deployCloudflarePages(TOKEN, ACCOUNT_ID, PROJECT_NAME, FILES),
    ).rejects.toThrow(/failed/i);
  });

  it('sends the Authorization header on all three requests', async () => {
    const fetchMock = mockNewProject();
    vi.stubGlobal('fetch', fetchMock);

    await deployCloudflarePages('my-secret-token', ACCOUNT_ID, PROJECT_NAME, FILES);

    for (const [, init] of fetchMock.mock.calls) {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer my-secret-token');
    }
  });
});
