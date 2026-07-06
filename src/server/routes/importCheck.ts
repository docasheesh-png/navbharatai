import type { Express, Request, Response } from 'express';
import { analyzeImportExports } from '../AgentV3/ImportExportAnalysis';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord } from '../lib/validate';

/**
 * AgentV3 — Import/Export consistency check for the generated app.
 *
 * POST /api/workspace/import-check
 *   body: { files: {path: content} }
 *   → { mismatches, filesScanned, counts, ok }
 *
 * Flags named/default imports that the target local module does not actually export — a top cause of
 * hard build failures ("'X' is not exported by './y'"). Exact symbol-level analysis (ts-morph),
 * conservative (skips external pkgs, missing files, and wildcard re-exports). Rate-limited + validated.
 */
const schema = vobject({ files: vrecord() });

export function registerImportCheckRoutes(app: Express): void {
  app.post('/api/workspace/import-check', workspaceRateLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const { files } = req.body as { files: Record<string, string> };
    res.json(await analyzeImportExports(files));
  });
}
