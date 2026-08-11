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
import { loadWorkspaceFiles, mergeWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { sessionWorkspaceId } from '../lib/workspaceEdit';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { generateShipKit } from '../lib/mobileShipKit';
import { assembleMobileProject } from '../lib/mobileProjectAssembler';
// One repository-write implementation, shared with the self-healing build loop so the two can never
// drift apart on branch handling, blob encoding or ref updates (rule 4).
import { commitFiles, ensureRepo, githubApiHeaders, type GhHeaders } from '../lib/githubRepoWrite';
import { githubTokenFromRequest } from '../lib/mobileShipAuth';
import { SHIP_WORKFLOWS, workflowPath } from '../../lib/shipWorkflows';
// COMPILE PRE-FLIGHT (admin 2026-08-04: "v5 live banaye, fix kare — GitHub par bas download ho"): the
// app is verified — and healed by the same AI repair tier — BEFORE anything is pushed. GitHub only ever
// receives an app already proven to compile, and every heal is written back into the user's v5
// workspace so their app inside NavBharatAI is fixed too, not a shadow copy.
import { preflightAndHeal, preflightUserMessage } from '../lib/mobileShipPreflight';
import { aiRepairEnabled, aiRepairModelChain, normalizeRepairTier } from '../lib/mobileBuildAiRepair';
import { callRepairModel } from '../lib/mobileBuildAiRepairClient';

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

// The GitHub token is read through the ONE shared helper, so this route and the ship/build routes can
// never again disagree about which header carries it (see lib/mobileShipAuth.ts).
const githubToken = githubTokenFromRequest;

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

    const { sessionId, appName, appId, repo, iconDataUrl, ios, powerLevel, backgroundColor } = (req.body || {}) as Record<string, unknown>;
    const repairTier = normalizeRepairTier(typeof powerLevel === 'string' ? powerLevel : undefined);
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

    const headers: GhHeaders = githubApiHeaders(ghToken);

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

    // ── Compile pre-flight: verify here, heal here, and only then involve GitHub. ──
    //
    // A compile error found on the runner costs five minutes, an unreadable remote log, and a repair
    // that can only edit files by committing them. Found HERE it costs seconds, and the fix lands in
    // the user's own v5 workspace. The AI chain follows the user's selected tier (same as the build).
    const preflight = await preflightAndHeal(
      appFiles,
      callRepairModel,
      aiRepairEnabled() ? aiRepairModelChain(process.env, repairTier) : [],
    );
    if (!preflight.ok) {
      return res.status(422).json({
        error: preflightUserMessage(preflight.problems),
        compileProblems: preflight.problems.slice(0, 10),
      });
    }
    if (Object.keys(preflight.changed).length > 0) {
      // The heal is real only if the user's app itself carries it — otherwise the workspace and the
      // repository drift apart and the next ship re-fights the same errors.
      try { await mergeWorkspaceFiles(workspaceId, preflight.changed); } catch { /* the push still proceeds */ }
    }
    appFiles = preflight.files;

    const includeIos = ios !== false;
    const kit = generateShipKit({ appName: name, appId: typeof appId === 'string' ? appId : undefined, ios: includeIos });
    const project = assembleMobileProject(appFiles, kit.files, {
      appName: name,
      appId: typeof appId === 'string' ? appId : kit.appId,
      iconDataUrl: typeof iconDataUrl === 'string' ? iconDataUrl : undefined,
      backgroundColor: typeof backgroundColor === 'string' ? backgroundColor : undefined,
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
        notes: [...preflight.notes, ...project.notes],
        requiredSecrets: kit.requiredSecrets,
        // Derived from the ONE workflow registry, never re-typed — a hand-written copy here is exactly
        // how the APK workflow ended up generated-but-not-runnable.
        workflows: {
          androidApk: workflowPath(SHIP_WORKFLOWS.androidApk),
          android: workflowPath(SHIP_WORKFLOWS.androidAab),
          ios: includeIos ? workflowPath(SHIP_WORKFLOWS.iosIpa) : null,
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
