// AgentV3 — SERVER-SIDE GitHub repo fetch (mitrify import autopsy 2026-07-24).
//
// ROOT CAUSE this closes: the GitHub import used to `git clone` the repo INSIDE the E2B sandbox VM. That
// depends on the sandbox having outbound network to github.com AND valid CA certificates — and it doesn't
// (a provably-public repo failed to clone in the sandbox with an unclassified error, while an identical
// clone succeeded everywhere the sandbox's constraints don't apply). Every prior "fix" touched the overlay
// / classifier / reporting — all DOWNSTREAM of a clone that never succeeds — so none of them could work.
//
// The fix: fetch the repo SERVER-SIDE, where the network is proven good (the same server that already
// reaches GitHub's API to create the build's save-repo), as a ZIPBALL. GitHub's zipball is a plain .zip,
// so it feeds the EXACT `extractZipProject` → `landImportedProject` pipeline that the (working) zip-upload
// import already uses. The import stops depending on the sandbox's network/git/certs entirely.
//
// White-label note: "GitHub" is the user's OWN provider they explicitly connect — naming it is correct and
// necessary. No AI vendor/model name appears here. The token is sent only in the Authorization header to
// api.github.com (never logged, never returned).

/** The classified reason a server-side fetch failed — mirrors GitRepoSync's HydrateFailReason vocabulary. */
export type ZipFetchReason = 'not-found' | 'auth' | 'network' | 'too-large' | 'bad-url' | 'empty';

export interface GithubZipResult {
  ok: boolean;
  /** The downloaded .zip bytes on success. */
  buf?: Buffer;
  /** HTTP status of the (final) response, when there was one. */
  status?: number;
  /** Classified failure cause (undefined on success). */
  reason?: ZipFetchReason;
  /** Downloaded byte count (success) or the declared content-length (too-large). */
  bytes?: number;
}

/** The minimal fetch surface used here — injectable so tests never touch the network. */
export type ZipFetcher = (
  url: string,
  init?: { headers?: Record<string, string>; redirect?: 'follow' | 'manual' },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Default per-repo download ceiling (compressed). Generous over any real app; the extractor's own
 *  decompression-bomb guards bound the UNCOMPRESSED size independently. */
export const GITHUB_ZIP_MAX_BYTES = 120 * 1024 * 1024;

/** Extract `{ owner, repo }` from a github.com URL (`.git` and query/hash tolerated). Null when not a
 *  plain two-segment github.com repo URL. Pure. */
export function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  const m = /^https?:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?(?:[?#].*)?$/i.exec(String(url || '').trim());
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  if (!owner || !repo || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

/** The GitHub API zipball endpoint for a repo's DEFAULT branch (a ref can be appended). The API redirects
 *  to a signed codeload URL; `fetch` follows it. Using the API (not codeload directly) means we don't need
 *  to know the branch name up front and token auth covers private repos. Pure. */
export function zipballUrl(owner: string, repo: string, ref?: string): string {
  const base = `https://api.github.com/repos/${owner}/${repo}/zipball`;
  return ref ? `${base}/${encodeURIComponent(ref)}` : base;
}

/** Classify a non-OK HTTP status into a fetch reason. Pure. */
export function classifyZipStatus(status: number): ZipFetchReason {
  if (status === 404) return 'not-found';
  if (status === 401 || status === 403) return 'auth';
  return 'network';
}

/**
 * Fetch a GitHub repo as a .zip buffer, SERVER-SIDE. Tries WITH the token first (needed for private repos),
 * and — mirroring the clone's anonymous-retry — retries WITHOUT the token when an authed fetch 404/403s (a
 * token scoped to a different account/app can hide a PUBLIC repo). Never throws: a network error or an
 * oversize body degrades to a classified `{ ok:false }`. Pure except for the injected/global fetch.
 */
export async function fetchGithubRepoZip(opts: {
  url: string;
  token?: string;
  ref?: string;
  maxBytes?: number;
  fetchImpl?: ZipFetcher;
}): Promise<GithubZipResult> {
  const parsed = parseOwnerRepo(opts.url);
  if (!parsed) return { ok: false, reason: 'bad-url' };
  const maxBytes = opts.maxBytes ?? GITHUB_ZIP_MAX_BYTES;
  const doFetch: ZipFetcher = opts.fetchImpl ?? ((url, init) => (globalThis.fetch as unknown as ZipFetcher)(url, init));
  const target = zipballUrl(parsed.owner, parsed.repo, opts.ref);

  const attempt = async (withToken: boolean): Promise<GithubZipResult> => {
    const headers: Record<string, string> = {
      'User-Agent': 'NavBharatAI',
      Accept: 'application/vnd.github+json',
    };
    if (withToken && opts.token) headers.Authorization = `Bearer ${opts.token}`;
    let res;
    try {
      res = await doFetch(target, { headers, redirect: 'follow' });
    } catch {
      return { ok: false, reason: 'network' };
    }
    if (!res.ok) return { ok: false, status: res.status, reason: classifyZipStatus(res.status) };
    // Guard the download size: refuse an over-cap body up front by its declared length when present.
    const declared = Number(res.headers.get('content-length') || '0');
    if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: res.status, reason: 'too-large', bytes: declared };
    let buf: Buffer;
    try {
      buf = Buffer.from(await res.arrayBuffer());
    } catch {
      return { ok: false, status: res.status, reason: 'network' };
    }
    if (buf.length > maxBytes) return { ok: false, status: res.status, reason: 'too-large', bytes: buf.length };
    if (buf.length === 0) return { ok: false, status: res.status, reason: 'empty' };
    return { ok: true, status: res.status, buf, bytes: buf.length };
  };

  const first = await attempt(!!opts.token);
  // Anonymous retry: a token that can't see this (public) repo 404/403s → try WITHOUT it, exactly like the
  // clone's shouldRetryImportAnonymously. Only when a token was actually used on the first attempt.
  if (!first.ok && opts.token && (first.reason === 'not-found' || first.reason === 'auth')) {
    const anon = await attempt(false);
    if (anon.ok) return anon;
    // Keep the more-informative failure: the authed status usually pinpoints access; fall back to anon.
    return first.reason === 'auth' ? first : anon;
  }
  return first;
}
