import axios from 'axios';

/**
 * GitHub Repo Analyst — public-repo fetcher & helpers.
 *
 * This module ONLY reads PUBLIC GitHub repositories (read-only) via the public
 * GitHub REST API. It never writes anywhere and never touches private data
 * unless the caller supplies their own token (used only to raise rate limits /
 * read repos they can access). It is intentionally self-contained: it imports
 * nothing from Engineer AI or the AgentV3 engine.
 */

export interface RepoRef { owner: string; repo: string; }

export interface RepoFile { path: string; content: string; truncated?: boolean; }

export interface RepoSnapshot {
  ref: RepoRef;
  url: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  openIssues: number;
  license: string | null;          // SPDX id or name, or null if none detected
  primaryLanguage: string | null;
  languages: string[];             // languages present (by bytes, descending)
  topics: string[];
  pushedAt: string | null;
  archived: boolean;
  readme: string | null;           // README text (may be truncated)
  tree: string[];                  // file paths (possibly truncated)
  treeTruncated: boolean;
  keyFiles: RepoFile[];            // contents of a few important files
  notes: string[];                 // honest fetch notes (truncations, missing pieces)
}

const GH_API = 'https://api.github.com';
const README_MAX = 8000;
const FILE_MAX = 6000;
const TREE_MAX = 400;
const MAX_KEY_FILES = 6;

/** Files worth reading to understand a project (checked against the tree). */
const KEY_FILE_CANDIDATES = [
  'package.json', 'requirements.txt', 'pyproject.toml', 'setup.py', 'go.mod',
  'Cargo.toml', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile',
  'Dockerfile', 'docker-compose.yml', '.github/workflows/ci.yml', 'tsconfig.json',
  'Makefile', 'next.config.js', 'vite.config.ts',
];

/**
 * Parse a GitHub repo reference from free text: a github.com URL (with or
 * without https://, .git, branch/path suffixes) or a bare "owner/repo".
 * Returns the first valid match, or null. Pure & dependency-free for testing.
 */
export function parseRepoRef(text: string): RepoRef | null {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim();

  // 1) Full/loose github.com URL
  const urlMatch = clean.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (urlMatch) {
    const owner = urlMatch[1];
    let repo = urlMatch[2].replace(/\.git$/i, '');
    if (isValidNamePart(owner) && isValidNamePart(repo)) return { owner, repo };
  }

  // 2) Bare owner/repo token (avoid matching things like file paths a/b/c by
  //    requiring exactly one slash in the token and valid name chars).
  const bare = clean.match(/(?:^|\s)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?=$|\s)/);
  if (bare) {
    const owner = bare[1];
    const repo = bare[2];
    if (isValidNamePart(owner) && isValidNamePart(repo) && !looksLikePath(clean, owner, repo)) {
      return { owner, repo };
    }
  }
  return null;
}

function isValidNamePart(s: string): boolean {
  if (!s || s.length > 100) return false;
  if (s === '.' || s === '..') return false;
  return /^[A-Za-z0-9_.-]+$/.test(s);
}

/** Heuristic: reject "owner/repo" that is really part of a longer a/b/c path. */
function looksLikePath(full: string, owner: string, repo: string): boolean {
  const token = `${owner}/${repo}`;
  const idx = full.indexOf(token);
  if (idx < 0) return false;
  const after = full.charAt(idx + token.length);
  return after === '/'; // more path segments follow → not a repo ref
}

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'NavBharatAI-RepoAnalyst' };
  if (token) h.Authorization = `token ${token}`;
  return h;
}

/**
 * Fetch a read-only snapshot of a PUBLIC repo: metadata, license, languages,
 * README, file tree (truncated) and a few key files. Throws a friendly Error
 * on not-found / rate-limit / network problems. `token` is optional (only to
 * raise rate limits or read accessible repos).
 */
export async function fetchPublicRepo(ref: RepoRef, token?: string): Promise<RepoSnapshot> {
  const { owner, repo } = ref;
  const headers = ghHeaders(token);
  const notes: string[] = [];

  let meta: any;
  try {
    const r = await axios.get(`${GH_API}/repos/${owner}/${repo}`, { headers, timeout: 15000 });
    meta = r.data;
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404) throw new Error(`Repository "${owner}/${repo}" was not found, or it is private. Please check the URL (only public repos can be analysed without your own GitHub token).`);
    if (status === 403) throw new Error('GitHub API rate limit reached. Please try again in a little while (or analysing fewer repos per hour).');
    throw new Error(`Could not reach GitHub for "${owner}/${repo}": ${err?.message || 'network error'}.`);
  }

  const defaultBranch = meta.default_branch || 'main';

  // README (best-effort)
  let readme: string | null = null;
  try {
    const r = await axios.get(`${GH_API}/repos/${owner}/${repo}/readme`, { headers, timeout: 15000 });
    if (r.data?.content) {
      const decoded = Buffer.from(r.data.content, 'base64').toString('utf-8');
      readme = decoded.length > README_MAX ? decoded.slice(0, README_MAX) : decoded;
      if (decoded.length > README_MAX) notes.push('README was truncated for length.');
    }
  } catch { notes.push('No README found (or it could not be read).'); }

  // Languages (best-effort)
  let languages: string[] = [];
  try {
    const r = await axios.get(`${GH_API}/repos/${owner}/${repo}/languages`, { headers, timeout: 15000 });
    languages = Object.entries(r.data || {}).sort((a: any, b: any) => b[1] - a[1]).map(([k]) => k);
  } catch { /* ignore */ }

  // File tree (best-effort, truncated)
  let tree: string[] = [];
  let treeTruncated = false;
  try {
    const r = await axios.get(`${GH_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`, { headers, timeout: 20000 });
    const blobs = (r.data?.tree || []).filter((t: any) => t.type === 'blob').map((t: any) => t.path as string);
    if (r.data?.truncated || blobs.length > TREE_MAX) { treeTruncated = true; notes.push('The file tree was large and has been truncated.'); }
    tree = blobs.slice(0, TREE_MAX);
  } catch { notes.push('The file tree could not be fully read.'); }

  // Key files (only those that exist in the tree), content fetched & truncated
  const keyFiles: RepoFile[] = [];
  const present = new Set(tree);
  const wanted = KEY_FILE_CANDIDATES.filter((p) => present.has(p)).slice(0, MAX_KEY_FILES);
  for (const p of wanted) {
    try {
      const r = await axios.get(`${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(p)}?ref=${encodeURIComponent(defaultBranch)}`, { headers, timeout: 15000 });
      if (r.data?.content) {
        const decoded = Buffer.from(r.data.content, 'base64').toString('utf-8');
        const truncated = decoded.length > FILE_MAX;
        keyFiles.push({ path: p, content: truncated ? decoded.slice(0, FILE_MAX) : decoded, truncated });
      }
    } catch { /* skip unreadable file */ }
  }

  return {
    ref,
    url: meta.html_url || `https://github.com/${owner}/${repo}`,
    description: meta.description ?? null,
    defaultBranch,
    stars: meta.stargazers_count ?? 0,
    forks: meta.forks_count ?? 0,
    openIssues: meta.open_issues_count ?? 0,
    license: meta.license?.spdx_id && meta.license.spdx_id !== 'NOASSERTION' ? meta.license.spdx_id : (meta.license?.name ?? null),
    primaryLanguage: meta.language ?? null,
    languages,
    topics: Array.isArray(meta.topics) ? meta.topics : [],
    pushedAt: meta.pushed_at ?? null,
    archived: !!meta.archived,
    readme,
    tree,
    treeTruncated,
    keyFiles,
    notes,
  };
}
