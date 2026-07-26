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

export function registerMobileShipRoutes(app: Express): void {
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
