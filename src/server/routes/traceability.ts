import type { Express, Request, Response } from 'express';
import {
  buildTraceabilityMatrix,
  type TraceabilityInput,
} from '../AppMakerLab/intelligence/RequirementTraceabilityMatrix';
import { traceabilityStore } from '../AppMakerLab/intelligence/TraceabilityStore';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, validateQuery, vobject, vstring, varray } from '../lib/validate';

/**
 * P-PME.12 — Requirement Traceability Matrix (requirement → generated file → test).
 *
 *   POST /api/workspace/traceability
 *     body: { workspaceId?, requirements:[{id,text?}], files:[{path,requirementIds?}], tests?:[{path,covers?}] }
 *     → the computed matrix + coverage summary (also persisted for later download when workspaceId given)
 *
 *   GET  /api/workspace/traceability?workspaceId=...
 *     → the latest persisted matrix for that workspace (404 when none) — the IDE's "download" source
 *
 * Pure computation (caller supplies the signals it already has from RequirementIntelligenceEngine +
 * FilePlanningEngine + the generated tests). Rate-limited + request-validated. Persistence is
 * best-effort and never blocks the response.
 */

const requirementSchema = vobject({
  id: vstring({ min: 1, max: 200 }),
  text: vstring({ optional: true, max: 5000 }),
});
const fileSchema = vobject({
  path: vstring({ min: 1, max: 1000 }),
  requirementIds: varray(vstring({ max: 200 }), { optional: true, max: 500 }),
});
const testSchema = vobject({
  path: vstring({ min: 1, max: 1000 }),
  covers: varray(vstring({ max: 1000 }), { optional: true, max: 500 }),
});

const bodySchema = vobject({
  workspaceId: vstring({ optional: true, max: 200 }),
  requirements: varray(requirementSchema, { max: 2000 }),
  files: varray(fileSchema, { max: 5000 }),
  tests: varray(testSchema, { optional: true, max: 5000 }),
});

const querySchema = vobject({ workspaceId: vstring({ min: 1, max: 200 }) });

export function registerTraceabilityRoutes(app: Express): void {
  app.post('/api/workspace/traceability', workspaceRateLimiter(), validateBody(bodySchema), async (req: Request, res: Response) => {
    const { workspaceId, requirements, files, tests } = req.body as {
      workspaceId?: string;
    } & TraceabilityInput;
    const matrix = buildTraceabilityMatrix({ requirements, files, tests: tests ?? [] }, workspaceId);
    if (workspaceId) {
      // Best-effort persist so the IDE can re-download later — never blocks or fails the response.
      traceabilityStore.save(workspaceId, matrix).catch(() => {});
    }
    res.json(matrix);
  });

  app.get('/api/workspace/traceability', workspaceRateLimiter(), validateQuery(querySchema), async (req: Request, res: Response) => {
    const workspaceId = String((req.query as { workspaceId?: string }).workspaceId || '');
    const matrix = await traceabilityStore.loadLatest(workspaceId);
    if (!matrix) { res.status(404).json({ error: 'No traceability matrix yet — compute one via POST first.' }); return; }
    res.json(matrix);
  });
}
