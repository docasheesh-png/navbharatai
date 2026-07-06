import type { Express, Request, Response } from 'express';
import { analyzeWorkspaceHealth } from '../AgentV3/WorkspaceHealth';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord } from '../lib/validate';

/**
 * AgentV3 — one-call Workspace Build-Health check for the generated app.
 *
 * POST /api/workspace/health-check
 *   body: { files: {path: content} }
 *   → { ok, totalIssues, filesScanned, checks: [{id, name, ok, issues, summary}] }
 *
 * Runs all four build-robustness analyzers (code confidence, React Rules-of-Hooks, import/export
 * consistency, JSX component resolution) and returns a single honest verdict. Rate-limited + validated.
 */
const schema = vobject({ files: vrecord() });

export function registerWorkspaceHealthRoutes(app: Express): void {
  app.post('/api/workspace/health-check', workspaceRateLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const { files } = req.body as { files: Record<string, string> };
    res.json(await analyzeWorkspaceHealth(files));
  });
}
