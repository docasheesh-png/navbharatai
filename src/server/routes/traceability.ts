import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { ownedByVerifiedUid } from '../lib/workspaceIdentity';
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

/**
 * SECURITY FIX (paid-surface audit, admin 2026-08-12). These two routes had NO authentication at all:
 * the GET read `traceabilityStore.loadLatest(workspaceId)` straight from the query string, and the
 * POST wrote to `traceabilityStore.save(workspaceId, …)` straight from the body. Anyone who knew a
 * workspace id could read another user's requirement text and file paths, or overwrite their stored
 * matrix — unauthenticated, from anywhere.
 *
 * The COMPUTATION is left open on purpose: it runs on requirements and file paths the caller supplied
 * in the request body, so it reveals nothing it was not already given. Only the two operations that
 * touch STORED data — reading someone's matrix, and writing into their workspace — need an owner.
 * Gating the maths as well would break the IDE's use of it for an unsaved draft, for no security gain.
 *
 * 404 rather than 403 on a foreign workspace: confirming the id exists is half of what a prober wants.
 */
async function ownerOf(req: Request, workspaceId: string | undefined): Promise<string | null> {
  if (!workspaceId) return null;
  const uid = await verifyFirebaseToken(req);
  return ownedByVerifiedUid(uid, workspaceId) ? workspaceId : null;
}

export function registerTraceabilityRoutes(app: Express): void {
  app.post('/api/workspace/traceability', workspaceRateLimiter(), validateBody(bodySchema), async (req: Request, res: Response) => {
    const { workspaceId, requirements, files, tests } = req.body as {
      workspaceId?: string;
    } & TraceabilityInput;
    const matrix = buildTraceabilityMatrix({ requirements, files, tests: tests ?? [] }, workspaceId);
    // PERSIST ONLY INTO A WORKSPACE THE CALLER OWNS. The matrix is still returned either way — a
    // caller computing over their own unsaved draft loses nothing; a stranger simply cannot write
    // into someone else's workspace.
    const owned = await ownerOf(req, workspaceId);
    if (owned) {
      // Best-effort persist so the IDE can re-download later — never blocks or fails the response.
      traceabilityStore.save(owned, matrix).catch(() => {});
    }
    res.json(matrix);
  });

  app.get('/api/workspace/traceability', workspaceRateLimiter(), validateQuery(querySchema), async (req: Request, res: Response) => {
    const owned = await ownerOf(req, String((req.query as { workspaceId?: string }).workspaceId || ''));
    // Same 404 for "not yours" and "not there" — see the header.
    if (!owned) { res.status(404).json({ error: 'No traceability matrix yet — compute one via POST first.' }); return; }
    const matrix = await traceabilityStore.loadLatest(owned);
    if (!matrix) { res.status(404).json({ error: 'No traceability matrix yet — compute one via POST first.' }); return; }
    res.json(matrix);
  });
}
