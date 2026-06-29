import type { Express, Request, Response } from 'express';
import { analyzeAppDependencies } from '../AppMakerLab/SBOMGenerator';
import { workspaceRateLimiter } from '../lib/authMiddleware';

/**
 * P-BRE.10 — SBOM + license validation for the user's GENERATED apps.
 *
 * POST /api/workspace/sbom
 *   body: { packageLock: <parsed package-lock.json>, workspaceId?, buildId? }
 *   → { sbom (CycloneDX 1.5), copyleft: { strong[], weak[] }, componentCount, hasCopyleftRisk }
 *
 * The caller supplies the app's lockfile (the IDE already has the workspace files), so this needs
 * no sandbox access. Best-effort persistence to Firestore `sboms/{workspaceId}/{buildId}` when a
 * DB + ids are provided — never blocks the response.
 */
export function registerSbomRoutes(app: Express): void {
  app.post('/api/workspace/sbom', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const { packageLock, workspaceId, buildId } = req.body || {};
    if (!packageLock || typeof packageLock !== 'object') {
      res.status(400).json({ error: 'packageLock (parsed package-lock.json object) is required.' });
      return;
    }
    let result;
    try {
      result = analyzeAppDependencies(packageLock, new Date().toISOString());
    } catch (err) {
      res.status(422).json({ error: 'Could not parse the provided package-lock.json.' });
      return;
    }

    // Best-effort persistence — a storage failure must not fail the SBOM response.
    if (workspaceId && buildId) {
      try {
        const { getDb } = await import('../lib/db');
        const { doc, setDoc } = await import('firebase/firestore');
        const db = getDb() as any;
        if (db) {
          await setDoc(doc(db, 'sboms', String(workspaceId), 'builds', String(buildId)), {
            sbom: result.sbom,
            copyleft: result.copyleft,
            componentCount: result.componentCount,
            hasCopyleftRisk: result.hasCopyleftRisk,
            createdAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('[SBOM] persistence failed (non-fatal):', err);
      }
    }

    res.json(result);
  });
}
