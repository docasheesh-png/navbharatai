import path from 'path';
import axios from 'axios';
import type { Express, Request, Response } from 'express';
import { sendSafeError } from '../lib/httpError';

/**
 * SAFETY (never break — admin 2026-07-20): update a branch ref to a new commit WITHOUT force.
 * A plain (non-force) ref update lets GitHub REJECT a non-fast-forward (422) instead of silently
 * overwriting newer commits — so a concurrent push from another device/session can never destroy
 * the user's work. On rejection we return an honest 409 telling them to sync first. Shared by both
 * push routes so the guarantee can't drift between them.
 */
async function updateBranchRefSafely(
  res: Response,
  args: { owner: string; repo: string; branch: string; sha: string; headers: Record<string, string> },
): Promise<boolean> {
  const { owner, repo, branch, sha, headers } = args;
  try {
    await axios.patch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      { sha, force: false },
      { headers },
    );
    return true;
  } catch (patchErr: any) {
    const status = patchErr?.response?.status;
    if (status === 422 || status === 409) {
      // Non-fast-forward: the remote branch has newer commits than the base we built on.
      res.status(409).json({
        error: 'The GitHub branch has newer commits than your last sync. Import/pull the latest changes first, then push again — this protects your repository from losing work.',
        nonFastForward: true,
      });
      return false;
    }
    throw patchErr;
  }
}

/**
 * GitHub data-API routes (fetch repo tree, read file, list branches, push,
 * push-enhanced with repo auto-create). Extracted from the server.ts monolith
 * (Phase 1). Self-contained — the GitHub token is taken from the request's
 * Authorization header; no server-scope closures are used. Behavior unchanged.
 */
export function registerGithubRoutes(app: Express): void {
  app.post('/api/github/fetch', async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(' ')[1];
    const { owner, repo, path: repoPath = '', recursive = true, branch } = req.body;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };

      // If we want a full tree, it's better to use the tree API
      // First, get the default branch or use provided branch
      let targetBranch = branch;
      if (!targetBranch) {
        const repoRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers });
        targetBranch = repoRes.data.default_branch;
      }

      const branchRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/branches/${targetBranch}`, { headers });
      const treeSha = branchRes.data.commit.commit.tree.sha;

      const treeRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=${recursive ? 1 : 0}`, { headers });

      const tree = treeRes.data.tree;
      const files: Record<string, string> = {};

      // Common text extensions to fetch
      const textExtensions = new Set(['.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.py', '.rb', '.go', '.rs', '.php', '.java', '.c', '.cpp', '.h', '.hpp', '.sql', '.yml', '.yaml', '.xml']);

      for (const item of tree) {
          if (item.type === 'blob') {
              const ext = path.extname(item.path).toLowerCase();
              if (textExtensions.has(ext) || path.basename(item.path) === 'Dockerfile' || path.basename(item.path).startsWith('.')) {
                  if (Object.keys(files).length > 200) break; // Increased limit for real projects

                  try {
                      const blobRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/blobs/${item.sha}`, { headers });
                      const content = Buffer.from(blobRes.data.content, 'base64').toString('utf-8');
                      files[item.path] = content;
                  } catch (err) {
                      console.warn(`Failed to fetch blob for ${item.path}:`, err);
                  }
              }
          }
      }

      res.json({ files, tree });
    } catch (err: any) {
      console.error('Fetch Error:', err.response?.data || err.message);
      res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
    }
  });

  app.post('/api/github/file', async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(' ')[1];
    const { owner, repo, path } = req.body;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
      const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers });

      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      res.json({ content, sha: response.data.sha });
    } catch (err: any) {
      res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
    }
  });

  app.post('/api/github/branches', async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(' ')[1];
    const { owner, repo } = req.body;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
      const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/branches`, { headers });
      res.json({ branches: response.data.map((b: any) => b.name) });
    } catch (err: any) {
      res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
    }
  });

  app.post('/api/github/push', async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(' ')[1];
    const { owner, repo, files, message = 'Update from Navbharat AI', branch = 'main' } = req.body;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      // Professional push logic using GitHub API (simplified for standard web projects)
      // 1. Get latest commit SHA
      // 2. Create blobs
      // 3. Create tree
      // 4. Create commit
      // 5. Update reference

      const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };

      // Get base branch info
      const refRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
      const lastCommitSha = refRes.data.object.sha;

      const treeItems = [];
      for (const [path, content] of Object.entries(files)) {
        treeItems.push({
          path,
          mode: '100644',
          type: 'blob',
          content: content as string
        });
      }

      const treeRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
        base_tree: lastCommitSha,
        tree: treeItems
      }, { headers });

      const commitRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
        message,
        tree: treeRes.data.sha,
        parents: [lastCommitSha]
      }, { headers });

      // SAFE ref update (no force) — a non-fast-forward is rejected, never clobbered.
      const ok = await updateBranchRefSafely(res, { owner, repo, branch, sha: commitRes.data.sha, headers });
      if (!ok) return; // the safe updater already sent the 409

      res.json({ success: true, sha: commitRes.data.sha });
    } catch (err: any) {
      console.error('Push Error:', err.response?.data || err.message);
      sendSafeError(res, err.response?.status || 500, err.response?.data?.message || 'Push to GitHub failed. Please try again.', err, 'github push');
    }
  });

  app.post('/api/github/push-enhanced', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^(bearer|token)\s+/i, '').trim() : null;
    const { owner, repo, files, visibility = 'private', branch = 'main', message = 'Update from Navbharat AI' } = req.body;

    if (!token) return res.status(401).json({ error: 'Unauthorized: GitHub OAuth token is missing' });
    if (!owner || !repo) return res.status(400).json({ error: 'Repository owner and name are required' });

    console.log(`[PUSH_ENHANCED] Initializing push for target ${owner}/${repo} on branch ${branch} (Visibility: ${visibility})`);

    const headers = {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json'
    };

    try {
      // Step A: Determine if repository already exists
      let repoExists = false;
      try {
        await axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers });
        repoExists = true;
        console.log(`[PUSH_ENHANCED] Target repository https://github.com/${owner}/${repo} exists.`);
      } catch (checkErr: any) {
        if (checkErr.response?.status === 404) {
          console.log(`[PUSH_ENHANCED] Target repository https://github.com/${owner}/${repo} does not exist. Creating...`);
        } else {
          throw checkErr;
        }
      }

      // Step B: Create repository if it does not exist
      if (!repoExists) {
        // Fetch current authenticated user's login to verify organization vs personal
        const userProfileRes = await axios.get('https://api.github.com/user', { headers });
        const username = userProfileRes.data.login;

        let createRes;
        if (owner.toLowerCase() === username.toLowerCase()) {
          console.log(`[PUSH_ENHANCED] Creating personal repository "${repo}" for user "${username}"`);
          createRes = await axios.post('https://api.github.com/user/repos', {
            name: repo,
            private: visibility === 'private',
            description: 'Created dynamically inside navBharat AI Workspaces',
            auto_init: false // Initialize empty so we import all files
          }, { headers });
        } else {
          console.log(`[PUSH_ENHANCED] Attempting to create repository "${repo}" inside organization "${owner}"`);
          try {
            createRes = await axios.post(`https://api.github.com/orgs/${owner}/repos`, {
              name: repo,
              private: visibility === 'private',
              description: 'Created dynamically inside navBharat AI Workspaces',
              auto_init: false
            }, { headers });
          } catch (orgErr: any) {
            console.warn(`[PUSH_ENHANCED] Organization repo creation failed. Fallback to user profile creation...`, orgErr.response?.data || orgErr.message);
            createRes = await axios.post('https://api.github.com/user/repos', {
              name: repo,
              private: visibility === 'private',
              description: 'Created dynamically inside navBharat AI Workspaces',
              auto_init: false
            }, { headers });
          }
        }
        console.log(`[PUSH_ENHANCED] Repository created successfully: ${createRes.data.html_url}`);
      }

      // Step C: Check if branch reference exists or if repo is empty
      let lastCommitSha: string | null = null;
      let referenceExists = false;

      try {
        const refRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
        lastCommitSha = refRes.data.object.sha;
        referenceExists = true;
      } catch (refErr: any) {
        if (refErr.response?.status === 404 || refErr.response?.status === 409) {
          console.log(`[PUSH_ENHANCED] Branch ref "heads/${branch}" not found or repo is empty. Bootstrapping initial commit...`);
        } else {
          throw refErr;
        }
      }

      // If repository is empty, we must create an initial commit by writing first file via Contents API
      if (!referenceExists || !lastCommitSha) {
        const fileNames = Object.keys(files || {});
        if (fileNames.length === 0) {
          return res.status(400).json({ error: 'Cannot push an empty workspace. No files present.' });
        }

        const firstFilePath = fileNames.find(f => f === 'README.md' || f === 'package.json') || fileNames[0];
        const firstFileContent = files[firstFilePath] || '';
        const base64Content = Buffer.from(firstFileContent).toString('base64');

        console.log(`[PUSH_ENHANCED] Bootstrap committing file "${firstFilePath}" via contents API to establish "/heads/${branch}" branch...`);
        const putRes = await axios.put(`https://api.github.com/repos/${owner}/${repo}/contents/${firstFilePath}`, {
          message: `Initial bootstrap commit via navBharatAI [${firstFilePath}]`,
          content: base64Content,
          branch: branch
        }, { headers });

        lastCommitSha = putRes.data.commit.sha;
        referenceExists = true;
        console.log(`[PUSH_ENHANCED] Boostrap commit created successfully with SHA ${lastCommitSha}`);
      }

      // Tree API to commit entire workspace with automated security filtering
      console.log(`[PUSH_ENHANCED] Writing complete directory tree for ${owner}/${repo} on base commit ${lastCommitSha}...`);
      const treeItems = [];
      for (const [path, content] of Object.entries(files || {})) {
        const lowerPath = path.toLowerCase();
        // Skip node_modules, internal git heads, active environment variables, credentials, and app secrets
        if (
          lowerPath.includes('node_modules/') ||
          lowerPath.includes('.git/') ||
          (lowerPath.startsWith('.env') && !lowerPath.endsWith('.example')) ||
          lowerPath.includes('firebase-applet-config.json') ||
          lowerPath.includes('serviceaccount') ||
          lowerPath.includes('secret') ||
          lowerPath.includes('private_key') ||
          lowerPath.endsWith('.log')
        ) {
          console.log(`[PUSH_ENHANCED] Security Shield successfully isolated & skipped transmission of sensitive file: ${path}`);
          continue;
        }
        treeItems.push({
          path,
          mode: '100644',
          type: 'blob',
          content: content as string
        });
      }

      const treeRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
        base_tree: lastCommitSha,
        tree: treeItems
      }, { headers });

      const treeSha = treeRes.data.sha;
      console.log(`[PUSH_ENHANCED] Tree written with SHA ${treeSha}. Creating commit...`);

      const commitRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
        message,
        tree: treeSha,
        parents: [lastCommitSha]
      }, { headers });

      const newCommitSha = commitRes.data.sha;
      console.log(`[PUSH_ENHANCED] Commit created: ${newCommitSha}. Updating branch head ref...`);

      // SAFE ref update (no force) — a concurrent push can never be silently overwritten.
      const refOk = await updateBranchRefSafely(res, { owner, repo, branch, sha: newCommitSha, headers });
      if (!refOk) return; // the safe updater already sent the 409 non-fast-forward message

      const repoUrl = `https://github.com/${owner}/${repo}`;
      console.log(`[PUSH_ENHANCED] Push successful to ${repoUrl}! Branch: ${branch}, SHA: ${newCommitSha}`);

      res.json({
        success: true,
        sha: newCommitSha,
        repoUrl: repoUrl,
        owner: owner,
        repo: repo,
        branch: branch
      });
    } catch (err: any) {
      console.error('[PUSH_ENHANCED] push failed:', err.response?.data || err.message);
      // Do NOT echo the raw GitHub response body to the client; route through the safe error helper.
      sendSafeError(res, err.response?.status || 500, err.response?.data?.message || 'Push to GitHub failed. Please try again.', err, 'github push-enhanced');
    }
  });
}
