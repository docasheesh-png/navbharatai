import type { Express, Request, Response } from 'express';
import { generateChangelog } from '../AppMakerLab/generator/ChangelogManager';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord, vstring, varray } from '../lib/validate';

/**
 * P-PME.7 — changelog generation for the user's generated app.
 *
 * POST /api/workspace/changelog
 *   body: { previousFiles, files, version?, date?, fixed?[], existingChangelog? }
 *   → { entry, changelog (updated CHANGELOG.md), diff, empty }
 *
 * Caller supplies the two file sets (the IDE has them) + the current CHANGELOG.md, so no sandbox
 * access is needed. Rate-limited + request-validated.
 */
const schema = vobject({
  previousFiles: vrecord(),
  files: vrecord(),
  version: vstring({ optional: true, max: 64 }),
  date: vstring({ optional: true, max: 32 }),
  fixed: varray(vstring(), { optional: true }),
  existingChangelog: vstring({ optional: true, max: 1_000_000 }),
});

export function registerChangelogRoutes(app: Express): void {
  app.post('/api/workspace/changelog', workspaceRateLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const { previousFiles, files, version, date, fixed, existingChangelog } = req.body as {
      previousFiles: Record<string, string>; files: Record<string, string>;
      version?: string; date?: string; fixed?: string[]; existingChangelog?: string;
    };
    const result = generateChangelog(previousFiles, files, {
      version,
      date: date || new Date().toISOString().slice(0, 10),
      fixed,
      existingChangelog,
    });
    res.json(result);
  });
}
