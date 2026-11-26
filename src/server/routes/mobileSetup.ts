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
import { sessionWorkspaceId } from '../lib/workspaceEdit';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { parseWwwManifest, WWW_MANIFEST_PATH } from '../lib/mobileProjectAssembler';
// One repository-write implementation, shared with the self-healing build loop so the two can never
// drift apart on branch handling, blob encoding or ref updates (rule 4).
import { commitFiles, ensureRepo, githubApiHeaders, readRepoFiles, type GhHeaders } from '../lib/githubRepoWrite';
import { githubTokenFromRequest } from '../lib/mobileShipAuth';
import { SHIP_WORKFLOWS, workflowPath } from '../../lib/shipWorkflows';
// COMPILE PRE-FLIGHT, THE APP'S OWN BUILD, AND THE ASSEMBLY (2026-08-04 → 2026-09-22): the app is
// verified, healed, built in its own sandbox and assembled BEFORE anything is pushed, so GitHub only ever
// receives an app already proven to compile. Since 2026-11-25 that whole preparation is ONE shared
// function, so the Native Cloud Build prepares an app exactly the way this route does.
import { loadAppFilesForShip, prepareMobileProject } from '../lib/mobileBuild/prepareMobileProject';
import { githubBuildEnabled } from '../lib/mobileBuild/providerRegistry';
import { recordShip } from '../lib/mobileBuildOutcomeStore';
import { normalizeRepairTier } from '../lib/mobileBuildAiRepair';
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
    if (!githubBuildEnabled()) {
      return res.status(503).json({ error: 'GitHub builds are switched off right now. Use NavBharatAI Native Cloud Build instead.', code: 'provider-disabled' });
    }

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

    // Read the app — the same load (and the same empty-app refusal) the Native Cloud Build uses.
    const loaded = await loadAppFilesForShip(workspaceId);
    if (!loaded.ok) return res.status(loaded.status).json(loaded.body);

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

    // ── Everything GitHub-independent, in ONE shared preparation (2026-11-25) ──
    //
    // The compile pre-flight and its heal, the no-screens refusal, the app's own production build, the
    // ship kit, the app's images, the logo, the assembly and the missing-asset / missing-page refusals
    // all moved VERBATIM into `prepareMobileProject` so the Native Cloud Build gets the same guarantees
    // from the same code. Every refusal keeps the status and body this route always sent.
    const includeIos = ios !== false;
    const prepared = await prepareMobileProject({
      workspaceId,
      appFiles: loaded.files,
      appName: name,
      appId: typeof appId === 'string' ? appId : undefined,
      iconDataUrl: typeof iconDataUrl === 'string' ? iconDataUrl : undefined,
      backgroundColor: typeof backgroundColor === 'string' ? backgroundColor : undefined,
      ios: includeIos,
      repairTier,
    });
    if (!prepared.ok) return res.status(prepared.status).json(prepared.body);
    const { project, kit, prebuild } = prepared;
    const preflight = { notes: prepared.preflightNotes };

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
