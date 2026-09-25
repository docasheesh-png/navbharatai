import type { Express, Request, Response } from 'express';
import { workspaceRateLimiter, verifyFirebaseIdentity } from '../lib/authMiddleware';
import { validateBody, vobject, vstring } from '../lib/validate';
import { deploymentStore, isLiveDeployment } from '../AgentV3/DeploymentStore';
import { runCheckup, decideCheckupAccess } from '../lib/websiteCheckup';

/**
 * WEBSITE CHECKUP — a passive health check the user runs on THEIR OWN NavBharatAI-published site.
 *
 * Admin, on scope (2026-09-25): *"user ki khud ki website check karwani hai? kisi aur ki nahi!!"*
 *
 * 🔒 THE OWN-SITES-ONLY GUARANTEE IS ENFORCED HERE, BY CONSTRUCTION — not by trusting a URL.
 * The client never sends a URL. It sends a `workspaceId`, and the server:
 *   1. resolves the deployment record for that workspace, then
 *   2. refuses unless `record.userId === the authenticated caller` AND the deployment is live.
 * So the ONLY URL that can ever be checked is one this exact user published through NavBharatAI.
 * Guessing another person's workspaceId fails at step 2; there is no code path that fetches an
 * arbitrary address. (`websiteCheckup.ts` additionally re-runs the SSRF guard on every fetch hop —
 * ownership is not a licence to fetch a private address.)
 *
 * It costs no model call — the checks are a single GET plus deterministic analysis — so it is FREE
 * and unmetered, like the other deterministic tools (THE ONE-WALLET LAW: only what costs us money
 * draws the wallet down).
 */

const runSchema = vobject({
  workspaceId: vstring({ min: 1, max: 200 }),
});

export function registerWebsiteCheckupRoutes(app: Express): void {
  // The list of the caller's OWN checkable sites — feeds the dropdown; never anyone else's.
  app.get('/api/website-checkup/sites', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const identity = await verifyFirebaseIdentity(req);
    if (!identity?.uid) {
      res.status(401).json({ error: 'Please sign in to check your sites.' });
      return;
    }
    try {
      const records = await deploymentStore.listByUser(identity.uid, 100);
      const sites = records
        .filter((r) => isLiveDeployment(r))
        .map((r) => ({ workspaceId: r.workspaceId, url: r.url, updatedAt: r.updatedAt }))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      res.json({ sites });
    } catch {
      res.status(500).json({ error: 'Your sites could not be loaded right now. Please try again.' });
    }
  });

  // Run the checkup on ONE of the caller's own live sites.
  app.post('/api/website-checkup', workspaceRateLimiter(), validateBody(runSchema), async (req: Request, res: Response) => {
    const identity = await verifyFirebaseIdentity(req);
    if (!identity?.uid) {
      res.status(401).json({ error: 'Please sign in to check your site.' });
      return;
    }
    const { workspaceId } = req.body as { workspaceId: string };

    let record;
    try {
      record = await deploymentStore.get(workspaceId);
    } catch {
      res.status(500).json({ error: 'We could not look up that site right now. Please try again.' });
      return;
    }

    // The one gate that makes "your sites only" true: the record must be THIS user's, and live.
    const access = decideCheckupAccess(record, identity.uid);
    if (!access.ok) {
      res.status(403).json({ error: access.reason });
      return;
    }

    try {
      const result = await runCheckup(access.url, new Date().toISOString());
      res.json(result);
    } catch {
      res.status(502).json({ error: 'The checkup could not finish. Please try again in a moment.' });
    }
  });
}
