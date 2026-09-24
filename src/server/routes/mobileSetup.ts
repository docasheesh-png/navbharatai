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
//   The user    : keeps their keystore and Apple credentials, as GitHub secrets we never see.
//
// ⚠️ ONE CLAUSE OF THAT LINE WAS CORRECTED ON 2026-09-15, and the original is kept in view because its
// reasoning held for years: "A signing key IS the app's permanent identity — if we held it and lost it,
// their app could never be updated again." True of the APP SIGNING key. NOT true of the UPLOAD key,
// which is the only one a developer holds under Play App Signing (mandatory for the .aab format):
// Google holds the app signing key and can RESET a lost upload key.
// So `/api/mobile-ship/signing-setup` will now CREATE the upload key on request and seal it into the
// user's OWN repository — removing the JDK / keytool / base64 / four-pasted-secrets wall that is where
// most people stopped. NavBharatAI still keeps no copy, which is the half of the old rule that stands.

import type { Express, Request, Response } from 'express';
import axios from 'axios';
import { loadWorkspaceFiles, mergeWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { loadWorkspaceAssetsWithCompleteness } from '../AgentV3/WorkspaceAssetStore';
import { findMissingImportedAssets, missingAssetUserMessage } from '../AgentV3/missingAssetCheck';
import { sessionWorkspaceId } from '../lib/workspaceEdit';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { generateShipKit } from '../lib/mobileShipKit';
import { assembleMobileProject, capacitorMajorFromFiles, missingWebPageRefusal, parseWwwManifest, WWW_MANIFEST_PATH } from '../lib/mobileProjectAssembler';
// One repository-write implementation, shared with the self-healing build loop so the two can never
// drift apart on branch handling, blob encoding or ref updates (rule 4).
import { commitFiles, ensureRepo, githubApiHeaders, readRepoFiles, type GhHeaders } from '../lib/githubRepoWrite';
import { githubTokenFromRequest } from '../lib/mobileShipAuth';
import { SHIP_WORKFLOWS, workflowPath } from '../../lib/shipWorkflows';
// COMPILE PRE-FLIGHT (admin 2026-08-04: "v5 live banaye, fix kare — GitHub par bas download ho"): the
// app is verified — and healed by the same AI repair tier — BEFORE anything is pushed. GitHub only ever
// receives an app already proven to compile, and every heal is written back into the user's v5
// workspace so their app inside NavBharatAI is fixed too, not a shadow copy.
import { preflightAndHeal, preflightUserMessage } from '../lib/mobileShipPreflight';
// The app's OWN build, run in the warm sandbox before GitHub ever sees it (2026-09-22).
import { runRealBuildCheck, type RealBuildVerdict } from '../lib/mobileShipRealBuild';
// THE APP IS BUILT HERE; GITHUB ONLY PACKAGES IT (2026-09-22, "toote hi na"): the production build runs
// in the app's own sandbox and its output ships as `www/`, so the runner never compiles the app.
import { prebuildForShip, type PrebuiltOutcome } from '../lib/mobileShipPrebuilt';
import { recordShip } from '../lib/mobileBuildOutcomeStore';
import { buildActuator } from './actuatorFactory';
import { aiRepairEnabled, aiRepairModelChain, normalizeRepairTier } from '../lib/mobileBuildAiRepair';
import { callRepairModel } from '../lib/mobileBuildAiRepairClient';
import { apkRefusalForProject } from '../lib/frameworkCapability';
// ONE implementation of "make sure this repository can sign a Play bundle", shared with the
// /signing-setup route so the two can never drift on what counts as already-set-up (rule 2).
import { ensureUploadKeystore, type EnsureSigningResult } from '../lib/androidSigningSetup';

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

/** Workspaces with a prepare in flight on THIS instance — see the 409 in the route. */
const PREPARING = new Set<string>();

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

    // ONE prepare per app at a time. The panel disables its button, but a second tab, a retried request
    // after a network drop, or an older client can send a second setup while the first is still building
    // in the app's machine — and two builds racing in one sandbox read each other's half-written output.
    if (PREPARING.has(workspaceId)) {
      return res.status(409).json({ error: 'This app is already being prepared — give it a moment and try again.', code: 'already-preparing' });
    }
    PREPARING.add(workspaceId);
    const release = (): void => { PREPARING.delete(workspaceId); };
    if (typeof res.once === 'function') {
      res.once('finish', release);
      res.once('close', release);
    } else {
      release(); // a response with no lifecycle events (a test double) cannot hold a lock
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
     * 🔴 AND NOW THE BUILD GITHUB WILL ACTUALLY RUN (2026-09-22).
     *
     * The three checks above are STATIC — parse, resolve, declare. The thing that really decides a
     * phone build is the app's OWN `npm run build`, and until now its first execution anywhere was
     * five minutes into a GitHub run that costs one of the user's three repair attempts. The app is
     * already alive in a sandbox with its dependencies installed, so the same question is asked in the
     * cheap place instead of the expensive one.
     *
     * 🔒 It NEVER starts a machine, it is bounded, and it is not stricter than the runner — see
     * `mobileShipRealBuild.ts`. A skip means the ship proceeds exactly as it did before this existed.
     */
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
     * a half-prepared repository behind for the user to clean up — and BEFORE the production build
     * below, so a server-only project never wakes a machine to be refused with the wrong reason.
     *
     * Refuses only on POSITIVE evidence — any screen at all, or any shape the classifier cannot call a
     * server, proceeds exactly as before. See apkRefusalForProject.
     */
    const noUi = apkRefusalForProject(appFiles);
    if (noUi) return res.status(422).json({ error: noUi, code: 'no-ui' });

    /**
     * 🔴 AND NOW THE APP IS BUILT HERE, AND GITHUB ONLY PACKAGES IT (2026-09-22, admin: *"toote hi na"
     * wala banao*). The check above asks "would the runner's build fail?" — this goes one step further
     * and RUNS the production build the runner would have run, in the app's own sandbox, and ships its
     * output as `www/` with the honest no-op build script. The runner then compiles nothing, so the
     * step that most phone builds died in does not exist for that repository.
     *
     * Every outcome but two is a fall-through to the source ship below, exactly as before this existed.
     * The two: a BUILT app (shipped prebuilt), and a build that FAILED here in a way the runner would
     * fail too — refused with the same 422 the check sends, because the five-minute run to learn the
     * same thing is the cost this removes. Unlike the check, this path MAY wake the app's machine —
     * see `mobileShipPrebuilt.ts` for why that trade is the right one here.
     */
    const prebuild = await prebuildForShip(buildActuator(), workspaceId, appFiles, preflight.changed)
      .catch((): PrebuiltOutcome => ({ kind: 'skip', reason: 'unavailable', buildRan: false }));
    if (prebuild.kind === 'refuse') {
      return res.status(422).json({
        error: `Your app did not compile, so the phone build would have failed too. ${prebuild.summary}`,
        code: 'real-build-failed',
        failureCode: prebuild.code,
        buildLog: prebuild.log.slice(-2000),
      });
    }
    // The check only runs where the prebuild never STARTED a build: a build that ran here — whether it
    // shipped, timed out, or produced nothing readable — is the check's answer, and a second one in the
    // same machine would only double the cost (a timed-out build is still running in there).
    const realBuild: RealBuildVerdict = prebuild.kind === 'skip' && !prebuild.buildRan
      ? await runRealBuildCheck(buildActuator(), workspaceId, appFiles, preflight.changed)
        .catch(() => ({ ran: false as const, reason: 'unavailable' as const }))
      : { ran: false, reason: 'prebuilt' };
    if (realBuild.ran && !realBuild.ok && realBuild.blocking) {
      // The runner would have failed too, with this exact error. Saying so now costs seconds; letting
      // it through costs five minutes, a remote log the user cannot act on, and an attempt they only
      // have three of.
      return res.status(422).json({
        error: `Your app did not compile, so the phone build would have failed too. ${realBuild.summary}`,
        code: 'real-build-failed',
        failureCode: realBuild.code,
        buildLog: realBuild.log.slice(-2000),
      });
    }


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
      prebuilt: prebuild.kind === 'built' ? prebuild.prebuilt : undefined,
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
    // On a prebuilt ship the bundle already resolved every import — the build that produced it would
    // have failed on a missing picture — so this check is the SOURCE ship's, not a second gate.
    const missingAssets = project.prebuilt ? [] : findMissingImportedAssets(appFiles, Object.keys(appAssets));
    if (missingAssets.length > 0) {
      return res.status(422).json({
        error: missingAssetUserMessage(missingAssets),
        code: 'missing-assets',
        missingAssets: missingAssets.slice(0, 10),
      });
    }

    /**
     * 🔒 IS THERE A PAGE TO PUT IN THE APP? (autopsy 2026-09-22, user app `bharat-alpha`.)
     *
     * That run was green for three steps and then died in 24 seconds at the wrapper, because the app
     * had no `index.html` where Capacitor opens one. Nothing was broken on the runner — the build could
     * never have succeeded, and the assembler already knew it: the fact sat in `notes` as advice and
     * was pushed anyway. This turns the fact into the refusal it always was, one sentence naming the
     * file, before a repository is created and before the user waits on a run that cannot finish.
     *
     * Decided ONLY for a static app; a built app's page is made on the runner and is not ours to
     * predict (see `missingWebPageRefusal`).
     */
    const noPage = missingWebPageRefusal(project);
    if (noPage) return res.status(422).json({ error: noPage, code: 'no-web-page' });

    try {
      const { created, defaultBranch } = await ensureRepo(headers, owner, repoName, `${name} — mobile app, prepared by NavBharatAI`);
      // `www/` is OWNED by this push — the build output on a prebuilt ship, the page files on a static
      // one, nothing at all on a built one — so whatever an EARLIER PUSH OF OURS left there and this one
      // does not carry is removed in the same commit. Otherwise a hashed bundle from last week is
      // packaged into the phone app for ever. Only paths the previous push RECORDED (`www/.nbai-shipped`)
      // are candidates: a repository the user already owned may carry a `www/` of its own, and listing
      // the folder and deleting "whatever is not ours now" would delete theirs. No manifest ⇒ nothing.
      const shipped = new Set([...Object.keys(project.files), ...Object.keys(project.binaryFiles)]);
      const previous = created
        ? {}
        : await readRepoFiles(headers, owner, repoName, defaultBranch, [WWW_MANIFEST_PATH]).catch(() => ({} as Record<string, string>));
      const stale = parseWwwManifest(previous[WWW_MANIFEST_PATH]).filter((p) => !shipped.has(p));
      // The old manifest itself goes when this push writes no `www/` at all (a built ship after a static one).
      if (!created && previous[WWW_MANIFEST_PATH] !== undefined && !shipped.has(WWW_MANIFEST_PATH)) stale.push(WWW_MANIFEST_PATH);
      const sha = await commitFiles(
        headers, owner, repoName, defaultBranch,
        project.files, project.binaryFiles,
        `Prepare ${name} for the app stores (NavBharatAI)`,
        stale,
      );
      void recordShip(project.prebuilt ? 'prebuilt' : 'source', prebuild.kind === 'skip' ? prebuild.reason : null);
      // ── THE KEY IS MADE NOW, NOT AFTER A FAILED BUILD (autopsy 2026-09-19) ────────────────────────
      //
      // One-press upload-key creation has existed since 2026-09-15, and the button that offers it only
      // appeared AFTER a Play build had already failed — so every user met a red failure first and the
      // way out second. The repository exists as of the line above and the user owns it (`owner` is
      // this token's own login), so this is the earliest moment the key CAN be created, and it is
      // before any button that needs it can be pressed.
      //
      // 🔒 BEST-EFFORT, AND IT MUST NEVER FAIL THE SETUP. The installable .apk needs no key at all, so
      // a user whose key could not be created still has a working app to try on their phone — failing
      // setup here would take that away to solve a problem they may not even have. An existing key is
      // never touched, and a `partial` one is never completed (see `ensureUploadKeystore`).
      let signing: { state: string; present: readonly string[]; note?: string } = { state: 'blocked', present: [] };
      let newKey: EnsureSigningResult['key'];
      try {
        const outcome = await ensureUploadKeystore(headers, owner, repoName, name);
        signing = { state: outcome.state, present: outcome.present, note: outcome.note };
        newKey = outcome.key;
      } catch {
        signing = { state: 'blocked', present: [], note: 'The signing key could not be set up just now.' };
      }

      return res.json({
        ok: true,
        owner,
        repo: repoName,
        branch: defaultBranch,
        // Whether a Play bundle can be signed, answered at SETUP so nothing downstream has to guess.
        // ⚠️ `keystore` is the ONLY time the key exists outside the user's repository — NavBharatAI
        // keeps no copy — so the client hands it to them to save and must not discard it silently.
        signing,
        keystore: newKey
          ? {
            base64: newKey.base64,
            storePassword: newKey.storePassword,
            keyAlias: newKey.keyAlias,
            sha256Fingerprint: newKey.sha256Fingerprint,
            validUntil: newKey.validUntil,
          }
          : null,
        repoUrl: `https://github.com/${owner}/${repoName}`,
        createdRepo: created,
        commitSha: sha,
        fileCount: Object.keys(project.files).length + Object.keys(project.binaryFiles).length,
        kind: project.kind,
        webDir: project.webDir,
        // True when `www/` is the app's own production build — the runner packages it and compiles nothing.
        prebuilt: project.prebuilt,
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
