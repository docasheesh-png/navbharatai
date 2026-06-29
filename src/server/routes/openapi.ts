// P-CGE.5 — OpenAPI generation endpoint.
//
// Stateless: given a list of route definitions (+ optional info), return a valid OpenAPI 3.0.3
// document. Pure compute, no secrets, no persistence.

import type { Express, Request, Response } from 'express';
import { generateOpenApi, type RouteSpec, type OpenApiInfo } from '../lib/OpenApiGenerator';

const MAX_ROUTES = 2000;

export function registerOpenApiRoutes(app: Express): void {
  // POST /api/openapi/generate — body { routes: RouteSpec[], info?: { title?, version?, description? } }
  app.post('/api/openapi/generate', (req: Request, res: Response) => {
    const body = req.body || {};
    if (!Array.isArray(body.routes) || body.routes.length === 0) {
      res.status(400).json({ error: 'provide { routes: [{ method, path, ... }], info? }' });
      return;
    }
    const routes: RouteSpec[] = body.routes
      .filter((r: any) => r && typeof r.method === 'string' && typeof r.path === 'string')
      .slice(0, MAX_ROUTES);
    const info: OpenApiInfo = body.info && typeof body.info === 'object' ? body.info : {};
    res.json(generateOpenApi(routes, info));
  });
}
