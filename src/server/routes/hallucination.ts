import type { Express, Request, Response } from 'express';
import { detectHallucinations } from '../AgentV3/HallucinationDetector';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord, vnumber } from '../lib/validate';

/**
 * P-AI.1 — hallucination / code-confidence check for the generated app.
 *
 * POST /api/workspace/hallucination-check
 *   body: { files: {path:content}, threshold? }
 *   → { signals, confidence, isLowConfidence, counts }
 *
 * Caller supplies the generated file set (the IDE has it). Rate-limited + request-validated.
 */
const schema = vobject({
  files: vrecord(),
  threshold: vnumber({ optional: true, min: 0, max: 100 }),
});

export function registerHallucinationRoutes(app: Express): void {
  app.post('/api/workspace/hallucination-check', workspaceRateLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const { files, threshold } = req.body as { files: Record<string, string>; threshold?: number };
    res.json(detectHallucinations(files, { threshold }));
  });
}
