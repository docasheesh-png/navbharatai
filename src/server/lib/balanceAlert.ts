// The one door a balance warning goes out of (admin 2026-09-22).
//
// Delivery is BOTH channels, and the order matters: the in-app inbox FIRST, a push second.
//
// 🔑 A PUSH REACHES ALMOST NOBODY HERE. It needs the native shell, a registered device token and an
// accepted OS permission; most NavBharatAI users are on the website, where `sendPushToUser` finds no
// token and does nothing at all. The in-app notification works for every signed-in user on every
// surface — and since 2026-09-22 its unread count already draws the dot on ☰, so the warning lands
// on the same trail the empty-balance dot uses. A warning nobody can receive is not a warning.
//
// 🔒 IT IS TAPPABLE. `open-billing` is a name from a closed set, resolved by the client into the
// existing `navbharat:navigate` channel — never a stored URL (that would make the notification table
// an open-redirect). The whole value of warning early is that the fix is one tap away.
//
// 🔒 WHITE-LABEL LAW: one balance, one action, no vendor. Nothing here can name an engine.
//
// Fire-and-forget by construction: every failure is swallowed, because a build must never fail or
// slow down over a notice about it.

import { claimBalanceAlert, noteHealthyBalance } from './balanceAlertStore';
import { saveNotification } from './AdminNotificationStore';
import { notifyLowBalance } from './PushNotificationService';
import type { BalanceAlertKind } from './balanceAlertPolicy';

/**
 * The words. Two kinds, two different facts — and the LOW one is the whole point of this change:
 * it is said while the user can still act, which is the thing that did not exist before.
 */
export function balanceAlertMessage(kind: BalanceAlertKind): string {
  return kind === 'blocked'
    ? 'Your balance is finished, so new builds are paused. Add credit to carry on — nothing you have already made is affected.'
    : 'Your balance is running low — this build still ran, but the next one may not. Add credit to avoid an interruption.';
}

/**
 * Warn this user, at most as often as the admin's rule allows. Never throws, never awaited into a
 * response. The slot is claimed BEFORE delivery, so a delivery failure costs one notice rather than
 * re-sending on the next build.
 */
export async function warnAboutBalance(
  uid: string | null | undefined,
  email: string | null | undefined,
  kind: BalanceAlertKind,
): Promise<void> {
  try {
    const decision = await claimBalanceAlert(uid, kind);
    if (!decision.send) return;
    const message = balanceAlertMessage(kind);
    await saveNotification({
      message,
      target: { type: 'user', userId: uid ?? null, email: email ?? null },
      createdBy: 'system',
      action: 'open-billing',
    }).catch(() => null);
    // Second, and only a bonus: the phone. `blocked` keeps the wording it has always had.
    await notifyLowBalance(uid ?? null, kind === 'blocked').catch(() => undefined);
  } catch { /* a notice must never break the thing it is about */ }
}

/** The balance looks fine — start the clock that ends an episode. Never throws. */
export async function balanceLooksHealthy(uid: string | null | undefined): Promise<void> {
  try {
    await noteHealthyBalance(uid);
  } catch { /* best-effort */ }
}
