// Sonic Chat status route — lets the UI decide whether to show the (experimental) voice
// surface at all. Mirrors the AgentV3 /status gate: the client renders the Sonic entry
// point only when this returns enabled:true (flag + AWS creds present on the server).

import type { Express, Request, Response } from 'express';
import { isSonicEnabled } from './featureFlag';
import { SONIC_WS_PATH } from './sonicWs';

export function registerSonicRoutes(app: Express): void {
  app.get('/api/sonic/status', (_req: Request, res: Response) => {
    // NO-REVEAL (admin 2026-07-14): never expose the underlying model id to the client — Voice is a
    // NavBharatAI product, the provider stays server-side. The client only needs enabled + wsPath.
    res.json({ enabled: isSonicEnabled(), wsPath: SONIC_WS_PATH });
  });
}
