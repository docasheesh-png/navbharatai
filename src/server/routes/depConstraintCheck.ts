import type { Express, Request, Response } from 'express';
import { analyzeDependencyConstraints } from '../AI/reasoning/ConstraintSolver';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord } from '../lib/validate';

/**
 * P-AI.14 — dependency version-constraint check for the generated app.
 *
 * POST /api/workspace/dependency-check
 *   body: { files: {path: content} }
 *   → { conflicts, filesScanned, ok }
 *
 * Flags version conflicts in package.json (react/react-dom major mismatch, duplicate deps at different
 * majors, @types drift) that break `npm install` or crash the app. Pure; rate-limited + validated.
 */
const schema = vobject({ files: vrecord() });

export function registerDepConstraintCheckRoutes(app: Express): void {
  app.post('/api/workspace/dependency-check', workspaceRateLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const { files } = req.body as { files: Record<string, string> };
    res.json(analyzeDependencyConstraints(files));
  });
}
