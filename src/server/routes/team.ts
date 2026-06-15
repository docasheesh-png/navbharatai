import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { audit } from '../lib/audit';

/**
 * Team collaboration routes extracted from the server.ts monolith (Phase 1).
 * Behavior unchanged.
 *
 * - POST /api/team/invite — issue a project invite for an email address
 */
export function registerTeamRoutes(app: Express): void {
  app.post('/api/team/invite', async (req: Request, res: Response) => {
    const { email, projectId, userId, role = 'viewer' } = req.body || {};
    if (!email || !userId) return res.status(400).json({ error: 'email and userId required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const inviteId = crypto.randomBytes(8).toString('hex');
    audit('TEAM_INVITE', { userId, email, projectId, role });
    return res.json({ ok: true, inviteId, message: `Invite sent to ${email}`, inviteUrl: `/join/${inviteId}` });
  });
}
