import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { audit } from '../lib/audit';
import { requireRole } from '../lib/authMiddleware';

/**
 * Team collaboration routes extracted from the server.ts monolith (Phase 1).
 *
 * - POST /api/team/invite — issue a project invite for an email address.
 *   P-SEC.1: gated by RBAC — only `owner`/`admin` may invite team members.
 *   (Role defaults to `owner` when unset, so existing single-user accounts are unaffected.)
 */
export function registerTeamRoutes(app: Express): void {
  app.post('/api/team/invite', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
    const { email, projectId, userId, role = 'viewer' } = req.body || {};
    if (!email || !userId) return res.status(400).json({ error: 'email and userId required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    // Email sending is not yet implemented — acknowledge the request but be honest.
    const inviteId = crypto.randomBytes(8).toString('hex');
    audit('TEAM_INVITE', { userId, email, projectId, role });
    return res.json({ ok: true, inviteId, message: `Invite recorded for ${email} — email delivery coming soon`, inviteUrl: `/join/${inviteId}`, emailSent: false });
  });
}
