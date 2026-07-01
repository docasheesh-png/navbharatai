import type { Express, Request, Response } from 'express';
import { loadDebt, recordDebt, prioritizeDebt, summarizeDebt, type IncomingFinding } from '../AppMakerLab/intelligence/TechnicalDebtTracker';
import { requireWorkspaceAccess } from '../lib/WorkspaceAccess';
import { validateBody, vobject, varray, vstring, venum } from '../lib/validate';

/**
 * P-PME.3 — technical-debt register.
 *
 *   GET  /api/techdebt/:userId/:projectId          — prioritized debt list + summary
 *   POST /api/techdebt/:userId/:projectId          — { findings: [{category,severity,file?,message}] }
 *                                                    → merge into the register, return prioritized list + summary
 *
 * Access: the workspace owner OR an active team member of that owner (P-COLLAB.2,
 * `requireWorkspaceAccess`); POST body request-validated (P-DATA.1).
 */
const recordSchema = vobject({
  findings: varray(vobject({
    category: venum(['security', 'architecture', 'lint', 'runtime', 'test', 'other'] as const),
    severity: venum(['low', 'medium', 'high', 'critical'] as const),
    file: vstring({ optional: true, max: 1024 }),
    message: vstring({ min: 1, max: 2000 }),
  })),
});

export function registerTechDebtRoutes(app: Express): void {
  app.get('/api/techdebt/:userId/:projectId', requireWorkspaceAccess('userId'), async (req: Request, res: Response) => {
    const items = prioritizeDebt(await loadDebt(req.params.userId, req.params.projectId));
    res.json({ items, summary: summarizeDebt(items) });
  });

  app.post('/api/techdebt/:userId/:projectId', requireWorkspaceAccess('userId'), validateBody(recordSchema), async (req: Request, res: Response) => {
    const findings = (req.body.findings || []) as IncomingFinding[];
    const items = await recordDebt(req.params.userId, req.params.projectId, findings, new Date().toISOString());
    res.json({ items, summary: summarizeDebt(items) });
  });
}
