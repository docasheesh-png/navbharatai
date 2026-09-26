// Apply the code typed on the sign-in screen, once there is an account to attach it to.
//
// The box is offered before sign-in (the admin's ask), and a referral belongs to a USER — so the
// code waits in `pendingReferralCode.ts` and this hook spends it at the first moment it can.
//
// 🔒 IT SPENDS THE HELD CODE EXACTLY ONCE, WHATEVER HAPPENS. Success, refusal, a dead device check,
// a network failure — the held code is cleared on every path. A code the server refused will be
// refused every time, so keeping it means retrying a guaranteed failure on every launch for ever;
// and a code that succeeded must obviously not be applied again. The user is told the outcome and
// can always enter a different code in Wallet → Promo, which is the honest path rather than a silent
// retry loop.
//
// 🔒 IT NEVER BREAKS SIGN-IN. Every failure is swallowed into a message; nothing here can throw into
// the screen a user has just signed in to.

import { useEffect, useRef, useState } from 'react';
import { heldReferralCode, clearHeldReferralCode } from '../lib/pendingReferralCode';
import { collectDeviceCheck } from '../lib/deviceIntegrityNative';
import { authedHeaders } from '../lib/authHeaders';

/**
 * The redeem currently in flight, if any. The automatic reward claim (useReferralProgress) waits on it:
 * a user who signed in by PHONE has a verified mobile the instant they arrive, and claiming that ₹100
 * BEFORE their held code is applied would make the account "old" (see canStillRedeem on the server) and
 * turn the code they typed on the sign-in screen into a refusal. Module-level because the two hooks are
 * separate and may mount in either order.
 */
let redeemInFlight: Promise<void> | null = null;
export function heldRedeemInFlight(): Promise<void> | null {
  return redeemInFlight;
}

export interface HeldCodeOutcome {
  /** A line to show the user, or null when there was no held code. */
  message: string | null;
  applied: boolean;
}

export function useHeldReferralCode(userId: string | null | undefined, onApplied?: () => void): HeldCodeOutcome {
  const [outcome, setOutcome] = useState<HeldCodeOutcome>({ message: null, applied: false });
  // One attempt per mount per user: a re-render must not re-post, and the held code is cleared
  // immediately anyway, so this is belt-and-braces against a double-fire in React strict mode.
  const tried = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || tried.current === userId) return;
    const code = heldReferralCode();
    if (!code) return;
    tried.current = userId;
    let alive = true;

    let settle: () => void = () => {};
    redeemInFlight = new Promise<void>((resolve) => { settle = resolve; });
    (async () => {
      // Cleared FIRST, deliberately: whatever happens next, this code has had its one attempt.
      clearHeldReferralCode();
      try {
        const device = await collectDeviceCheck();
        if (device.outcome !== 'ok') {
          if (alive) setOutcome({ applied: false, message: 'We could not check this device, so your referral code was not applied. You can enter it again in Wallet → Promo.' });
          return;
        }
        const res = await fetch(`/api/referral/${encodeURIComponent(userId)}/redeem`, {
          method: 'POST',
          headers: { ...(await authedHeaders()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, deviceId: device.deviceId, integrityToken: device.integrityToken, platform: 'android' }),
        });
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (res.ok && data?.ok) {
          setOutcome({ applied: true, message: 'Referral code applied — your ₹100 bonus is on its way to your wallet.' });
          onApplied?.();
        } else {
          // The server's own sentence, which is written to be actionable and to accuse nobody.
          setOutcome({ applied: false, message: String(data?.message || 'That referral code could not be applied.') });
        }
      } catch {
        if (alive) setOutcome({ applied: false, message: 'Your referral code could not be applied just now. You can enter it again in Wallet → Promo.' });
      } finally {
        // Whatever the outcome, the code has had its one attempt — the automatic claim may proceed.
        redeemInFlight = null;
        settle();
      }
    })();

    return () => { alive = false; };
  }, [userId, onApplied]);

  return outcome;
}
