import type { Express, Request, Response } from 'express';
import { analyzeUndefinedHooks } from '../AgentV3/UndefinedHookAnalysis';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord } from '../lib/validate';

/**
 * AgentV3 — undefined-hook-call check for the generated app.
 *
 * POST /api/workspace/hook-resolution-check
 *   body: { files: {path: content} }
 *   → { undefinedHooks, filesScanned, ok }
 *
 * Flags React hook calls whose identifier is never imported or defined ("useState is not defined").
 * Exact AST analysis (ts-morph), conservative (member-expression calls, local defs, params, and
 * non-hook calls are never flagged). Rate-limited + validated.
 */
const schema = vobject({ files: vrecord() });

export function registerUndefinedHookCheckRoutes(app: Express): void {
  app.post('/api/workspace/hook-resolution-check', workspaceRateLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const { files } = req.body as { files: Record<string, string> };
    res.json(await analyzeUndefinedHooks(files));
  });
}
