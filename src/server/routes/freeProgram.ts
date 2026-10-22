import type { Express, RequestHandler } from 'express';
import { freeProgramStore } from '../lib/freeProgram';
import { audit } from '../lib/audit';
import { adminUsername } from '../lib/adminAuth';

/** Admin switch for the free program (see lib/freeProgram.ts for exactly what "paused" covers). */
export function registerFreeProgramRoutes(app: Express, verifyAdminToken: RequestHandler): void {
  app.get('/api/admin/free-program', verifyAdminToken, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const state = await freeProgramStore.read();
    if (state.unavailable) { res.status(503).json({ error: 'The free-program setting could not be read. Everything free stays paused until it can be.', paused: true }); return; }
    res.json({ paused: state.paused, updatedAt: state.updatedAt });
  });
  app.post('/api/admin/free-program', verifyAdminToken, async (req, res) => {
    const { paused } = req.body ?? {};
    if (typeof paused !== 'boolean') { res.status(400).json({ error: 'Choose paused or live.' }); return; }
    try {
      const state = await freeProgramStore.setPaused(paused);
      audit('ADMIN_FREE_PROGRAM', { admin: adminUsername(), paused: state.paused });
      res.json({ paused: state.paused, updatedAt: state.updatedAt });
    } catch {
      res.status(503).json({ error: 'The free-program setting could not be saved. Refresh to see the current state, then try again.' });
    }
  });
}
