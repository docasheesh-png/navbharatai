/**
 * READING THE APP LOCK'S TICKET OFF AN HTTP REQUEST — one implementation, two route files.
 *
 * `vaultTicket.ts` is deliberately pure crypto so it can be tested against fixed bytes. This is the thin
 * Express half, and it lives in its own module for the reason the fourth absolute rule names: the check
 * was about to exist in both `routes/secrets.ts` (reveal + delete) and `routes/appLock.ts` (changing
 * which areas are locked), and two copies of "is this caller allowed?" is how one of them comes to be
 * fixed and the other forgotten.
 */
import type { Request } from 'express';
import { verifyUnlockTicket, unlockSecret, type UnlockMethod } from './vaultTicket';

/** The ticket header. A header rather than a body field so GET-shaped calls could use it too. */
export const UNLOCK_TICKET_HEADER = 'x-vault-unlock';

/**
 * Read the unlock ticket off a request and confirm it belongs to this user, right now.
 *
 * Returns null on anything that is not a live ticket, and callers answer 401 — never a partial result.
 * A vault that returns SOME keys without proof is an open vault with extra steps.
 */
export function ticketFor(req: Request, userId: string, now = Date.now()): { method: UnlockMethod } | null {
  const raw = req.header(UNLOCK_TICKET_HEADER) ?? (typeof req.body?.ticket === 'string' ? req.body.ticket : '');
  if (!raw) return null;
  return verifyUnlockTicket(String(raw), userId, now, unlockSecret());
}
