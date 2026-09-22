// Reading and writing a user's GitHub repository — ONE implementation, shared by every route that
// touches their app repo.
//
// WHY SHARED (rule 4, fix the class not the instance): the create-repo and commit-a-tree logic first
// existed only inside routes/mobileSetup.ts as private functions. The self-healing build loop needs the
// exact same commit semantics — same branch, same tree-vs-blob handling, same non-forced ref update — and
// a second copy would drift the moment either side was touched. So it lives here once and both import it.
//
// The binary handling below is not incidental: the git tree API's `content` field is text-only, so a PNG
// sent that way arrives corrupted. Binary files therefore become real blobs first and are referenced by
// sha, which is the only way a user's app icon survives the trip intact.

import axios from 'axios';

export type GhHeaders = Record<string, string>;

/** Authorization headers for the GitHub REST API from a user's OAuth token. */
export function githubApiHeaders(token: string): GhHeaders {
  return { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
}

/**
 * Find the repository, creating it when it does not exist yet.
 *
 * `auto_init` matters: a repository with no commits has no branch at all, and every commit below needs
 * one to build on. Creating it empty and then discovering that is a confusing failure two steps later.
 */
export async function ensureRepo(
  headers: GhHeaders,
  owner: string,
  repo: string,
  description: string,
): Promise<{ created: boolean; defaultBranch: string }> {
  try {
    const existing = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    return { created: false, defaultBranch: existing.data?.default_branch || 'main' };
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status !== 404) throw err;
  }
  const made = await axios.post(
    'https://api.github.com/user/repos',
    { name: repo, description: description.slice(0, 300), private: true, auto_init: true },
    { headers },
  );
  return { created: true, defaultBranch: made.data?.default_branch || 'main' };
}

/** Commit every file in one go, text through the tree and binaries as real blobs. */
export async function commitFiles(
  headers: GhHeaders,
  owner: string,
  repo: string,
  branch: string,
  files: Record<string, string>,
  binaryFiles: Record<string, string>,
  message: string,
  /**
   * Paths to DELETE in the same commit (a tree entry with `sha: null`). The tree is built on
   * `base_tree`, so a file this push does not mention survives from the previous commit — which is
   * right for everything except a folder this push OWNS outright: `www/` on a prebuilt ship is exactly
   * this build's output, and a hashed bundle left over from the previous one would otherwise be
   * packaged into the phone app for ever. Only paths the caller has SEEN in the repository belong here.
   */
  removePaths: readonly string[] = [],
): Promise<string> {
  const refRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
  const parentSha = refRes.data.object.sha;

  const tree: Array<Record<string, string | null>> = Object.entries(files).map(([path, content]) => ({
    path, mode: '100644', type: 'blob', content,
  }));
  const present = new Set([...Object.keys(files), ...Object.keys(binaryFiles)]);
  for (const path of removePaths) {
    if (!path || present.has(path)) continue;
    tree.push({ path, mode: '100644', type: 'blob', sha: null });
  }

  for (const [path, base64] of Object.entries(binaryFiles)) {
    const blob = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
      { content: base64, encoding: 'base64' },
      { headers },
    );
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.data.sha });
  }

  const treeRes = await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/git/trees`,
    { base_tree: parentSha, tree },
    { headers },
  );
  const commitRes = await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    { message, tree: treeRes.data.sha, parents: [parentSha] },
    { headers },
  );
  await axios.patch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    { sha: commitRes.data.sha, force: false },
    { headers },
  );
  return commitRes.data.sha;
}

/**
 * Read text files back out of a branch.
 *
 * A path that is absent is simply omitted rather than throwing: the self-healing loop asks for the files
 * a repair MIGHT need, and "this repo has no package.json" is a normal answer it handles, not an error.
 */
export async function readRepoFiles(
  headers: GhHeaders,
  owner: string,
  repo: string,
  branch: string,
  paths: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    try {
      const r = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`,
        { headers },
      );
      if (r.data?.encoding === 'base64' && typeof r.data?.content === 'string') {
        out[path] = Buffer.from(r.data.content, 'base64').toString('utf8');
      }
    } catch {
      // Missing file — leave it out; the caller decides whether that matters.
    }
  }
  return out;
}

/**
 * Every blob under `prefix/` in the repository — the WHOLE subtree, unfiltered — so a caller that owns
 * that folder can say which of its files this push should remove. `null` when the tree could not be
 * read: then the caller removes nothing, which only leaves a stale file behind, never deletes a live one.
 * A truncated tree is treated the same way, for the same reason.
 */
export async function listRepoPathsUnder(
  headers: GhHeaders,
  owner: string,
  repo: string,
  branch: string,
  prefix: string,
): Promise<string[] | null> {
  const dir = String(prefix || '').replace(/^\/+|\/+$/g, '');
  if (!dir) return null;
  try {
    const r = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers },
    );
    if (r.data?.truncated === true) return null;
    const tree = Array.isArray(r.data?.tree) ? (r.data.tree as Array<{ path?: unknown; type?: unknown }>) : [];
    const out: string[] = [];
    for (const t of tree) {
      if (t.type !== 'blob' || typeof t.path !== 'string') continue;
      if (t.path.startsWith(`${dir}/`)) out.push(t.path);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * The repository's file paths on a branch — what the repair loop shows the model so it can ASK for a
 * file it needs, the way a developer opens the import target next to the file that failed.
 *
 * Bounded and text-only by construction: the tree API is one request, blobs only (no directories or
 * submodules), and anything that could never be a source file a repair would read is dropped here so
 * it is never even listed. A tree the API truncates is still returned — a partial list means a partial
 * menu, which is safe, because a path the model asks for is checked against THIS list before any read.
 */
export async function listRepoTree(
  headers: GhHeaders,
  owner: string,
  repo: string,
  branch: string,
  cap = 400,
): Promise<string[]> {
  try {
    const r = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers },
    );
    const tree = Array.isArray(r.data?.tree) ? (r.data.tree as Array<{ path?: unknown; type?: unknown; size?: unknown }>) : [];
    const out: string[] = [];
    for (const t of tree) {
      if (t.type !== 'blob' || typeof t.path !== 'string') continue;
      if (/(^|\/)(node_modules|dist|build|\.git|android|ios|www|\.gradle)\//.test(t.path)) continue;
      if (typeof t.size === 'number' && t.size > 400_000) continue;
      out.push(t.path);
      if (out.length >= cap) break;
    }
    return out;
  } catch {
    return [];
  }
}
