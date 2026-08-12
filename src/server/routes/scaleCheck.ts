import type { Express, Request, Response } from 'express';
import { analyzeScaling } from '../AgentV3/ScaleAnalysis';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord } from '../lib/validate';

/**
 * AgentV3 — scaling check for the generated app.
 *
 * POST /api/workspace/scale-check
 *   body: { files: {path: content} }
 *   → { ok, findings, filesScanned, counts, verdict }
 *
 * Answers "will this app survive real traffic?" from the three things that actually break a small app
 * as it grows: queries that read every row, queries inside a loop, and filters on unindexed columns.
 * Pure and deterministic — no model call, so it costs nothing and cannot invent a problem that is not
 * in the code. It deliberately does NOT emit a capacity figure ("handles N users"); that depends on the
 * database plan and hosting, which the code cannot see. Rate-limited + request-validated.
 */
const schema = vobject({ files: vrecord() });

export function registerScaleCheckRoutes(app: Express): void {
  app.post('/api/workspace/scale-check', workspaceRateLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const { files } = req.body as { files: Record<string, string> };
    res.json(analyzeScaling(files));
  });
}
