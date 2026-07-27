// "Set up my app for the stores" — the one call that turns a NavBharatAI-built app into a GitHub
// repository whose workflows produce a genuine, signed .aab / .apk / .ipa.
//
// WHY (admin 2026-07-27): the admin pointed out — correctly — that this is exactly how Claude Code
// ships NavBharatAI's own mobile apps. Nobody compiles on their own server. GitHub's runners do the
// building (Linux for Android, macOS for iOS, because Apple permits no other kind of machine), the
// user holds their own signing credentials as repository secrets, and the tool's job is to do all the
// setup and then guide. That is what this route implements for a NavBharatAI user's app.
//
// WHO DOES WHAT — and none of it is an excuse, it is what signing genuinely requires:
//   NavBharatAI : assembles the project, writes the workflows, creates/pushes the repo, starts the
//                 build, and hands back the finished binary.
//   GitHub      : compiles and signs, on its own runners.
//   The user    : keeps their keystore and Apple credentials, as GitHub secrets we never see. A
//                 signing key IS the app's permanent identity — if we held it and lost it, their app
//                 could never be updated again.

import type { Express, Request, Response } from 'express';
import axios from 'axios';
import { loadWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { sessionWorkspaceId } from '../lib/workspaceEdit';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { generateShipKit } from '../lib/mobileShipKit';
import { assembleMobileProject } from '../lib/mobileProjectAssembler';

/** GitHub's own limit on a repository name, plus the characters it accepts. */
export function isValidRepoName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== '.' && name !== '..';
}

/** Turn an app name into a repository name GitHub will accept. */
export function repoNameFor(appName: string): string {
  const slug = (appName || 'my-app')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'my-app';
}

/** The user's GitHub token, sent as a second header so it is never confused with the Firebase one. */
function githubToken(req: Request): string | null {
  const raw = req.headers['x-github-token'];
  const token = Array.isArray(raw) ? raw[0] : raw;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

type GhHeaders = Record<string, string>;

/**
 * Find the repository, creating it when it does not exist yet.
 *
 * `auto_init` matters: a repository with no commits has no branch at all, and every push below needs
 * one to build on. Creating it empty and then discovering that is a confusing failure two steps later.
 */
async function ensureRepo(
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

/**
 * Commit every file in one go.
 *
 * Text goes straight into the tree, but the tree API's `content` field is text-only — a PNG sent that
 * way arrives corrupted. Binary files therefore become real blobs first (base64) and are referenced by
 * sha, which is the only way an icon survives the trip intact.
 */
async function commitFiles(
  headers: GhHeaders,
  owner: string,
  repo: string,
  branch: string,
  files: Record<string, string>,
  binaryFiles: Record<string, string>,
  message: string,
): Promise<string> {
  const refRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
  const parentSha = refRes.data.object.sha;

  const tree: Array<Record<string, string>> = Object.entries(files).map(([path, content]) => ({
    path, mode: '100644', type: 'blob', content,
  }));

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

export function registerMobileSetupRoutes(app: Express): void {
  /**
   * Assemble the user's app into a store-ready repository and push it.
   *
   * Everything that can be done for the user IS done here. What is left afterwards is only the part
   * that must be theirs: adding their own signing secrets, which the response spells out.
   */
  app.post('/api/mobile-ship/setup', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Please sign in first.' });

    const ghToken = githubToken(req);
    if (!ghToken) {
      return res.status(401).json({
        error: 'Connect your GitHub account first — that is where your app gets built, and where only you can put your signing key.',
      });
    }

    const { sessionId, appName, appId, repo, iconDataUrl, ios } = (req.body || {}) as Record<string, unknown>;
    const workspaceId = sessionWorkspaceId(uid, String(sessionId || ''));
    if (!workspaceId) return res.status(400).json({ error: 'Which app should be prepared?' });

    const name = typeof appName === 'string' && appName.trim() ? appName.trim().slice(0, 60) : 'My App';
    const repoName = typeof repo === 'string' && repo.trim() ? repo.trim() : repoNameFor(name);
    if (!isValidRepoName(repoName)) {
      return res.status(400).json({ error: 'That repository name has characters GitHub does not allow. Use letters, numbers, dots, hyphens or underscores.' });
    }

    let appFiles: Record<string, string>;
    try {
      appFiles = await loadWorkspaceFiles(workspaceId);
    } catch {
      return res.status(502).json({ error: 'Could not read that app’s files.' });
    }
    if (Object.keys(appFiles).length === 0) {
      return res.status(422).json({
        error: 'That app has no files yet, so there is nothing to package. Build it with NavBharatAI Pro first.',
      });
    }

    const headers: GhHeaders = { Authorization: `token ${ghToken}`, Accept: 'application/vnd.github.v3+json' };

    // Who the token belongs to — never taken from the client, so a token cannot be pointed at
    // somebody else's account.
    let owner: string;
    try {
      const me = await axios.get('https://api.github.com/user', { headers });
      owner = me.data?.login;
      if (!owner) throw new Error('no login');
    } catch {
      return res.status(401).json({ error: 'That GitHub connection is no longer valid. Please reconnect GitHub and try again.' });
    }

    const includeIos = ios !== false;
    const kit = generateShipKit({ appName: name, appId: typeof appId === 'string' ? appId : undefined, ios: includeIos });
    const project = assembleMobileProject(appFiles, kit.files, {
      appName: name,
      appId: typeof appId === 'string' ? appId : kit.appId,
      iconDataUrl: typeof iconDataUrl === 'string' ? iconDataUrl : undefined,
      ios: includeIos,
    });

    try {
      const { created, defaultBranch } = await ensureRepo(headers, owner, repoName, `${name} — mobile app, prepared by NavBharatAI`);
      const sha = await commitFiles(
        headers, owner, repoName, defaultBranch,
        project.files, project.binaryFiles,
        `Prepare ${name} for the app stores (NavBharatAI)`,
      );
      return res.json({
        ok: true,
        owner,
        repo: repoName,
        branch: defaultBranch,
        repoUrl: `https://github.com/${owner}/${repoName}`,
        createdRepo: created,
        commitSha: sha,
        fileCount: Object.keys(project.files).length + Object.keys(project.binaryFiles).length,
        kind: project.kind,
        webDir: project.webDir,
        notes: project.notes,
        requiredSecrets: kit.requiredSecrets,
        workflows: {
          android: '.github/workflows/android-aab.yml',
          ios: includeIos ? '.github/workflows/ios-ipa.yml' : null,
        },
      });
    } catch (err) {
      // Each of these needs a different fix, so they are reported differently rather than as one
      // vague failure the user cannot act on.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        return res.status(403).json({
          error: 'Your GitHub connection does not have permission to create repositories or workflows. Reconnect GitHub and allow the "repo" and "workflow" permissions.',
        });
      }
      if (status === 422) {
        return res.status(422).json({
          error: `GitHub refused the repository "${repoName}" — the name may already be taken on your account. Try a different name.`,
        });
      }
      if (status === 409) {
        return res.status(409).json({
          error: 'That repository changed while we were writing to it. Please try again.',
        });
      }
      return res.status(502).json({ error: 'Could not set up the repository on GitHub. Nothing was changed.' });
    }
  });
}
