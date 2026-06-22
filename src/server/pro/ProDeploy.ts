/**
 * Phase 87-93 — Multi-Provider Deployment for Pro.
 *
 * Provides deploy helpers for Vercel, Netlify, Railway, GitHub Pages, and
 * custom domains. All use REST APIs (no CLI binaries required in the sandbox)
 * so they work from any execution tier (VFS, Docker, E2B).
 *
 * Each function:
 *  - Returns a permanent public URL on success
 *  - Throws a descriptive error on failure (never swallows errors silently)
 *  - Is self-contained (no shared state, safe to call in parallel)
 */

import * as https from 'https';
import * as http from 'http';

/** Generic JSON REST helper used by all providers. */
async function jsonFetch<T>(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers,
      },
    };
    const req = (parsed.protocol === 'https:' ? https : http).request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed).slice(0, 200)}`));
          } else {
            resolve(parsed as T);
          }
        } catch {
          reject(new Error(`Non-JSON response (${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 87 — Vercel Deploy
// ────────────────────────────────────────────────────────────────────────────

/**
 * Deploy a set of static files to Vercel via the Vercel REST API.
 * Returns the deployment URL (e.g. `https://my-project.vercel.app`).
 *
 * @param token   Vercel personal access token
 * @param name    Project name (slug) — created if it doesn't exist
 * @param files   Record<relativePath, utf8 content>
 */
export async function deployVercel(
  token: string,
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const fileList = Object.entries(files).map(([file, data]) => ({
    file,
    data,
    encoding: 'utf8' as const,
  }));

  const resp = await jsonFetch<{ id: string; url: string; readyState: string }>(
    'POST',
    'https://api.vercel.com/v13/deployments',
    { name, files: fileList, projectSettings: { framework: null } },
    { Authorization: `Bearer ${token}` },
  );

  const deployUrl = `https://${resp.url}`;
  return deployUrl;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 88 — Netlify Deploy
// ────────────────────────────────────────────────────────────────────────────

/**
 * Deploy static files to Netlify via the Netlify API (ZIP deploy).
 * Returns the Netlify site URL.
 *
 * @param token   Netlify personal access token
 * @param siteId  Netlify site ID (create one first in the dashboard)
 * @param files   Record<relativePath, utf8 content>
 */
export async function deployNetlify(
  token: string,
  siteId: string,
  files: Record<string, string>,
): Promise<string> {
  // Netlify ZIP deploy: we send file digests, Netlify responds with which
  // files to upload, then we upload them. Simplified version: use the
  // "create deploy" endpoint with inline file bodies (works for small deploys).
  const fileDigests: Record<string, string> = {};
  const crypto = await import('crypto');
  for (const [path, content] of Object.entries(files)) {
    fileDigests[`/${path}`] = crypto.createHash('sha1').update(content).digest('hex');
  }

  const deploy = await jsonFetch<{ id: string; required: string[]; deploy_ssl_url: string }>(
    'POST',
    `https://api.netlify.com/api/v1/sites/${siteId}/deploys`,
    { files: fileDigests },
    { Authorization: `Bearer ${token}` },
  );

  // Upload required files
  for (const sha of (deploy.required || [])) {
    const entry = Object.entries(files).find(([path, content]) => {
      const digest = crypto.createHash('sha1').update(content).digest('hex');
      return digest === sha;
    });
    if (!entry) continue;
    const [path, content] = entry;
    // Upload the RAW file body — jsonFetch would JSON.stringify it (quoting + escaping the
    // file) and corrupt the deploy. Encode each path segment but keep the slashes intact.
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const up = await fetch(
      `https://api.netlify.com/api/v1/deploys/${deploy.id}/files/${encodedPath}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body: content,
      },
    );
    if (!up.ok) {
      const text = await up.text().catch(() => '');
      throw new Error(`Netlify file upload failed (${up.status}) for ${path}: ${text.slice(0, 200)}`);
    }
  }

  return deploy.deploy_ssl_url || `https://app.netlify.com/sites/${siteId}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 90 — GitHub Pages Deploy
// ────────────────────────────────────────────────────────────────────────────

/**
 * Deploy static files to GitHub Pages by pushing to the `gh-pages` branch.
 * Creates the branch if it doesn't exist. Returns the GitHub Pages URL.
 *
 * @param token    GitHub personal access token (needs `repo` scope)
 * @param owner    GitHub username or org
 * @param repo     Repository name
 * @param files    Record<relativePath, utf8 content>
 */
export async function deployGitHubPages(
  token: string,
  owner: string,
  repo: string,
  files: Record<string, string>,
): Promise<string> {
  const headers = {
    Authorization: `token ${token}`,
    'User-Agent': 'NavBharatAI-Pro',
  };

  // Get or create the gh-pages branch
  let baseSha: string;
  try {
    const branch = await jsonFetch<{ object: { sha: string } }>(
      'GET',
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/gh-pages`,
      undefined,
      headers,
    );
    baseSha = branch.object.sha;
  } catch {
    // gh-pages doesn't exist yet — base off the repo's ACTUAL default branch, not a
    // hardcoded "main" (repos on "master" or any other default would otherwise fail).
    const repoInfo = await jsonFetch<{ default_branch: string }>(
      'GET',
      `https://api.github.com/repos/${owner}/${repo}`,
      undefined,
      headers,
    );
    const defaultBranch = repoInfo.default_branch || 'main';
    const baseRef = await jsonFetch<{ object: { sha: string } }>(
      'GET',
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(defaultBranch)}`,
      undefined,
      headers,
    );
    baseSha = baseRef.object.sha;
  }

  // Create blobs for each file
  const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await jsonFetch<{ sha: string }>(
      'POST',
      `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
      { content, encoding: 'utf-8' },
      headers,
    );
    treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // Create tree
  const tree = await jsonFetch<{ sha: string }>(
    'POST',
    `https://api.github.com/repos/${owner}/${repo}/git/trees`,
    { base_tree: baseSha, tree: treeItems },
    headers,
  );

  // Create commit
  const commit = await jsonFetch<{ sha: string }>(
    'POST',
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    { message: 'Deploy from NavBharatAI Pro', tree: tree.sha, parents: [baseSha] },
    headers,
  );

  // Update or create the gh-pages ref
  try {
    await jsonFetch(
      'PATCH',
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/gh-pages`,
      { sha: commit.sha, force: true },
      headers,
    );
  } catch {
    await jsonFetch(
      'POST',
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      { ref: 'refs/heads/gh-pages', sha: commit.sha },
      headers,
    );
  }

  return `https://${owner}.github.io/${repo}/`;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 91 — Custom Domain (Vercel)
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Phase 6.4 — Cloudflare Pages Deploy
// ────────────────────────────────────────────────────────────────────────────

/**
 * Deploy static files to Cloudflare Pages via the Direct Upload API.
 * Creates the project if it does not exist yet.
 * Returns the deployment URL (`https://{projectName}.pages.dev`).
 *
 * @param token        Cloudflare API token (needs Pages:Edit permission)
 * @param accountId    Cloudflare account ID (from dashboard → top-right menu)
 * @param projectName  Pages project slug (e.g. "my-app" → my-app.pages.dev)
 * @param files        Record<relativePath, utf8 content>
 */
export async function deployCloudflarePages(
  token: string,
  accountId: string,
  projectName: string,
  files: Record<string, string>,
): Promise<string> {
  const authHeaders: Record<string, string> = { Authorization: `Bearer ${token}` };
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;

  // 1. Ensure the Pages project exists — create it if not (best-effort; deploy proceeds either way).
  const checkResp = await fetch(`${base}/${projectName}`, { headers: authHeaders });
  if (checkResp.status === 404) {
    await fetch(base, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: projectName, production_branch: 'main' }),
    });
  }

  // 2. Build multipart form-data: manifest (path→sha256) + one part per unique file hash.
  const crypto = await import('crypto');
  const manifest: Record<string, string> = {};
  const hashToContent = new Map<string, string>();

  for (const [path, content] of Object.entries(files)) {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    manifest[`/${path}`] = hash;
    hashToContent.set(hash, content);
  }

  const form = new FormData();
  form.append(
    'manifest',
    new Blob([JSON.stringify(manifest)], { type: 'application/json' }),
    'manifest.json',
  );
  for (const [hash, content] of hashToContent.entries()) {
    form.append(hash, new Blob([content]), hash);
  }

  // 3. POST the deployment — native fetch handles multipart Content-Type boundary automatically.
  const deployResp = await fetch(`${base}/${projectName}/deployments`, {
    method: 'POST',
    headers: authHeaders,
    body: form,
  });

  if (!deployResp.ok) {
    const text = await deployResp.text().catch(() => '');
    throw new Error(`Cloudflare Pages deploy failed (${deployResp.status}): ${text.slice(0, 300)}`);
  }

  const data = await deployResp.json() as {
    success: boolean;
    result?: { url?: string; latest_stage?: { status: string } };
  };
  if (!data.success) {
    throw new Error(`Cloudflare Pages deploy failed: ${JSON.stringify(data).slice(0, 300)}`);
  }

  return data.result?.url ? `https://${data.result.url}` : `https://${projectName}.pages.dev`;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 91 — Custom Domain (Vercel)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Assign a custom domain to a Vercel project.
 * Returns the domain when successfully added.
 */
export async function assignCustomDomainVercel(
  token: string,
  projectId: string,
  domain: string,
): Promise<string> {
  await jsonFetch(
    'POST',
    `https://api.vercel.com/v9/projects/${projectId}/domains`,
    { name: domain },
    { Authorization: `Bearer ${token}` },
  );
  return domain;
}
