// Apply a brand kit into the app the signed-in user owns.
//
// Writes two source files. Does not charge. Does not remove the Made with NavBharatAI badge —
// that badge is injected at publish, and a hosting plan is what stops it.

import type { Express, Request, Response } from 'express';
import { verifyFirebaseIdentity } from '../lib/authMiddleware';
import { ownedByVerifiedUid } from '../lib/workspaceIdentity';
import { mergeWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { brandKitFiles } from '../../lib/brandKit';

export function registerBrandApplyRoutes(app: Express): void {
  app.post('/api/agentv3/brand/apply', async (req: Request, res: Response) => {
    const identity = await verifyFirebaseIdentity(req).catch(() => null);
    if (!identity?.uid) {
      res.status(401).json({ ok: false, charged: false, error: 'Please sign in. Nothing was written.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!ownedByVerifiedUid(identity.uid, workspaceId)) {
      res.status(403).json({ ok: false, charged: false, error: 'This app is not on your account. Nothing was written.' });
      return;
    }
    const kit = brandKitFiles(req.body ?? {});
    if (!kit.ok) {
      res.status(400).json({ ok: false, charged: false, error: kit.error });
      return;
    }
    const merged = await mergeWorkspaceFiles(workspaceId, kit.files);
    if (merged.status !== 'saved') {
      res.status(503).json({ ok: false, charged: false, error: 'The brand was not written into the app. Nothing was charged.' });
      return;
    }
    res.json({
      ok: true,
      charged: false,
      paths: Object.keys(kit.files),
      message: 'Your name and colours are in this app. Publish again to see them on the live site. This does not remove the Made with NavBharatAI badge, and nothing was charged.',
    });
  });
}
