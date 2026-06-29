// P-PME.2 — Release Notes endpoint.
//
// Stateless transform: given the current and (optional) previous app blueprint, return a
// structured, shareable release note + Markdown. Pure compute, no secrets, no persistence —
// any client (the IDE "View Release Notes" button, the build flow) can call it.

import type { Express, Request, Response } from 'express';
import { generateReleaseNote, type BlueprintLike } from '../lib/ReleaseNotesGenerator';

const MAX_FEATURES = 500;

function sanitizeBlueprint(input: any): BlueprintLike {
  const bp: BlueprintLike = {};
  if (input && typeof input.name === 'string') bp.name = input.name.slice(0, 200);
  if (input && Array.isArray(input.features)) {
    bp.features = input.features.filter((f: any) => typeof f === 'string').slice(0, MAX_FEATURES).map((f: string) => f.slice(0, 300));
  }
  if (input && Array.isArray(input.techStack)) {
    bp.techStack = input.techStack.filter((t: any) => typeof t === 'string').slice(0, MAX_FEATURES).map((t: string) => t.slice(0, 100));
  }
  return bp;
}

export function registerReleaseNotesRoutes(app: Express): void {
  // POST /api/release-notes — body { current: Blueprint, previous?: Blueprint, version?, date? }
  app.post('/api/release-notes', (req: Request, res: Response) => {
    const body = req.body || {};
    if (!body.current || typeof body.current !== 'object') {
      res.status(400).json({ error: 'provide { current: { name?, features?[], techStack?[] }, previous?, version?, date? }' });
      return;
    }
    const current = sanitizeBlueprint(body.current);
    const previous = body.previous && typeof body.previous === 'object' ? sanitizeBlueprint(body.previous) : null;
    const version = typeof body.version === 'string' ? body.version.slice(0, 50) : undefined;
    // Date is caller-supplied (the engine never reads the clock); default to today here at the edge.
    const date = typeof body.date === 'string' ? body.date.slice(0, 40) : new Date().toISOString().slice(0, 10);
    const note = generateReleaseNote(current, previous, { version, date });
    res.json({ note });
  });
}
