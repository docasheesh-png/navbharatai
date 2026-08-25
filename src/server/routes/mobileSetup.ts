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
import { loadWorkspaceAssetsWithCompleteness } from '../AgentV3/WorkspaceAssetStore';
import { findMissingImportedAssets, missingAssetUserMessage } from '../AgentV3/missingAssetCheck';
import { sessionWorkspaceId } from '../lib/workspaceEdit';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { generateShipKit } from '../lib/mobileShipKit';
import { assembleMobileProject, capacitorMajorFromFiles } from '../lib/mobileProjectAssembler';
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
import { apkRefusalForProject } from '../lib/frameworkCapability';

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

    /**
     * 🔒 IS THERE ANYTHING FOR AN APP TO SHOW? (admin 2026-08-24, the 24-framework sweep.)
     *
     * Nine of the twenty-four frameworks in the picker — Express, Hono, NestJS, Fastify, FastAPI,
     * Flask, Spring Boot, Go, Django — build a server that answers with JSON. They have no screens.
     * Packaged into Capacitor they produce an APK that installs, opens, and shows a blank page: a file
     * was created, and it is useless to whoever installs it. That is the fake success rule 2 forbids,
     * and it is worse here than elsewhere because the artefact reaches somebody's phone.
     *
     * Refused BEFORE the GitHub repo is created, so a project that cannot become an app does not leave
     * a half-prepared repository behind for the user to clean up.
     *
     * Refuses only on POSITIVE evidence — any screen at all, or any shape the classifier cannot call a
     * server, proceeds exactly as before. See apkRefusalForProject.
     */
    const noUi = apkRefusalForProject(appFiles);
    if (noUi) return res.status(422).json({ error: noUi, code: 'no-ui' });

    const includeIos = ios !== false;
    // Pin the Android JDK to what THIS app's Capacitor major needs (read from its package.json), so the
    // workflow's Java and the app's Capacitor can never disagree (G2). Null → the governed default.
    const capacitorMajor = capacitorMajorFromFiles(appFiles) ?? undefined;
    const kit = generateShipKit({ appName: name, appId: typeof appId === 'string' ? appId : undefined, ios: includeIos, capacitorMajor });
    // THE APP'S OWN IMAGES AND FONTS (2026-08-16). `loadWorkspaceFiles` is text-only by design, so
    // without this the pushed repo had `import logo from './logo.png'` and no `logo.png` — a broken
    // image on a static app, and on a BUILT app a hard "Could not resolve ./logo.png" from Vite, which
    // is the failure class behind the admin's blocked APK reports. Best-effort: assets are a durable
    // convenience, and a store hiccup must degrade the app's pictures, never refuse the whole ship.
    // Completeness travels with the assets: an empty map from a FAILED read must not be reported to
    // the user as "your app is missing these files" — see the note in mobileProjectAssembler.
    const assetLoad = await loadWorkspaceAssetsWithCompleteness(workspaceId)
      .catch(() => ({ assets: {} as Record<string, string>, complete: false }));
    const appAssets = assetLoad.assets;
    const project = assembleMobileProject(appFiles, kit.files, {
      appName: name,
      appId: typeof appId === 'string' ? appId : kit.appId,
      iconDataUrl: typeof iconDataUrl === 'string' ? iconDataUrl : undefined,
      backgroundColor: typeof backgroundColor === 'string' ? backgroundColor : undefined,
      ios: includeIos,
      appAssets,
      appAssetsComplete: assetLoad.complete,
    });

    /**
     * 🔒 DOES THE APP IMPORT A PICTURE THE REPO WILL NOT HAVE? (admin report 2026-08-25.)
     *
     * A real APK build failed on the runner with "Could not load …/attached_assets/772B17C5-….png
     * (imported by client/src/pages/login.tsx)". The app previewed fine — the image exists in the
     * sandbox — but the durable asset store silently drops anything over its Firestore size cap, which
     * a phone screenshot passes easily, so the pushed repo imported a file it did not contain.
     *
     * Refused HERE for the same reason the compile pre-flight above is: found on the runner it costs
     * the user five minutes, a log they cannot act on, and no idea what to do next. Found here it is
     * one sentence naming the picture and the screen that uses it.
     *
     * Checked AFTER the heal, so a repair that removed the import clears the block by itself.
     */
    const missingAssets = findMissingImportedAssets(appFiles, Object.keys(appAssets));
    if (missingAssets.length > 0) {
      return res.status(422).json({
        error: missingAssetUserMessage(missingAssets),
        code: 'missing-assets',
        missingAssets: missingAssets.slice(0, 10),
      });
    }

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
