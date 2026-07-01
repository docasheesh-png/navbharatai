// P-COLLAB.2 — Shared Workspace Access Model (backend ACL).
//
// Workspaces were owner-scoped: routes guarded by `requireUserMatch` allowed ONLY the owner (uid ===
// :userId), so a team member could never open the owner's workspace-scoped data. This adds a
// team-aware access check that RELAXES that safely:
//
//   • the OWNER always passes (no Firestore lookup needed — never lockable-out),
//   • an active TEAM MEMBER of the owner passes,
//   • any other authenticated user is denied (403),
//   • anonymous callers are still rejected (401) on routes that required auth.
//
// This is purely additive over `requireUserMatch` (which denied ALL non-owners): it only ever GRANTS
// access to members, never removes it from the owner, and fails CLOSED on a membership-lookup error
// (a member is briefly denied during a Firestore outage — never worse than the old owner-only rule, and
// never a security hole). Sensitive routes (secrets, webhooks) intentionally KEEP `requireUserMatch`.
//
// Admin-approved approach (2026-07-01): "owner hamesha pass, secrets member ko na dikhe."

import type { Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken } from './authMiddleware';
import { listMembers } from './TeamStore';

export type WorkspaceAccess = 'owner' | 'member' | 'anonymous' | 'denied';

/**
 * Pure access decision. Owner always allowed; an active member allowed; a different authenticated user
 * who is not a member is denied; no uid is 'anonymous' (the middleware decides if that's acceptable).
 */
export function resolveWorkspaceAccess(input: { requesterUid: string | null | undefined; ownerId: string; isMember: boolean }): WorkspaceAccess {
  const { requesterUid, ownerId, isMember } = input;
  if (!requesterUid) return 'anonymous';
  if (requesterUid === ownerId) return 'owner';
  if (isMember) return 'member';
  return 'denied';
}

/** Is `uid` an active member of `ownerId`'s team? Best-effort — returns false on any error (fail-closed). */
export async function isTeamMember(ownerId: string, uid: string): Promise<boolean> {
  if (!ownerId || !uid) return false;
  if (ownerId === uid) return true;
  try {
    const members = await listMembers(ownerId);
    return members.some((m) => m.uid === uid && m.status === 'active');
  } catch {
    return false;
  }
}

/**
 * Express middleware: allow the workspace owner OR an active team member of that owner to access a
 * `:<paramName>`-scoped route; 401 if unauthenticated, 403 otherwise. VITEST-skipped. Drop-in
 * replacement for `requireUserMatch` on WORKSPACE-scoped routes (NOT secrets/webhooks).
 */
export function requireWorkspaceAccess(paramName = 'userId') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.VITEST) { next(); return; }
    const ownerId = String(req.params[paramName] || '');
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Authentication required.' }); return; }
    if (uid === ownerId) { next(); return; } // owner — always allowed, no lookup

    const member = await isTeamMember(ownerId, uid); // fail-closed on error
    if (member) { next(); return; }
    res.status(403).json({ error: 'Forbidden: you do not have access to this workspace.' });
  };
}
