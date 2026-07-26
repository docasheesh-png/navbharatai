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

/** Pull the GitHub token off the Authorization header, accepting both `Bearer` and `token` schemes. */
function githubToken(req: Request): string | null {
  const raw = req.headers.authorization;
  if (!raw) return null;
  const t = raw.replace(/^(bearer|token)\s+/i, '').trim();
  return t || null;
}

/** A repo slug must look like `owner/name` with GitHub's own character rules — never interpolate blindly. */
export function isValidRepoRef(owner: unknown, repo: unknown): boolean {
  const ok = (s: unknown): boolean => typeof s === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(s);
  return ok(owner) && ok(repo);
}

/** Only the two workflows this feature generates may be dispatched — never an arbitrary caller-supplied file. */
export const DISPATCHABLE_WORKFLOWS = ['android-aab.yml', 'ios-ipa.yml'] as const;
export function isDispatchableWorkflow(file: unknown): file is (typeof DISPATCHABLE_WORKFLOWS)[number] {
  return typeof file === 'string' && (DISPATCHABLE_WORKFLOWS as readonly string[]).includes(file);
}

/** A GitHub artifact id is numeric — never interpolate a caller-supplied string into the API path. */
export function isValidArtifactId(id: unknown): boolean {
  return (typeof id === 'string' || typeof id === 'number') && /^\d{1,20}$/.test(String(id));
}

/**
 * Pick the real binary out of a GitHub artifact zip. GitHub always wraps artifacts in a zip, but a
 * non-technical user asked for the app file itself — so we unwrap it and hand back the .aab/.apk/.ipa.
 * Returns null when the zip holds nothing app-shaped, so the caller can fail honestly instead of
 * serving a confusing archive.
 */
export function pickBinaryName(names: string[]): string | null {
  const order = ['.aab', '.apk', '.ipa'];
  for (const ext of order) {
    const hit = names.find((n) => n.toLowerCase().endsWith(ext) && !n.startsWith('__MACOSX/'));
    if (hit) return hit;
  }
  return null;
}

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

    try {
      const zipRes = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`,
        { headers: { Authorization: `token ${token}` }, responseType: 'arraybuffer', maxRedirects: 5 },
      );
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(Buffer.from(zipRes.data as ArrayBuffer));
      const name = pickBinaryName(Object.keys(zip.files));
      if (!name) {
        return res.status(422).json({ error: 'That build did not contain an installable app file.' });
      }
      const content = await zip.files[name].async('nodebuffer');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${name.split('/').pop()}"`);
      res.send(content);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      res.status(status === 404 ? 404 : 502).json({
        error: status === 404
          ? 'That file has expired on GitHub (builds are kept for 14 days). Run the build again.'
          : 'Could not download the app from GitHub.',
      });
    }
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
}
