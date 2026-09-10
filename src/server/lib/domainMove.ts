/**
 * "Move this domain to this app" — one tap, not a registrar visit (ROADMAP §13, 1.3).
 *
 * THE SITUATION (admin screenshots 2026-09-02 and 2026-09-10, `mitrify.com`). A domain connected
 * to app A, then Connect pressed on app B. Two things then stand in the way, and the user was
 * left to find both: the hosting service still holds the domain on A's site (so B's attach can be
 * refused as "already connected to another site"), and the ownership TXT names A's site. The
 * second is what the mismatch verdict and "Check & apply records" fix (#2792). This module decides
 * the FIRST: whether Connect may take the domain off A on the user's behalf.
 *
 * 🔒 ONLY WITHIN ONE ACCOUNT. The link store says which workspace and which user hold the domain.
 * Same user, different app ⇒ move it: the user pressed Connect on B, that IS the instruction, and
 * A losing the domain is said on screen rather than hidden. Different user ⇒ refuse, and say
 * nothing about whose it is — "which account holds this domain" is not this caller's business.
 *
 * PURE.
 */

export interface DomainHolder {
  workspaceId: string;
  userId: string;
}

export type DomainMoveDecision =
  | { action: 'none' }
  | { action: 'move'; from: string }
  | { action: 'refuse'; message: string };

export const OTHER_ACCOUNT_MESSAGE =
  'This domain is connected to an app in a different NavBharatAI account. Remove it there first, then connect it here.';

export function decideDomainMove(
  existing: DomainHolder | null | undefined,
  workspaceId: string,
  verifiedUid: string,
): DomainMoveDecision {
  if (!existing || !existing.workspaceId) return { action: 'none' };
  if (existing.workspaceId === workspaceId) return { action: 'none' };
  if (existing.userId && existing.userId === verifiedUid) return { action: 'move', from: existing.workspaceId };
  return { action: 'refuse', message: OTHER_ACCOUNT_MESSAGE };
}

/** What the screen says after a move. Names no workspace id — those are internal, not a name. */
export const MOVED_NOTE =
  'This domain was moved here from another app of yours — that app no longer serves it. To move it back, open that app and connect it there.';
