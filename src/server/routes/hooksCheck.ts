import type { Express, Request, Response } from 'express';
import { analyzeHooksRules } from '../AgentV3/HooksRulesAnalysis';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord } from '../lib/validate';

/**
 * AgentV3 — React Rules-of-Hooks check for the generated app.
 *
 * POST /api/workspace/hooks-check
 *   body: { files: {path: content} }
 *   → { violations, filesScanned, counts, ok }
 *
 * Catches conditional/looped/early-returned/callback hook calls that white-screen a React app at
 * runtime — a hard-crash class the readiness evaluators miss. Caller supplies the generated file set
 * (the IDE has it). Rate-limited + request-validated. Pure, AST-accurate, deterministic.
 */
const schema = vobject({ files: vrecord() });

export function registerHooksCheckRoutes(app: Express): void {
  app.post('/api/workspace/hooks-check', workspaceRateLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const { files } = req.body as { files: Record<string, string> };
    res.json(await analyzeHooksRules(files));
  });
}
