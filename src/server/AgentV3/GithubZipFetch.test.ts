import { describe, it, expect } from 'vitest';
import {
  parseOwnerRepo, zipballUrl, classifyZipStatus, fetchGithubRepoZip, type ZipFetcher,
} from './GithubZipFetch';

/** A fake fetch that records the URLs + headers it saw and replies from a scripted matcher. */
function fakeFetch(
  reply: (url: string, headers: Record<string, string>) => { ok?: boolean; status?: number; contentLength?: string; body?: Uint8Array },
): { fetchImpl: ZipFetcher; calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl: ZipFetcher = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    const r = reply(url, headers);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-length' ? (r.contentLength ?? null) : null) },
      arrayBuffer: async () => (r.body ?? new Uint8Array([1, 2, 3])).buffer,
    };
  };
  return { fetchImpl, calls };
}

describe('parseOwnerRepo', () => {
  it('parses plain, .git, trailing-slash, and query/hash forms', () => {
    expect(parseOwnerRepo('https://github.com/aashishcpmt093-ui/mitrify')).toEqual({ owner: 'aashishcpmt093-ui', repo: 'mitrify' });
    expect(parseOwnerRepo('https://github.com/o/r.git')).toEqual({ owner: 'o', repo: 'r' });
    expect(parseOwnerRepo('https://github.com/o/r/')).toEqual({ owner: 'o', repo: 'r' });
    expect(parseOwnerRepo('https://github.com/o/r?tab=readme#x')).toEqual({ owner: 'o', repo: 'r' });
  });
  it('rejects non-github / non-two-segment URLs', () => {
    expect(parseOwnerRepo('https://gitlab.com/o/r')).toBeNull();
    expect(parseOwnerRepo('https://github.com/o')).toBeNull();
    expect(parseOwnerRepo('https://github.com/o/r/extra')).toBeNull();
    expect(parseOwnerRepo('not a url')).toBeNull();
  });
});

describe('zipballUrl + classifyZipStatus', () => {
  it('builds the API zipball endpoint (default branch, or a ref)', () => {
    expect(zipballUrl('o', 'r')).toBe('https://api.github.com/repos/o/r/zipball');
    expect(zipballUrl('o', 'r', 'main')).toBe('https://api.github.com/repos/o/r/zipball/main');
  });
  it('maps HTTP status → reason', () => {
    expect(classifyZipStatus(404)).toBe('not-found');
    expect(classifyZipStatus(401)).toBe('auth');
    expect(classifyZipStatus(403)).toBe('auth');
    expect(classifyZipStatus(500)).toBe('network');
  });
});

describe('fetchGithubRepoZip — server-side fetch (no sandbox, no git)', () => {
  it('fetches with the token in the Authorization header and returns the zip buffer', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: new Uint8Array([80, 75, 3, 4]) })); // "PK\x03\x04"
    const res = await fetchGithubRepoZip({ url: 'https://github.com/o/r', token: 'ghs_TOK', fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.buf && Array.from(res.buf)).toEqual([80, 75, 3, 4]);
    expect(calls[0].url).toBe('https://api.github.com/repos/o/r/zipball');
    expect(calls[0].headers.Authorization).toBe('Bearer ghs_TOK');
    expect(calls[0].headers['User-Agent']).toBe('NavBharatAI');
  });

  it('anonymously retries a PUBLIC repo when the authed fetch 404s (token scoped to another account)', async () => {
    // The mitrify case: an authed zipball 404s, but the anonymous fetch of the same public repo succeeds.
    const { fetchImpl, calls } = fakeFetch((_url, headers) =>
      headers.Authorization ? { ok: false, status: 404 } : { body: new Uint8Array([1]) });
    const res = await fetchGithubRepoZip({ url: 'https://github.com/aashishcpmt093-ui/mitrify', token: 'ghs_TOK', fetchImpl });
    expect(res.ok).toBe(true);
    expect(calls.length).toBe(2);                 // authed, then anonymous
    expect(calls[0].headers.Authorization).toBe('Bearer ghs_TOK');
    expect(calls[1].headers.Authorization).toBeUndefined();
  });

  it('does NOT anon-retry when no token was sent (nothing to drop)', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ ok: false, status: 404 }));
    const res = await fetchGithubRepoZip({ url: 'https://github.com/o/r', fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-found');
    expect(calls.length).toBe(1);
  });

  it('classifies a network error (fetch throws) without ever throwing itself', async () => {
    const fetchImpl: ZipFetcher = async () => { throw new Error('ECONNREFUSED'); };
    const res = await fetchGithubRepoZip({ url: 'https://github.com/o/r', fetchImpl });
    expect(res).toMatchObject({ ok: false, reason: 'network' });
  });

  it('refuses an over-cap body by its declared content-length (memory guard)', async () => {
    const { fetchImpl } = fakeFetch(() => ({ contentLength: String(200 * 1024 * 1024) }));
    const res = await fetchGithubRepoZip({ url: 'https://github.com/o/r', fetchImpl });
    expect(res).toMatchObject({ ok: false, reason: 'too-large' });
  });

  it('refuses an over-cap body discovered after download (no content-length header)', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: new Uint8Array(10) }));
    const res = await fetchGithubRepoZip({ url: 'https://github.com/o/r', maxBytes: 5, fetchImpl });
    expect(res).toMatchObject({ ok: false, reason: 'too-large' });
  });

  it('treats a zero-byte body as empty (not a false success)', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: new Uint8Array(0) }));
    const res = await fetchGithubRepoZip({ url: 'https://github.com/o/r', fetchImpl });
    expect(res).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('rejects a non-github URL up front (no fetch made)', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({}));
    const res = await fetchGithubRepoZip({ url: 'https://gitlab.com/o/r', fetchImpl });
    expect(res).toMatchObject({ ok: false, reason: 'bad-url' });
    expect(calls.length).toBe(0);
  });
});
