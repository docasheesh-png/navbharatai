// AgentV3 — INSTANT server-side GitHub repo tree + file reads (admin 2026-07-24: "Claude 0.1s me repo
// connect ho jata hai — kya woh clone karta hai? ya direct main par kaam karta hai?").
//
// The insight: a coding agent that "connects" instantly does NOT bulk-clone. It asks GitHub's API for the
// repo's file TREE in one tiny call (`git/trees/{ref}?recursive=1` → every path as JSON, no blob content),
// then reads only the FEW files it actually needs on demand (contents API). No gigabytes transferred, no
// sandbox, no CA-cert dependency — so "connect + survey" feels instant. Full materialization into the
// sandbox (a zipball write — see GithubZipFetch.ts) is only needed when the app must actually RUN.
//
// This module is the READ side: fetch the tree (paths) + individual text files, SERVER-SIDE (proven-good
// network — the same server already reaches GitHub's API). Injectable fetch, classified failures, never
// throws. White-label note: "GitHub" is the user's own connected provider — naming it is correct; no AI
// vendor/model name appears. The token is sent only in the Authorization header to api.github.com.

import { parseOwnerRepo, type ZipFetchReason } from './GithubZipFetch';
import { SKIP_DIR_RE, JUNK_FILE_RE, SECRET_FILE_RE, BINARY_EXT_RE, IMPORT_MAX_FILE_BYTES, IMPORT_MAX_FILES } from './ProjectImport';

export type TreeFetchReason = ZipFetchReason;

export interface RepoTreeResult {
  ok: boolean;
  /** Every file (blob) path in the repo, from the recursive tree — no content, just paths. */
  paths?: string[];
  /** The repo's default branch (resolved from the repo metadata). */
  defaultBranch?: string;
  /** GitHub truncates a tree over ~100k entries / 7MB — then `paths` is a partial list (honest flag). */
  truncated?: boolean;
  status?: number;
  reason?: TreeFetchReason;
}

export interface RepoFileResult {
  ok: boolean;
  content?: string;
  status?: number;
  reason?: TreeFetchReason;
}

/** The minimal JSON-fetch surface used here — injectable so tests never touch the network. */
export type JsonFetcher = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Per-file read cap for a survey key-file (README/package.json/config) — plenty for any real one. */
export const API_FILE_MAX_BYTES = 512 * 1024;

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': 'NavBharatAI', Accept: 'application/vnd.github+json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function classify(status: number): TreeFetchReason {
  if (status === 404) return 'not-found';
  if (status === 401 || status === 403) return 'auth';
  return 'network';
}

function resolveFetch(fetchImpl?: JsonFetcher): JsonFetcher {
  return fetchImpl ?? ((url, init) => (globalThis.fetch as unknown as JsonFetcher)(url, init));
}

/**
 * Fetch a repo's full file-path list via the GitHub API — the INSTANT "connect" (no clone, no download).
 * Resolves the default branch from the repo metadata, then reads the recursive tree. Tries WITH the token
 * first, then anonymously (a token scoped to another account can hide a PUBLIC repo — same as the clone/
 * zipball anonymous retry). Never throws.
 */
export async function fetchRepoTree(opts: {
  url: string;
  token?: string;
  fetchImpl?: JsonFetcher;
}): Promise<RepoTreeResult> {
  const parsed = parseOwnerRepo(opts.url);
  if (!parsed) return { ok: false, reason: 'bad-url' };
  const doFetch = resolveFetch(opts.fetchImpl);
  const { owner, repo } = parsed;

  const attempt = async (withToken: boolean): Promise<RepoTreeResult> => {
    const headers = ghHeaders(withToken ? opts.token : undefined);
    // 1) repo metadata → default branch
    let metaRes;
    try { metaRes = await doFetch(`https://api.github.com/repos/${owner}/${repo}`, { headers }); }
    catch { return { ok: false, reason: 'network' }; }
    if (!metaRes.ok) return { ok: false, status: metaRes.status, reason: classify(metaRes.status) };
    let defaultBranch = 'main';
    try {
      const meta = (await metaRes.json()) as { default_branch?: unknown };
      if (typeof meta.default_branch === 'string' && meta.default_branch) defaultBranch = meta.default_branch;
    } catch { /* keep the 'main' default */ }
    // 2) recursive tree → all blob paths
    let treeRes;
    try {
      treeRes = await doFetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
        { headers },
      );
    } catch { return { ok: false, reason: 'network' }; }
    if (!treeRes.ok) return { ok: false, status: treeRes.status, reason: classify(treeRes.status) };
    let paths: string[] = [];
    let truncated = false;
    try {
      const body = (await treeRes.json()) as { tree?: Array<{ path?: unknown; type?: unknown }>; truncated?: unknown };
      truncated = body.truncated === true;
      paths = (body.tree ?? [])
        .filter((e) => e && e.type === 'blob' && typeof e.path === 'string')
        .map((e) => e.path as string)
        .sort((a, b) => a.localeCompare(b));
    } catch { return { ok: false, status: treeRes.status, reason: 'network' }; }
    if (paths.length === 0) return { ok: false, status: treeRes.status, reason: 'empty', defaultBranch };
    return { ok: true, status: treeRes.status, paths, defaultBranch, truncated };
  };

  const first = await attempt(!!opts.token);
  if (!first.ok && opts.token && (first.reason === 'not-found' || first.reason === 'auth')) {
    const anon = await attempt(false);
    if (anon.ok) return anon;
    return first.reason === 'auth' ? first : anon;
  }
  return first;
}

/**
 * Read ONE text file's content via the GitHub contents API — for the few "key" files a survey needs
 * (package.json, README, a config). Base64-decoded; over-cap or binary files return `{ ok:false }`.
 * Never throws.
 */
export async function fetchRepoTextFile(opts: {
  url: string;
  path: string;
  token?: string;
  ref?: string;
  fetchImpl?: JsonFetcher;
}): Promise<RepoFileResult> {
  const parsed = parseOwnerRepo(opts.url);
  if (!parsed) return { ok: false, reason: 'bad-url' };
  const doFetch = resolveFetch(opts.fetchImpl);
  const { owner, repo } = parsed;
  const safePath = opts.path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  const q = opts.ref ? `?ref=${encodeURIComponent(opts.ref)}` : '';
  let res;
  try { res = await doFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${safePath}${q}`, { headers: ghHeaders(opts.token) }); }
  catch { return { ok: false, reason: 'network' }; }
  if (!res.ok) return { ok: false, status: res.status, reason: classify(res.status) };
  try {
    const body = (await res.json()) as { content?: unknown; encoding?: unknown; size?: unknown };
    if (typeof body.size === 'number' && body.size > API_FILE_MAX_BYTES) return { ok: false, status: res.status, reason: 'too-large' };
    if (body.encoding !== 'base64' || typeof body.content !== 'string') return { ok: false, status: res.status, reason: 'empty' };
    const content = Buffer.from(body.content, 'base64').toString('utf8');
    return { ok: true, status: res.status, content };
  } catch { return { ok: false, status: res.status, reason: 'network' }; }
}

export interface TreeSummary {
  fileCount: number;
  /** Top-level entries (a folder once, files as-is), sorted, bounded for display. */
  topLevel: string[];
  /** The most common source extensions, most-frequent first (for a one-line "mostly .ts/.tsx" hint). */
  extensions: Array<{ ext: string; count: number }>;
}

/**
 * Summarize a tree's paths into an instant, human-readable structure preview for the "connected"
 * narration — top-level folders/files + the dominant file types. Pure. Bounded so a huge repo never
 * floods the chat.
 */
export function summarizeRepoTree(paths: string[], opts?: { maxTopLevel?: number }): TreeSummary {
  const maxTopLevel = opts?.maxTopLevel ?? 24;
  const top = new Set<string>();
  const extCount = new Map<string, number>();
  for (const p of paths) {
    const slash = p.indexOf('/');
    top.add(slash === -1 ? p : `${p.slice(0, slash)}/`);
    const m = /\.([a-z0-9]+)$/i.exec(p);
    if (m) {
      const ext = m[1].toLowerCase();
      extCount.set(ext, (extCount.get(ext) ?? 0) + 1);
    }
  }
  const topLevel = [...top].sort((a, b) => a.localeCompare(b)).slice(0, maxTopLevel);
  const extensions = [...extCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([ext, count]) => ({ ext, count }));
  return { fileCount: paths.length, topLevel, extensions };
}

export interface RepoMaterializeResult {
  ok: boolean;
  /** The full text-file map, filtered exactly like the zip path (node_modules/binaries/secrets dropped). */
  files?: Record<string, string>;
  fetched?: number;
  skipped?: number;
  truncated?: boolean;
  status?: number;
  reason?: TreeFetchReason;
}

/** A bounded-concurrency map over items (no dependency). */
async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (idx < items.length) {
      const cur = items[idx++];
      await worker(cur);
    }
  });
  await Promise.all(runners);
}

/**
 * Materialize a repo's ENTIRE text-file map using ONLY api.github.com (git tree → git blobs) — never
 * codeload.github.com (where the zipball redirects) and never the sandbox. This is the MOST RELIABLE
 * fetch by construction: api.github.com is the exact host the proven UserGitHubClient already reaches in
 * production (it creates the user's save-repo). Filters files with ProjectImport's shared rules so the
 * result matches the zip path. Token-auth with anonymous retry; bounded concurrency; never throws.
 * (mitrify autopsy 2026-07-24 — the zipball's codeload redirect is the last unproven-reachable host.)
 */
export async function materializeRepoViaApi(opts: {
  url: string;
  token?: string;
  maxFiles?: number;
  concurrency?: number;
  fetchImpl?: JsonFetcher;
}): Promise<RepoMaterializeResult> {
  const parsed = parseOwnerRepo(opts.url);
  if (!parsed) return { ok: false, reason: 'bad-url' };
  const doFetch = resolveFetch(opts.fetchImpl);
  const { owner, repo } = parsed;
  const maxFiles = opts.maxFiles ?? IMPORT_MAX_FILES;
  const concurrency = opts.concurrency ?? 8;

  const attempt = async (withToken: boolean): Promise<RepoMaterializeResult> => {
    const headers = ghHeaders(withToken ? opts.token : undefined);
    // 1) default branch
    let defaultBranch = 'main';
    let metaRes;
    try { metaRes = await doFetch(`https://api.github.com/repos/${owner}/${repo}`, { headers }); }
    catch { return { ok: false, reason: 'network' }; }
    if (!metaRes.ok) return { ok: false, status: metaRes.status, reason: classify(metaRes.status) };
    try { const m = (await metaRes.json()) as { default_branch?: unknown }; if (typeof m.default_branch === 'string' && m.default_branch) defaultBranch = m.default_branch; } catch { /* keep 'main' */ }
    // 2) recursive tree WITH blob shas + sizes
    let treeRes;
    try { treeRes = await doFetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`, { headers }); }
    catch { return { ok: false, reason: 'network' }; }
    if (!treeRes.ok) return { ok: false, status: treeRes.status, reason: classify(treeRes.status) };
    let entries: Array<{ path: string; sha: string; size: number }> = [];
    let truncated = false;
    try {
      const body = (await treeRes.json()) as { tree?: Array<{ path?: unknown; type?: unknown; sha?: unknown; size?: unknown }>; truncated?: unknown };
      truncated = body.truncated === true;
      entries = (body.tree ?? [])
        .filter((e) => e && e.type === 'blob' && typeof e.path === 'string' && typeof e.sha === 'string')
        .map((e) => ({ path: e.path as string, sha: e.sha as string, size: typeof e.size === 'number' ? e.size : 0 }));
    } catch { return { ok: false, status: treeRes.status, reason: 'network' }; }
    if (entries.length === 0) return { ok: false, status: treeRes.status, reason: 'empty', truncated };
    // 3) filter with the SAME rules as the zip path (single source of truth)
    const keep = entries.filter((e) =>
      !SKIP_DIR_RE.test(e.path) && !JUNK_FILE_RE.test(e.path) && !SECRET_FILE_RE.test(e.path)
      && !BINARY_EXT_RE.test(e.path) && e.size <= IMPORT_MAX_FILE_BYTES,
    ).slice(0, maxFiles);
    let skipped = entries.length - keep.length;
    // 4) fetch each kept blob's content (base64) — bounded concurrency, all on api.github.com
    const files: Record<string, string> = {};
    await pool(keep, concurrency, async (e) => {
      try {
        const r = await doFetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs/${e.sha}`, { headers });
        if (!r.ok) { skipped++; return; }
        const b = (await r.json()) as { content?: unknown; encoding?: unknown };
        if (b.encoding === 'base64' && typeof b.content === 'string') files[e.path] = Buffer.from(b.content, 'base64').toString('utf8');
        else skipped++;
      } catch { skipped++; }
    });
    if (Object.keys(files).length === 0) return { ok: false, status: treeRes.status, reason: 'empty', truncated };
    return { ok: true, status: treeRes.status, files, fetched: Object.keys(files).length, skipped, truncated };
  };

  const first = await attempt(!!opts.token);
  if (!first.ok && opts.token && (first.reason === 'not-found' || first.reason === 'auth')) {
    const anon = await attempt(false);
    if (anon.ok) return anon;
    return first.reason === 'auth' ? first : anon;
  }
  return first;
}

/** Ordered candidate paths a survey should read first to describe an app accurately — checked against the
 *  actual tree so we only fetch files that exist. Pure. */
const SURVEY_FILE_CANDIDATES = [
  'package.json', 'README.md', 'readme.md', 'README', 'requirements.txt', 'pyproject.toml',
  'go.mod', 'Cargo.toml', 'composer.json', 'pom.xml', 'build.gradle', 'Gemfile',
  'tsconfig.json', 'vite.config.ts', 'next.config.js', 'next.config.mjs', 'index.html',
];

/** Pick the key files (that actually exist in the tree) a survey should read, bounded. Pure. */
export function pickSurveyFiles(paths: string[], max = 4): string[] {
  const set = new Set(paths);
  const picked: string[] = [];
  for (const c of SURVEY_FILE_CANDIDATES) {
    if (set.has(c)) picked.push(c);
    if (picked.length >= max) break;
  }
  return picked;
}
