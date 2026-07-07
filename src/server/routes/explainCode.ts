import type { Express, Request, Response } from 'express';
import { explainCode } from '../AgentV3/CodeExplainer';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vstring } from '../lib/validate';

/**
 * P-DEV.10 — Code Explanation.
 *
 * POST /api/workspace/explain
 *   body: { code, filename? }
 *   → { summary, kind, complexity, patterns, refactors, stats }
 *
 * Instant, free (no AI / no credit), deterministic structural explanation of a code selection or file:
 * plain-language summary, complexity label, detected patterns, and refactoring suggestions — every number
 * a real count of the actual code. Rate-limited + request-validated.
 */
const schema = vobject({
  code: vstring({ max: 100_000 }),
  filename: vstring({ optional: true, max: 500 }),
});

export function registerExplainCodeRoutes(app: Express): void {
  app.post('/api/workspace/explain', workspaceRateLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const { code, filename } = req.body as { code: string; filename?: string };
    res.json(explainCode(code, filename));
  });
}
