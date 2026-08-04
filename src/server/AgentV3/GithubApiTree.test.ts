import { describe, it, expect } from 'vitest';
import {
  fetchRepoTree, fetchRepoTextFile, summarizeRepoTree, pickSurveyFiles, materializeRepoViaApi, type JsonFetcher,
} from './GithubApiTree';

/** A fake JSON fetch: routes by URL substring to a scripted reply. */
function fakeJson(
  routes: (url: string, headers: Record<string, string>) => { ok?: boolean; status?: number; body?: unknown },
): { fetchImpl: JsonFetcher; calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl: JsonFetcher = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    const r = routes(url, headers);
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body ?? {} };
  };
  return { fetchImpl, calls };
}

const TREE_BODY = {
  truncated: false,
  tree: [
    { path: 'package.json', type: 'blob' },
    { path: 'src', type: 'tree' },
    { path: 'src/App.tsx', type: 'blob' },
    { path: 'src/main.tsx', type: 'blob' },
    { path: 'README.md', type: 'blob' },
  ],
};

describe('fetchRepoTree — instant connect (no clone, no download)', () => {
  it('resolves the default branch then lists every blob path (sorted), with the token header', async () => {
    const { fetchImpl, calls } = fakeJson((url) =>
      url.endsWith('/repos/o/r') ? { body: { default_branch: 'develop' } } : { body: TREE_BODY });
    const res = await fetchRepoTree({ url: 'https://github.com/o/r', token: 'ghs_TOK', fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.defaultBranch).toBe('develop');
    expect(res.paths).toEqual(['package.json', 'README.md', 'src/App.tsx', 'src/main.tsx']); // blobs only, sorted (localeCompare)
    expect(res.truncated).toBe(false);
    // metadata call, then the tree call on the resolved branch
    expect(calls[0].url).toBe('https://api.github.com/repos/o/r');
    expect(calls[1].url).toContain('/git/trees/develop?recursive=1');
    expect(calls[0].headers.Authorization).toBe('Bearer ghs_TOK');
  });

  it('anonymously retries a PUBLIC repo when the authed metadata call 404s', async () => {
    const { fetchImpl, calls } = fakeJson((url, headers) => {
      if (headers.Authorization) return { ok: false, status: 404 };       // authed → hidden
      if (url.endsWith('/repos/o/r')) return { body: { default_branch: 'main' } };
      return { body: TREE_BODY };
    });
    const res = await fetchRepoTree({ url: 'https://github.com/o/r', token: 'ghs_TOK', fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.paths?.length).toBe(4);
    expect(calls.some((c) => !c.headers.Authorization)).toBe(true); // an anonymous attempt happened
  });

  it('classifies a not-found (no anon retry without a token) and never throws on a network error', async () => {
    const nf = await fetchRepoTree({ url: 'https://github.com/o/r', fetchImpl: fakeJson(() => ({ ok: false, status: 404 })).fetchImpl });
    expect(nf).toMatchObject({ ok: false, reason: 'not-found' });

    const net: JsonFetcher = async () => { throw new Error('ECONNRESET'); };
    const res = await fetchRepoTree({ url: 'https://github.com/o/r', fetchImpl: net });
    expect(res).toMatchObject({ ok: false, reason: 'network' });
  });

  it('rejects a non-github URL up front (no call made)', async () => {
    const { fetchImpl, calls } = fakeJson(() => ({}));
    const res = await fetchRepoTree({ url: 'https://gitlab.com/o/r', fetchImpl });
    expect(res).toMatchObject({ ok: false, reason: 'bad-url' });
    expect(calls.length).toBe(0);
  });

  it('reports an empty tree honestly (not a false success)', async () => {
    const { fetchImpl } = fakeJson((url) =>
      url.endsWith('/repos/o/r') ? { body: { default_branch: 'main' } } : { body: { tree: [], truncated: false } });
    const res = await fetchRepoTree({ url: 'https://github.com/o/r', fetchImpl });
    expect(res).toMatchObject({ ok: false, reason: 'empty' });
  });
});

describe('fetchRepoTextFile — read one key file on demand', () => {
  it('base64-decodes the contents API response', async () => {
    const b64 = Buffer.from('{"name":"demo"}').toString('base64');
    const { fetchImpl, calls } = fakeJson(() => ({ body: { encoding: 'base64', content: b64, size: 15 } }));
    const res = await fetchRepoTextFile({ url: 'https://github.com/o/r', path: 'package.json', token: 't', ref: 'main', fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.content).toBe('{"name":"demo"}');
    expect(calls[0].url).toContain('/contents/package.json?ref=main');
  });

  it('refuses an over-cap file and a non-base64 body', async () => {
    const big = await fetchRepoTextFile({ url: 'https://github.com/o/r', path: 'x', fetchImpl: fakeJson(() => ({ body: { encoding: 'base64', content: 'x', size: 10_000_000 } })).fetchImpl });
    expect(big).toMatchObject({ ok: false, reason: 'too-large' });
    const bad = await fetchRepoTextFile({ url: 'https://github.com/o/r', path: 'x', fetchImpl: fakeJson(() => ({ body: { encoding: 'none' } })).fetchImpl });
    expect(bad).toMatchObject({ ok: false, reason: 'empty' });
  });
});

describe('materializeRepoViaApi — full file map via api.github.com ONLY (no codeload, no sandbox)', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  const TREE_WITH_SHAS = {
    truncated: false,
    tree: [
      { path: 'package.json', type: 'blob', sha: 'sha_pkg', size: 40 },
      { path: 'src/App.tsx', type: 'blob', sha: 'sha_app', size: 20 },
      { path: 'node_modules/x/index.js', type: 'blob', sha: 'sha_nm', size: 10 },   // must be skipped
      { path: 'logo.png', type: 'blob', sha: 'sha_png', size: 5 },                  // binary, skipped
      { path: '.env', type: 'blob', sha: 'sha_env', size: 5 },                      // secret, skipped
      { path: 'src', type: 'tree', sha: 'sha_dir' },                                // dir, ignored
    ],
  };
  function repoFetch(): JsonFetcher {
    return async (url) => {
      const body =
        url.endsWith('/repos/o/r') ? { default_branch: 'main' }
        : url.includes('/git/trees/') ? TREE_WITH_SHAS
        : url.includes('/git/blobs/sha_pkg') ? { encoding: 'base64', content: b64('{"name":"demo"}') }
        : url.includes('/git/blobs/sha_app') ? { encoding: 'base64', content: b64('export default 1') }
        : {};
      return { ok: true, status: 200, json: async () => body };
    };
  }

  it('fetches only the KEPT files (skips node_modules / binaries / secrets) — every call on api.github.com', async () => {
    const urls: string[] = [];
    const base = repoFetch();
    const fetchImpl: JsonFetcher = (url, init) => { urls.push(url); return base(url, init); };
    const res = await materializeRepoViaApi({ url: 'https://github.com/o/r', token: 't', fetchImpl });
    expect(res.ok).toBe(true);
    expect(Object.keys(res.files!).sort()).toEqual(['package.json', 'src/App.tsx']);
    expect(res.files!['package.json']).toBe('{"name":"demo"}');
    expect(res.skipped).toBe(3); // node_modules + png + .env
    // EVERY request went to api.github.com — never codeload.github.com (the whole point)
    expect(urls.every((u) => u.startsWith('https://api.github.com/'))).toBe(true);
    expect(urls.some((u) => u.includes('codeload'))).toBe(false);
  });

  it('classifies a not-found and never throws on a network error', async () => {
    const nf = await materializeRepoViaApi({ url: 'https://github.com/o/r', fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
    expect(nf).toMatchObject({ ok: false, reason: 'not-found' });
    const net = await materializeRepoViaApi({ url: 'https://github.com/o/r', fetchImpl: async () => { throw new Error('down'); } });
    expect(net).toMatchObject({ ok: false, reason: 'network' });
  });

  it('rejects a non-github URL up front', async () => {
    const res = await materializeRepoViaApi({ url: 'https://evil.com/o/r', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
    expect(res).toMatchObject({ ok: false, reason: 'bad-url' });
  });
});

describe('summarizeRepoTree + pickSurveyFiles (pure)', () => {
  it('summarizes top-level entries + dominant extensions', () => {
    const s = summarizeRepoTree(['package.json', 'src/App.tsx', 'src/main.tsx', 'server/index.ts', 'README.md']);
    expect(s.fileCount).toBe(5);
    expect(s.topLevel).toContain('src/');
    expect(s.topLevel).toContain('server/');
    expect(s.topLevel).toContain('package.json');
    expect(s.extensions[0]).toEqual({ ext: 'tsx', count: 2 });
  });
  it('picks only survey files that actually exist, bounded', () => {
    const picked = pickSurveyFiles(['package.json', 'README.md', 'src/App.tsx', 'tsconfig.json', 'vite.config.ts'], 3);
    expect(picked).toEqual(['package.json', 'README.md', 'tsconfig.json']); // priority order, capped at 3
    expect(pickSurveyFiles(['src/App.tsx'])).toEqual([]); // none of the key files present
  });
});
