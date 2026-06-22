import type { Express, Request, Response } from 'express';
import { buildRateLimiter } from '../lib/authMiddleware';
import { isAgentV3Enabled, agentV3Status } from '../AgentV3';

/**
 * AgentV3 (Vargen 3.0) routes — strangler-fig P0 skeleton.
 *
 * Flag-gated (AGENTV3_ENABLED, default OFF) and importing NOTHING from the live
 * Pro/Engineer build paths, so mounting these endpoints cannot affect the live
 * app. When v3.0 is disabled they return an honest 404; when enabled they return
 * an honest "under construction" status — never a fake build result (CLAUDE.md
 * real-features rule). The native tool-use build loop ships in P1.
 */
export function registerAgentV3Routes(app: Express): void {
  // Capability probe — lets the frontend decide whether to show the v3.0 toggle.
  app.get('/api/agentv3/status', (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    res.json({ enabled: isAgentV3Enabled(userId), ...agentV3Status() });
  });

  // Build entry — not yet implemented in P0. Honest response, no fake stream.
  app.post('/api/agentv3/chat', buildRateLimiter(), (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    if (!isAgentV3Enabled(userId)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    res.status(503).json({ status: 'under_construction', ...agentV3Status() });
  });
}
