import type { Express, Request, Response } from 'express';
import { analyzeWorkspaceHealth } from '../AgentV3/WorkspaceHealth';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord, vstring } from '../lib/validate';

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
// `framework` is optional (e.g. 'nuxt', 'vue', 'nextjs'); when omitted the React-family checks run, matching
// historical behaviour. It gates the React-specific analyzers so a Vue/Nuxt app is not falsely flagged.
const schema = vobject({ files: vrecord(), framework: vstring({ optional: true, max: 60 }) });

export function registerWorkspaceHealthRoutes(app: Express): void {
  app.post('/api/workspace/health-check', workspaceRateLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const { files, framework } = req.body as { files: Record<string, string>; framework?: string };
    res.json(await analyzeWorkspaceHealth(files, framework));
  });
}
