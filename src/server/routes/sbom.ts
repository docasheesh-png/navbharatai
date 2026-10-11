import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { ownedByVerifiedUid } from '../lib/workspaceIdentity';
import { analyzeAppDependencies } from '../AppMakerLab/SBOMGenerator';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord, vstring } from '../lib/validate';
import { getServerDb } from '../lib/serverDb';

// P-DATA.1 — runtime schema for the SBOM request body (replaces the manual `if` check).
const sbomBodySchema = vobject({
  packageLock: vrecord(),
  workspaceId: vstring({ optional: true, max: 256 }),
  buildId: vstring({ optional: true, max: 256 }),
});

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
  app.post('/api/workspace/sbom', workspaceRateLimiter(), validateBody(sbomBodySchema), async (req: Request, res: Response) => {
    const { packageLock, workspaceId, buildId } = req.body;
    let result;
    try {
      result = analyzeAppDependencies(packageLock, new Date().toISOString());
    } catch (err) {
      res.status(422).json({ error: 'Could not parse the provided package-lock.json.' });
      return;
    }

    // PERSIST ONLY INTO A WORKSPACE THE CALLER OWNS (paid-surface audit, admin 2026-08-12). This
    // route was unauthenticated and wrote to `sboms/{workspaceId}/{buildId}` from the request body, so
    // anyone could plant an SBOM inside another user's workspace. The SBOM itself is still computed
    // and returned from the lockfile the caller supplied — that reveals nothing they did not send —
    // and only the WRITE needs an owner.
    const ownedWorkspaceId = workspaceId && ownedByVerifiedUid(await verifyFirebaseToken(req), workspaceId)
      ? String(workspaceId)
      : null;
    // Best-effort persistence — a storage failure must not fail the SBOM response.
    if (ownedWorkspaceId && buildId) {
      try {
        // The ADMIN handle (audit 2026-10-11, F9). This wrote through the client SDK until then — on a server, an
        // anonymous client the security rules refuse — so no SBOM was ever stored and the error was only logged.
        const db = getServerDb();
        if (db) {
          await db.collection('sboms').doc(ownedWorkspaceId).collection('builds').doc(String(buildId)).set({
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
