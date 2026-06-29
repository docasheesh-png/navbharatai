// P-CGE.9 — Deploy artifacts generation endpoint.
//
// Stateless: given docker / compose / ci options, return the generated Dockerfile,
// docker-compose.yml and GitHub Actions workflow. Pure compute, no secrets, no persistence.

import type { Express, Request, Response } from 'express';
import { generateDeployArtifacts, type DeployArtifactInput } from '../lib/DeployArtifactGenerator';

export function registerDeployArtifactsRoutes(app: Express): void {
  // POST /api/deploy-artifacts — body { docker?, compose?, ci? }
  app.post('/api/deploy-artifacts', (req: Request, res: Response) => {
    const body = req.body || {};
    const input: DeployArtifactInput = {};
    if (body.docker && typeof body.docker === 'object') input.docker = body.docker;
    if (body.compose && typeof body.compose === 'object') input.compose = body.compose;
    if (body.ci && typeof body.ci === 'object') input.ci = body.ci;
    if (!input.docker && !input.compose && !input.ci) {
      res.status(400).json({ error: 'provide at least one of { docker, compose, ci }' });
      return;
    }
    res.json(generateDeployArtifacts(input));
  });
}
