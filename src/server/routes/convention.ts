// P-CGE.3 — Convention & Naming endpoint.
//
// Stateless transform: given a batch of file paths / identifiers / import lines, return the
// convention check (violations + suggested fixes + reordered imports). Pure compute, no
// secrets, no persistence — usable by the IDE ("fix naming") or a post-generation pass.

import type { Express, Request, Response } from 'express';
import { analyzeConventions, type ConventionInput, type IdentifierKind } from '../lib/ConventionEngine';

const MAX_ITEMS = 1000;
const VALID_KINDS: IdentifierKind[] = ['function', 'variable', 'constant', 'component', 'type'];

export function registerConventionRoutes(app: Express): void {
  // POST /api/convention/check — body { files?: string[], identifiers?: {name,kind}[], imports?: string[] }
  app.post('/api/convention/check', (req: Request, res: Response) => {
    const body = req.body || {};
    const input: ConventionInput = {};
    if (Array.isArray(body.files)) {
      input.files = body.files.filter((f: any) => typeof f === 'string').slice(0, MAX_ITEMS).map((f: string) => f.slice(0, 400));
    }
    if (Array.isArray(body.identifiers)) {
      input.identifiers = body.identifiers
        .filter((i: any) => i && typeof i.name === 'string' && VALID_KINDS.includes(i.kind))
        .slice(0, MAX_ITEMS)
        .map((i: any) => ({ name: i.name.slice(0, 200), kind: i.kind as IdentifierKind }));
    }
    if (Array.isArray(body.imports)) {
      input.imports = body.imports.filter((l: any) => typeof l === 'string').slice(0, MAX_ITEMS).map((l: string) => l.slice(0, 500));
    }
    if (!input.files && !input.identifiers && !input.imports) {
      res.status(400).json({ error: 'provide at least one of { files: string[], identifiers: {name,kind}[], imports: string[] }' });
      return;
    }
    res.json(analyzeConventions(input));
  });
}
