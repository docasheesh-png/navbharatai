// P-CGE.4 — Test scaffold generation endpoint.
//
// Stateless: given function/route/mock definitions, return runnable Vitest test SKELETONS
// (unit, integration, mock). Pure compute, no secrets, no persistence.

import type { Express, Request, Response } from 'express';
import { generateTests, type TestGenInput } from '../lib/TestSkeletonGenerator';

export function registerTestGenRoutes(app: Express): void {
  // POST /api/testgen — body { unit?, integration?, mock? }
  app.post('/api/testgen', (req: Request, res: Response) => {
    const body = req.body || {};
    const input: TestGenInput = {};
    if (body.unit && typeof body.unit === 'object' && Array.isArray(body.unit.functions)) {
      input.unit = { modulePath: String(body.unit.modulePath || './module'), functions: body.unit.functions.slice(0, 500) };
    }
    if (body.integration && typeof body.integration === 'object' && Array.isArray(body.integration.routes)) {
      input.integration = { appImport: body.integration.appImport, routes: body.integration.routes.slice(0, 500) };
    }
    if (body.mock && typeof body.mock === 'object' && typeof body.mock.name === 'string') {
      input.mock = { name: body.mock.name, methods: Array.isArray(body.mock.methods) ? body.mock.methods.slice(0, 200) : undefined };
    }
    if (!input.unit && !input.integration && !input.mock) {
      res.status(400).json({ error: 'provide at least one of { unit, integration, mock }' });
      return;
    }
    res.json(generateTests(input));
  });
}
