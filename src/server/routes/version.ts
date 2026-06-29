import type { Express, Request, Response } from 'express';
import { computeNextVersion, type BlueprintSignals } from '../AppMakerLab/intelligence/SemanticVersionManager';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vstring, vnumber, vboolean } from '../lib/validate';

/**
 * P-PME.13 — semantic version computation for a build.
 *
 * POST /api/workspace/version
 *   body: { current, previous:{pages,entities,features?}, next:{pages,entities,features?}, repairOnly? }
 *   → { previous, next, bump }
 *
 * Pure computation (caller supplies the structural signals + current version), so no sandbox/DB
 * access is needed. Rate-limited + request-validated.
 */
const signals = vobject({
  pages: vnumber({ int: true, min: 0 }),
  entities: vnumber({ int: true, min: 0 }),
  features: vnumber({ int: true, min: 0, optional: true }),
});

const schema = vobject({
  current: vstring({ optional: true, max: 32 }),
  previous: signals,
  next: signals,
  repairOnly: vboolean({ optional: true }),
});

export function registerVersionRoutes(app: Express): void {
  app.post('/api/workspace/version', workspaceRateLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const { current, previous, next, repairOnly } = req.body as {
      current?: string; previous: BlueprintSignals; next: BlueprintSignals; repairOnly?: boolean;
    };
    res.json(computeNextVersion(current || '0.0.0', previous, next, { repairOnly }));
  });
}
