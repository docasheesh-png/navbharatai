import type { Express, Request, Response } from 'express';
import { getDefinition, findReferences, lineColToOffset, type NavFile } from '../AI/NavigationEngine';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord, vstring, vnumber, venum } from '../lib/validate';

/**
 * P-DEV.1 — code-navigation endpoint (Go to Definition / Find References).
 *
 * POST /api/workspace/navigate
 *   body: { files: {path:content}, file, line, column, action: 'definition' | 'references' }
 *   → { ok, locations: [{ file, line, column, text }] }
 *
 * The caller (the editor) supplies the workspace file set; the engine builds an in-memory ts-morph
 * project and resolves the symbol semantically across files. Rate-limited; request-validated.
 */
const navSchema = vobject({
  files: vrecord(),
  file: vstring({ min: 1, max: 1024 }),
  line: vnumber({ int: true, min: 1 }),
  column: vnumber({ int: true, min: 1 }),
  action: venum(['definition', 'references'] as const),
});

export function registerNavigateRoutes(app: Express): void {
  app.post('/api/workspace/navigate', workspaceRateLimiter(), validateBody(navSchema), async (req: Request, res: Response) => {
    const { files, file, line, column, action } = req.body as {
      files: Record<string, string>; file: string; line: number; column: number; action: 'definition' | 'references';
    };
    const content = files[file];
    if (typeof content !== 'string') {
      res.status(400).json({ error: `file "${file}" not present in the supplied files.` });
      return;
    }
    const navFiles: NavFile[] = Object.entries(files)
      .filter(([, c]) => typeof c === 'string')
      .map(([path, c]) => ({ path, content: c }));
    const offset = lineColToOffset(content, line, column);
    const result = action === 'definition'
      ? await getDefinition(navFiles, file, offset)
      : await findReferences(navFiles, file, offset);
    res.json(result);
  });
}
