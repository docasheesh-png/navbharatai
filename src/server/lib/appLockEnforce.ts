/**
 * THE APP LOCK ON THE MONEY ROUTES — where the PIN stops being a screen lock.
 *
 * Promised to the admin on 2026-09-13 and shipped here: the PIN now guards the actions that SPEND money
 * or change what will be charged, on the server, so the guarantee does not depend on the browser.
 *
 * 🔴 WHICH ROUTES, AND — MORE IMPORTANTLY — WHICH ONES ARE DELIBERATELY LEFT ALONE.
 *
 * Guarded: starting a wallet recharge, buying a Professional Pass, buying or renewing a hosting plan,
 * and flipping auto-renew. Every one of those fails BEFORE any money moves, so a refusal costs the user
 * nothing but a PIN entry.
 *
 * ⛔ NEVER guarded, and this is the line that matters: the RETURN paths — payment verification, the
 * Cashfree webhook, the store receipt credit, the sign-in reconcile. A user who has ALREADY PAID must be
 * credited without being asked for anything. Demanding a PIN there would mean real money taken and not
 * delivered because somebody could not remember four digits, which is a far worse failure than the gap
 * it would close. **Reaching the pay button needs the PIN; crediting money that was genuinely paid never
 * does.**
 */
import type { Request } from 'express';
import { effectiveLockedAreas, type AppLockArea } from '../../lib/appLockAreas';
import { loadLockRecord } from './appLockStore';
import { hasPin } from './vaultPin';
import { ticketFor } from './vaultTicketHttp';

/**
 * The money actions this module knows about, named after what the USER is doing rather than after the
 * route, so a route that is later split or renamed keeps the same mapping.
 */
export type MoneyAction =
  | 'wallet-recharge'
  | 'professional-pass'
  | 'hosting-plan-purchase'
  | 'hosting-plan-auto-renew';

/**
 * Which toggle covers which action. PURE, and the reason it is a function rather than four inline
 * comparisons: the mapping is a product decision and it is not obvious.
 *
 * ⚠️ `/api/payment/create-order` serves TWO products — a wallet recharge and a Professional Pass. Putting
 * the whole route behind `wallet_recharge` would mean a user who ticked "Wallet recharge" could no longer
 * buy a Pass either, which is not what that tick says. So the Pass is mapped to `subscription`, the area
 * that is actually about buying a plan.
 *
 * Locking the whole Wallet & Billing screen covers both, through `effectiveLockedAreas` — so a user who
 * ticked only the outer box gets everything inside it, without this map having to know that.
 */
export function areaForMoneyAction(action: MoneyAction): AppLockArea {
  switch (action) {
    case 'wallet-recharge':
      return 'wallet_recharge';
    case 'professional-pass':
    case 'hosting-plan-purchase':
    case 'hosting-plan-auto-renew':
      return 'subscription';
  }
}

export interface AppLockRefusal {
  status: number;
  body: Record<string, unknown>;
}

/** 401 + `needsUnlock`, which is the shape every client already knows how to react to. */
export function lockedRefusal(action: MoneyAction): AppLockRefusal {
  const what = action === 'hosting-plan-auto-renew' ? 'change this' : 'continue';
  return {
    status: 401,
    body: {
      error: `Enter your PIN to ${what}. Nothing has been charged.`,
      needsUnlock: true,
      area: areaForMoneyAction(action),
    },
  };
}

/**
 * Is this request allowed to perform this money action?
 *
 * Returns `null` when it may proceed, or the refusal to send. Call it at the TOP of the handler, before
 * anything is charged or created.
 *
 * 🔴 IT FAILS CLOSED, AND THAT IS THE OPPOSITE OF THE BROWSER HALF — the contrast is deliberate, not an
 * inconsistency, because the two are answering different questions.
 *
 * The client decides whether to SHOW a screen, and a status read it cannot complete renders the screen:
 * locking somebody out of Settings over a dropped request would break the app for the many people who
 * never switched this on. This decides whether to SPEND, and an unreadable record means we cannot
 * establish that the user permitted it — so the honest answer is the one these routes already give on
 * their own internal errors: *nothing was charged, please try again*. Nobody loses money either way, and
 * an attacker cannot turn "I made the lookup fail" into a purchase.
 *
 * The common case costs nothing: an account with no PIN — which is everyone who has not set one up — is
 * never blocked, because a PIN that does not exist cannot be demanded.
 */
export async function appLockBlocks(req: Request, userId: string, action: MoneyAction): Promise<AppLockRefusal | null> {
  const area = areaForMoneyAction(action);
  let record;
  try {
    record = await loadLockRecord(userId);
  } catch (err) {
    console.error('[app-lock] could not read the lock record; refusing the money action', action, err instanceof Error ? err.message : err);
    return {
      status: 503,
      body: { error: 'Could not check your app lock just now — nothing has been charged. Please try again in a moment.' },
    };
  }

  // No PIN ⇒ nothing to demand. This is the path every existing user takes, and it must be invisible.
  if (!hasPin(record)) return null;
  if (!effectiveLockedAreas(record.lockedAreas).includes(area)) return null;

  return ticketFor(req, userId) ? null : lockedRefusal(action);
}
