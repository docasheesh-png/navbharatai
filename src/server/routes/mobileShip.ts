// Ship-to-stores routes — turn a user's generated app into a REAL signed .aab / .ipa via GitHub Actions.
//
// See src/server/lib/mobileShipKit.ts for WHY this is the architecture: a browser and our Linux server
// physically cannot compile or sign a mobile binary (and iOS legally requires macOS), so the honest path
// is to generate a working CI pipeline into the user's own repo and let GitHub's real Linux + macOS
// runners produce the genuine artifacts. These routes are the thin transport around that.
//
// The push itself deliberately reuses the existing POST /api/github/push (one push implementation, no
// drift — rule 4); this module only GENERATES the kit and DISPATCHES the workflow.

import type { Express, Request, Response } from 'express';
import axios from 'axios';
import { generateShipKit } from '../lib/mobileShipKit';
import { getAllPublishGuides, getPublishGuide, renderPublishGuideText, type StorePlatform } from '../lib/storePublishGuide';
// ONE declaration of which header carries the GitHub token — this module used to read the Authorization
// header, which carries the FIREBASE token, so every call here reached GitHub with the wrong credential
// and came back 401. See lib/mobileShipAuth.ts for the full autopsy.
import { githubTokenFromRequest } from '../lib/mobileShipAuth';
// ONE declaration of which workflows exist — this module used to hold its own hand-written list, which
// never learned about the APK workflow, so "Build my APK now" was rejected with 400 before it could run.
import { SHIP_WORKFLOW_FILES, isShipWorkflow, workflowPath, type ShipWorkflowFile } from '../../lib/shipWorkflows';
import { classifyBuildFailure, failedStepSection, normalizeLog, repairFiles } from '../lib/mobileBuildRepair';
// Tier 2 of the self-healing loop: when the deterministic rules cannot name or fix the failure, the AI
// pass reads the failing step and the files involved and writes the fix itself — the same loop Claude
// Code runs, which is exactly what the admin asked for ("jo claude code karta hai, woh navbharatai
// nahi kar sakta kya?", 2026-08-03). See mobileBuildAiRepair.ts for the full safety model.
import {
  aiRepairAllowedPaths, aiRepairEnabled, aiRepairModelChain, runAiRepair,
} from '../lib/mobileBuildAiRepair';
import { callRepairModel } from '../lib/mobileBuildAiRepairClient';
import { commitFiles, githubApiHeaders, readRepoFiles } from '../lib/githubRepoWrite';
import { buildPackageJson, detectProjectKind } from '../lib/mobileProjectAssembler';

const githubToken = githubTokenFromRequest;

/** A repo slug must look like `owner/name` with GitHub's own character rules — never interpolate blindly. */
export function isValidRepoRef(owner: unknown, repo: unknown): boolean {
  const ok = (s: unknown): boolean => typeof s === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(s);
  return ok(owner) && ok(repo);
}

/**
 * Only the workflows this feature GENERATES may be dispatched — never an arbitrary caller-supplied file.
 *
 * Derived from the shared registry rather than re-typed: the previous hand-written copy listed only the
 * .aab and .ipa workflows, so the .apk workflow the kit had started generating was permanently
 * un-runnable. A test now asserts this list equals what the kit actually writes.
 */
export const DISPATCHABLE_WORKFLOWS: readonly ShipWorkflowFile[] = SHIP_WORKFLOW_FILES;
export function isDispatchableWorkflow(file: unknown): file is ShipWorkflowFile {
  return isShipWorkflow(file);
}

// Artifact fetching/unwrapping moved to lib/buildArtifact when the Nav App Store needed the SAME
// bytes. Re-exported here so existing importers and tests are untouched — one implementation, no
// second copy to drift (this repo has already paid for that with four copies of one path helper).
export { isValidArtifactId, pickBinaryName } from '../lib/buildArtifact';
import { fetchBuildArtifact, isValidArtifactId, type ArtifactFetcher } from '../lib/buildArtifact';

/** The real HTTP call, kept at the edge so the fetching logic itself stays testable without a network. */
const githubZipFetcher: ArtifactFetcher = async (url, token) => {
  const r = await axios.get(url, {
    headers: { Authorization: `token ${token}` }, responseType: 'arraybuffer', maxRedirects: 5,
  });
  return { status: r.status, data: r.data as ArrayBuffer };
};

/** JSZip is imported lazily — it is only needed on the download path. */
const jsZipLoader = async (buf: Buffer) => {
  const JSZip = (await import('jszip')).default;
  return await JSZip.loadAsync(buf) as unknown as { files: Record<string, { async: (t: 'nodebuffer') => Promise<Buffer> }> };
};

export function registerMobileShipRoutes(app: Express): void {
  /** The step-by-step, non-technical publishing walkthrough (pure data — also feeds the AIs). */
  app.get('/api/mobile-ship/guide', (req: Request, res: Response) => {
    const p = String(req.query.platform || '');
    if (p === 'android' || p === 'ios') {
      res.json({ guide: getPublishGuide(p as StorePlatform), text: renderPublishGuideText(p as StorePlatform) });
      return;
    }
    res.json({ guides: getAllPublishGuides() });
  });

  /**
   * Recent builds for a generated workflow, so the user sees progress inside NavBharatAI instead of
   * being sent off to hunt through GitHub's Actions tab.
   */
  app.get('/api/mobile-ship/runs', async (req: Request, res: Response) => {
    const token = githubToken(req);
    if (!token) return res.status(401).json({ error: 'Connect GitHub first — no access token was sent.' });
    const { owner, repo, workflow } = req.query as Record<string, string>;
    if (!isValidRepoRef(owner, repo)) return res.status(400).json({ error: 'A valid GitHub owner and repository name are required.' });
    if (!isDispatchableWorkflow(workflow)) return res.status(400).json({ error: 'Unknown build workflow.' });

    try {
      const r = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?per_page=5`,
        { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } },
      );
      const runs = (r.data?.workflow_runs || []).map((w: Record<string, unknown>) => ({
        id: w.id,
        status: w.status,          // queued | in_progress | completed
        conclusion: w.conclusion,  // success | failure | cancelled | null
        createdAt: w.created_at,
        url: w.html_url,
      }));
      res.json({ runs });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status || 502;
      res.status(status === 404 ? 404 : 502).json({
        error: status === 404
          ? 'No builds yet — push the build kit to GitHub and start a build first.'
          : 'Could not read the build status from GitHub.',
      });
    }
  });

  /** The downloadable files a finished build produced. */
  app.get('/api/mobile-ship/artifacts', async (req: Request, res: Response) => {
    const token = githubToken(req);
    if (!token) return res.status(401).json({ error: 'Connect GitHub first — no access token was sent.' });
    const { owner, repo, runId } = req.query as Record<string, string>;
    if (!isValidRepoRef(owner, repo)) return res.status(400).json({ error: 'A valid GitHub owner and repository name are required.' });
    if (!/^\d{1,20}$/.test(String(runId || ''))) return res.status(400).json({ error: 'A valid build id is required.' });

    try {
      const r = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`,
        { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } },
      );
      const artifacts = (r.data?.artifacts || [])
        .filter((a: Record<string, unknown>) => !a.expired)
        .map((a: Record<string, unknown>) => ({ id: a.id, name: a.name, sizeBytes: a.size_in_bytes }));
      res.json({ artifacts });
    } catch {
      res.status(502).json({ error: 'Could not read the build files from GitHub.' });
    }
  });

  /**
   * Stream the finished app straight to the user — the "download the .aab/.apk right here" step.
   *
   * GitHub wraps every artifact in a zip, so we unwrap it and serve the real binary: a non-technical
   * user should get `app-release.aab`, not an archive they then have to figure out how to open.
   */
  app.get('/api/mobile-ship/download', async (req: Request, res: Response) => {
    const token = githubToken(req);
    if (!token) return res.status(401).json({ error: 'Connect GitHub first — no access token was sent.' });
    const { owner, repo, artifactId } = req.query as Record<string, string>;
    if (!isValidRepoRef(owner, repo)) return res.status(400).json({ error: 'A valid GitHub owner and repository name are required.' });
    if (!isValidArtifactId(artifactId)) return res.status(400).json({ error: 'A valid file id is required.' });

    const got = await fetchBuildArtifact({ owner, repo, artifactId, token }, githubZipFetcher, jsZipLoader);
    if (!got.ok) {
      const status = got.failure === 'expired' ? 404 : got.failure === 'not-app' ? 422 : got.failure === 'bad-request' ? 400 : 502;
      return res.status(status).json({ error: got.message });
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${got.fileName}"`);
    res.send(got.bytes);
  });

  /**
   * Generate the ship kit (pure — no network, no GitHub needed). The caller then pushes `files` with
   * POST /api/github/push and follows `requiredSecrets` / SHIPPING.md.
   */
  app.post('/api/mobile-ship/kit', (req: Request, res: Response) => {
    const { appName, appId, webDir, ios } = (req.body || {}) as Record<string, unknown>;
    try {
      const kit = generateShipKit({
        appName: typeof appName === 'string' ? appName : undefined,
        appId: typeof appId === 'string' ? appId : undefined,
        webDir: typeof webDir === 'string' ? webDir : undefined,
        ios: ios !== false,
      });
      res.json(kit);
    } catch (e) {
      res.status(500).json({ error: (e as { message?: string })?.message || 'Could not generate the ship kit' });
    }
  });

  /**
   * Dispatch a generated workflow on the user's repo — the "press Build for me" step, so the user never
   * has to hunt through the Actions tab.
   *
   * HONEST FAILURE MODES, surfaced as-is rather than smoothed over, because each needs a different fix:
   *   • 401/403 → the GitHub token lacks the `workflow` scope (or repo access)
   *   • 404     → the workflow file is not on that branch yet (push the kit first)
   *   • 422     → the workflow exists but has no `workflow_dispatch` trigger on that ref
   */
  app.post('/api/mobile-ship/trigger', async (req: Request, res: Response) => {
    const token = githubToken(req);
    if (!token) return res.status(401).json({ error: 'Connect GitHub first — no access token was sent.' });

    const { owner, repo, workflow, ref = 'main', inputs } = (req.body || {}) as Record<string, unknown>;
    if (!isValidRepoRef(owner, repo)) return res.status(400).json({ error: 'A valid GitHub owner and repository name are required.' });
    if (!isDispatchableWorkflow(workflow)) {
      return res.status(400).json({ error: `Only the generated build workflows can be started (${DISPATCHABLE_WORKFLOWS.join(', ')}).` });
    }
    if (typeof ref !== 'string' || !ref.trim()) return res.status(400).json({ error: 'A branch name is required.' });

    try {
      await axios.post(
        `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
        { ref, ...(inputs && typeof inputs === 'object' ? { inputs } : {}) },
        { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } },
      );
      // 204 No Content on success — GitHub does not return the run, so point the user at the Actions tab.
      res.json({ ok: true, actionsUrl: `https://github.com/${owner}/${repo}/actions/workflows/${workflow}` });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status || 500;
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const hint =
        status === 404 ? 'Workflow not found on that branch — push the ship kit to GitHub first.'
        : status === 403 || status === 401 ? 'GitHub refused the request — reconnect GitHub so the token includes the "workflow" permission.'
        : status === 422 ? 'GitHub could not start this workflow on that branch. Make sure the pushed workflow is on the branch you selected.'
        : 'Could not start the build on GitHub.';
      res.status(status === 500 ? 502 : status).json({ error: hint, detail: detail || undefined });
    }
  });

  /**
   * SELF-HEALING BUILD — read why a run failed, repair what NavBharatAI generated, and start it again.
   *
   * WHY (admin 2026-08-03, verbatim): "fail ho to v5 dekh ke fix kare, wapas apne aap build workflow
   * chale, sab kuch apne aap ho, tab tak user ko bas loading % show ho". A non-technical user cannot read
   * a Gradle stack trace, and "open the run on GitHub" hands them our problem.
   *
   * WHAT IT WILL AND WILL NOT TOUCH — this boundary is the whole safety model:
   *   • REPAIRS the files NavBharatAI itself wrote (the workflow, capacitor.config.ts, the package.json
   *     wrapper). Fixing those is fixing our own output.
   *   • NEVER rewrites the user's app source, and NEVER invents a signing key. A key is the app's
   *     permanent Play Store identity; the honest answer there is to say what to add.
   *   • NEVER commits when the repair changes nothing — that is what stops an endless fix/rebuild loop.
   * Every repair lands as a real, named commit in the user's own repository, so nothing happens
   * invisibly and anything can be reverted.
   */
  app.post('/api/mobile-ship/autofix', async (req: Request, res: Response) => {
    const token = githubToken(req);
    if (!token) return res.status(401).json({ error: 'Connect GitHub first — no access token was sent.' });

    const { owner, repo, workflow, runId, ref = 'main' } = (req.body || {}) as Record<string, unknown>;
    if (!isValidRepoRef(owner, repo)) return res.status(400).json({ error: 'A valid GitHub owner and repository name are required.' });
    if (!isDispatchableWorkflow(workflow)) return res.status(400).json({ error: 'Unknown build workflow.' });
    if (!/^\d{1,20}$/.test(String(runId || ''))) return res.status(400).json({ error: 'A valid build id is required.' });
    if (typeof ref !== 'string' || !ref.trim()) return res.status(400).json({ error: 'A branch name is required.' });

    const headers = githubApiHeaders(token);
    const wfPath = workflowPath(workflow);

    let log: string;
    try {
      log = await failedJobLog(headers, String(owner), String(repo), String(runId));
    } catch {
      return res.status(502).json({ error: 'Could not read why the build stopped.' });
    }
    if (!log.trim()) {
      return res.json({ fixed: false, code: 'UNKNOWN', summary: 'The build stopped without leaving a reason NavBharatAI could read.' });
    }

    const diag = classifyBuildFailure(log, wfPath);

    // The ONE failure that is genuinely the user's to resolve. Their signing key is their permanent
    // Play Store identity — neither tier may create or work around it.
    if (diag.code === 'MISSING_SIGNING_SECRET') {
      return res.json({ fixed: false, code: diag.code, summary: diag.summary, detail: diag.detail });
    }

    /** Apply a fix: one named commit in the user's repository, then start the build again. */
    const commitAndRerun = async (files: Record<string, string>, message: string): Promise<void> => {
      await commitFiles(headers, String(owner), String(repo), ref, files, {}, message);
      await axios.post(
        `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
        { ref },
        { headers },
      );
    };

    /**
     * Tier 2 — the AI pass. Runs when the rules could not name the failure OR named it but had nothing
     * left to change. It sees the FAILING STEP's log and the files involved (including the app source
     * files the error names — the app was generated by NavBharatAI, so repairing it is repairing our
     * own output), and its reply is only accepted inside the hard validation gates in
     * mobileBuildAiRepair.ts. Model chain: flagship cheap coders only, never Sonnet/Opus.
     */
    const tryAiRepair = async (): Promise<boolean> => {
      if (!aiRepairEnabled()) return false;
      const chain = aiRepairModelChain();
      if (chain.length === 0) return false;
      const failingStep = failedStepSection(normalizeLog(log));
      const allowed = aiRepairAllowedPaths(wfPath, failingStep);
      const aiFiles = await readRepoFiles(headers, String(owner), String(repo), ref, allowed);
      if (Object.keys(aiFiles).length === 0) return false;
      const result = await runAiRepair(callRepairModel, chain, {
        log: failingStep,
        files: aiFiles,
        ruleSummary: diag.summary,
      });
      if (!result || !('files' in result)) return false;
      await commitAndRerun(result.files, 'NavBharatAI: repair the build failure and run it again');
      res.json({
        fixed: true,
        fixedBy: 'ai',
        code: diag.code,
        summary: result.explanation,
        changed: Object.keys(result.files),
      });
      return true;
    };

    try {
      if (!diag.autoFixable) {
        // The rules cannot fix this class — the AI pass is exactly for this case.
        if (await tryAiRepair()) return;
        return res.json({ fixed: false, code: diag.code, summary: diag.summary, detail: diag.detail });
      }

      const current = await readRepoFiles(headers, String(owner), String(repo), ref, diag.needs);
      // What NavBharatAI would generate for this repository TODAY. A repo prepared before a fix shipped
      // still carries the old files, so refreshing our own output is often the whole repair — and it
      // heals every already-pushed repo at once instead of one pattern at a time.
      //
      // package.json is regenerated through the SAME merge the setup route uses, which preserves every
      // dependency the user's app declares and only corrects what NavBharatAI owns (the Capacitor
      // packages, which must share one major version, and the build script). appName only affects
      // comments and summary text, so the repository's own name is a perfectly good source.
      const currentPkg = current['package.json'];
      const repair = repairFiles(diag, current, wfPath, {
        workflow: generateShipKit({ appName: String(repo) }).files[wfPath],
        packageJson: currentPkg
          ? buildPackageJson(currentPkg, String(repo), detectProjectKind({ 'package.json': currentPkg }))
          : undefined,
      });
      // The rules named the class but everything they would write is already in place — the cause is
      // something they have not actually understood. That used to be the end ("could not fix"); now it
      // is the AI pass's turn, and only if THAT also misses is the honest failure reported.
      if (!repair || Object.keys(repair.files).length === 0) {
        if (await tryAiRepair()) return;
        return res.json({
          fixed: false,
          code: diag.code,
          summary: `${diag.summary} NavBharatAI could not correct it automatically.`,
        });
      }
      await commitAndRerun(repair.files, repair.message);
      return res.json({
        fixed: true,
        fixedBy: 'rules',
        code: diag.code,
        summary: diag.summary,
        changed: Object.keys(repair.files),
        commitMessage: repair.message,
      });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      return res.status(status === 403 || status === 401 ? 403 : 502).json({
        error: status === 403 || status === 401
          ? 'GitHub would not let NavBharatAI update the build files. Reconnect GitHub and allow the "workflow" permission.'
          : 'Could not apply the fix on GitHub. Nothing was changed.',
      });
    }
  });

  /**
   * The raw failure text of a run, for the admin diagnostics view.
   *
   * Deliberately NOT what the panel shows a user: a build log names providers, machines and internal
   * paths, so a user sees NavBharatAI's own plain-language summary from /autofix instead.
   */
  app.get('/api/mobile-ship/logs', async (req: Request, res: Response) => {
    const token = githubToken(req);
    if (!token) return res.status(401).json({ error: 'Connect GitHub first — no access token was sent.' });
    const { owner, repo, runId, workflow } = req.query as Record<string, string>;
    if (!isValidRepoRef(owner, repo)) return res.status(400).json({ error: 'A valid GitHub owner and repository name are required.' });
    if (!/^\d{1,20}$/.test(String(runId || ''))) return res.status(400).json({ error: 'A valid build id is required.' });

    try {
      const log = await failedJobLog(githubApiHeaders(token), owner, repo, runId);
      const diag = classifyBuildFailure(log, workflowPath(isShipWorkflow(workflow) ? workflow : SHIP_WORKFLOW_FILES[0]));
      // Bounded on purpose: a Gradle log runs to megabytes and the cause is always at the end.
      res.json({ diagnosis: diag, log: normalizeLog(log).slice(-20000) });
    } catch {
      res.status(502).json({ error: 'Could not read the build log from GitHub.' });
    }
  });
}

/**
 * The log text of the step that actually failed.
 *
 * A run has several jobs and only one of them broke; concatenating all of them would bury the real cause
 * under thousands of lines of successful output and let the classifier match the wrong pattern.
 */
async function failedJobLog(
  headers: Record<string, string>,
  owner: string,
  repo: string,
  runId: string,
): Promise<string> {
  const jobsRes = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=20`,
    { headers },
  );
  const jobs = (jobsRes.data?.jobs || []) as Array<{ id: number; conclusion: string | null }>;
  const failed = jobs.filter((j) => j.conclusion && j.conclusion !== 'success' && j.conclusion !== 'skipped');
  const parts: string[] = [];
  for (const job of failed.slice(0, 3)) {
    try {
      const logRes = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`,
        { headers, responseType: 'text', maxRedirects: 5, transformResponse: [(d) => d] },
      );
      if (typeof logRes.data === 'string') parts.push(logRes.data);
    } catch {
      // One unreadable job must not hide the others.
    }
  }
  return parts.join('\n');
}
