import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { audit } from '../lib/audit';
import { requireRole, verifyFirebaseToken, setUserRole } from '../lib/authMiddleware';
import {
  buildInviteRecord,
  buildMemberRecord,
  isInviteAcceptable,
  normalizeInviteRole,
  saveInvite,
  getInvite,
  setInviteStatus,
  addMember,
  removeMember,
  updateMemberRole,
  listMembers,
} from '../lib/TeamStore';

/**
 * Team collaboration routes (P-COLLAB.1 — durable membership + invite lifecycle).
 *
 * A "team" is scoped to its owner's account, so `teamId === owner uid`. Invites are persisted with a
 * real token and a token-based accept flow — no more localStorage-only membership that vanished on
 * logout, and no more "email delivery coming soon" dead-end. Email delivery is intentionally NOT
 * faked (NavBharatAI has no SMTP infra): the invite returns a real, copyable, resolvable link that a
 * signed-in user accepts, which adds them to the team AND grants their RBAC role (P-SEC.1).
 *
 *   POST /api/team/invite                  — owner/admin issues a durable invite → { token, inviteUrl }.
 *   GET  /api/team/invite/:token           — resolve an invite (for the accept screen). Public.
 *   POST /api/team/accept                  — authenticated user accepts → joins the team + gets the role.
 *   GET  /api/team/:teamId/members         — owner/admin lists the team's members.
 *   POST /api/team/invite/:token/revoke    — owner/admin revokes a pending invite.
 *   POST /api/team/member/remove           — owner/admin removes a member.
 */
export function registerTeamRoutes(app: Express): void {
  // Issue a durable, token-based invite (RBAC-gated: only owner/admin may invite).
  app.post('/api/team/invite', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
    const { email, projectId, userId, role = 'viewer' } = req.body || {};
    if (!email || !userId) return res.status(400).json({ error: 'email and userId required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // teamId is the owner's account; the inviter's real uid is the verified token (falls back to userId).
    const invitedBy = (await verifyFirebaseToken(req)) || String(userId);
    const token = crypto.randomBytes(24).toString('base64url');
    const invite = buildInviteRecord({ token, teamId: String(userId), email, role, invitedBy, now: Date.now() });

    const persisted = await saveInvite(invite);
    audit('TEAM_INVITE', { userId, email, projectId, role: invite.role, persisted });

    return res.json({
      ok: true,
      token,
      role: invite.role,
      // Relative link — the client makes it absolute. `?join=<token>` is handled by the in-app accept
      // gate (no route change needed). Honest: the link IS the working invite; email is not sent.
      inviteUrl: `/?join=${token}`,
      emailSent: false,
      persisted,
      message: persisted
        ? `Invite link created for ${email}. Share the link to add them to your team.`
        : `Invite link created for ${email} (not yet persisted — Firestore unavailable).`,
    });
  });

  // Resolve an invite by token so the accept screen can show who/what it's for. Public: the token is
  // the capability. Returns only non-sensitive fields (never the inviter or internal ids).
  app.get('/api/team/invite/:token', async (req: Request, res: Response) => {
    const token = String(req.params.token || '');
    if (!token) return res.status(400).json({ valid: false, error: 'token required' });
    const invite = await getInvite(token);
    if (!invite) return res.status(404).json({ valid: false, error: 'Invite not found or no longer available.' });
    const valid = isInviteAcceptable(invite, Date.now());
    return res.json({
      valid,
      email: invite.email,
      role: invite.role,
      teamId: invite.teamId,
      status: invite.status,
      expiresAt: invite.expiresAt,
    });
  });

  // Accept an invite. The ACCEPTING user must be authenticated; their verified uid joins the team and
  // is granted the invited role (wired into RBAC via setUserRole).
  app.post('/api/team/accept', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Sign in to accept this invite.' });

    const { token, email } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token required' });

    const invite = await getInvite(String(token));
    if (!isInviteAcceptable(invite, Date.now())) {
      return res.status(409).json({ error: 'This invite is invalid, already used, or expired.' });
    }
    // `invite` is non-null here (isInviteAcceptable rejected null).
    const teamId = invite!.teamId;
    const role = invite!.role;

    const member = buildMemberRecord({ uid, email: email || invite!.email, role, now: Date.now() });
    const joined = await addMember(teamId, member);
    if (joined) {
      try { await setUserRole(uid, role); } catch { /* RBAC grant is best-effort; membership still stands */ }
      await setInviteStatus(String(token), 'accepted');
    }
    audit('TEAM_INVITE_ACCEPTED', { uid, teamId, role, joined });

    return res.json({ ok: joined, teamId, role, message: joined ? 'You have joined the team.' : 'Could not join right now — try again.' });
  });

  // List a team's members (owner/admin only).
  app.get('/api/team/:teamId/members', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
    const teamId = String(req.params.teamId || '');
    if (!teamId) return res.status(400).json({ error: 'teamId required' });
    const members = await listMembers(teamId);
    return res.json({ members });
  });

  // Revoke a pending invite (owner/admin only).
  app.post('/api/team/invite/:token/revoke', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
    const token = String(req.params.token || '');
    if (!token) return res.status(400).json({ error: 'token required' });
    await setInviteStatus(token, 'revoked');
    audit('TEAM_INVITE_REVOKED', { token });
    return res.json({ ok: true });
  });

  // Remove a member (owner/admin only). Soft-delete keeps the audit trail.
  app.post('/api/team/member/remove', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
    const { teamId, uid } = req.body || {};
    if (!teamId || !uid) return res.status(400).json({ error: 'teamId and uid required' });
    await removeMember(String(teamId), String(uid));
    audit('TEAM_MEMBER_REMOVED', { teamId, uid });
    return res.json({ ok: true });
  });

  // Change a member's role (owner/admin only) — updates the team member record AND the RBAC role.
  app.post('/api/team/member/role', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
    const { teamId, uid, role } = req.body || {};
    if (!teamId || !uid || !role) return res.status(400).json({ error: 'teamId, uid and role required' });
    const normalized = normalizeInviteRole(role);
    await updateMemberRole(String(teamId), String(uid), normalized);
    try { await setUserRole(String(uid), normalized); } catch { /* RBAC grant best-effort */ }
    audit('TEAM_MEMBER_ROLE_CHANGED', { teamId, uid, role: normalized });
    return res.json({ ok: true, role: normalized });
  });
}

// Re-exported for callers that want the canonical role mapping without importing the store directly.
export { normalizeInviteRole };
