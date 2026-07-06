import type { Express, Request, Response } from 'express';
import { analyzeJsxComponents } from '../AgentV3/JsxComponentAnalysis';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord } from '../lib/validate';

/**
 * AgentV3 — JSX undefined-component check for the generated app.
 *
 * POST /api/workspace/jsx-check
 *   body: { files: {path: content} }
 *   → { undefinedComponents, filesScanned, ok }
 *
 * Flags JSX elements whose component is never imported or defined in the file — the classic
 * "X is not defined" white-screen. Exact AST analysis (ts-morph), conservative (host elements,
 * locally-defined and imported components, and props are never flagged). Rate-limited + validated.
 */
const schema = vobject({ files: vrecord() });

export function registerJsxCheckRoutes(app: Express): void {
  app.post('/api/workspace/jsx-check', workspaceRateLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const { files } = req.body as { files: Record<string, string> };
    res.json(await analyzeJsxComponents(files));
  });
}
