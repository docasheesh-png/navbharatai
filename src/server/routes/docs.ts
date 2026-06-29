// P-CGE.2 — Documentation generation endpoint.
//
// Stateless: given a blueprint / routes / function signatures, return generated docs
// (README, API reference, TSDoc blocks). Pure compute, no secrets, no persistence.

import type { Express, Request, Response } from 'express';
import { generateDocs, type DocBlueprint, type RouteDoc, type FunctionSignature } from '../lib/DocGenerator';

const MAX = 1000;

export function registerDocsRoutes(app: Express): void {
  // POST /api/docs/generate — body { blueprint?, routes?, signatures? }
  app.post('/api/docs/generate', (req: Request, res: Response) => {
    const body = req.body || {};
    const blueprint: DocBlueprint | undefined = body.blueprint && typeof body.blueprint === 'object' ? body.blueprint : undefined;
    const routes: RouteDoc[] | undefined = Array.isArray(body.routes)
      ? body.routes.filter((r: any) => r && typeof r.method === 'string' && typeof r.path === 'string').slice(0, MAX)
      : undefined;
    const signatures: FunctionSignature[] | undefined = Array.isArray(body.signatures)
      ? body.signatures.filter((s: any) => s && typeof s.name === 'string').slice(0, MAX)
      : undefined;
    if (!blueprint && !routes && !signatures) {
      res.status(400).json({ error: 'provide at least one of { blueprint, routes[], signatures[] }' });
      return;
    }
    res.json(generateDocs({ blueprint, routes, signatures }));
  });
}
