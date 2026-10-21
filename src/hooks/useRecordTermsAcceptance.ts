// Record the sign-in checkbox against the account, the moment there is one (admin 2026-10-21).
//
// The checkbox is ticked BEFORE sign-in, and an agreement belongs to a user — so the evidence waits on the
// device (`signupAcceptance.ts`) and this hook posts it at the first moment an account is signed in, whichever of
// the sign-in paths (Google, Apple, GitHub, e-mail, phone, a redirect that reloaded the page) got it there.
//
// 🔒 THE MARKER IS CLEARED ONLY ON A REAL `{ ok: true }`. Not on a network error, not on a 503 the server gave
// because the write failed, not on a 4xx — so a record lost to a bad moment is retried on the next launch rather
// than forgotten. (Unlike the referral code, which is spent exactly once: there, a refusal repeats for ever; here a
// refusal can only mean the marker is malformed, and a malformed marker is never held in the first place.)
// 🔒 ONE ATTEMPT PER MOUNT PER ACCOUNT, so a re-render never posts twice.
// 🔒 IT NEVER BREAKS ANYTHING. Every failure is swallowed; the person has just signed in and must not see it.

import { useEffect, useRef } from 'react';
import { authedHeaders } from '../lib/authHeaders';
import { clearHeldAcceptance, heldAcceptance } from '../lib/signupAcceptance';

export function useRecordTermsAcceptance(userId: string | null | undefined): void {
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || tried.current === userId) return;
    let store: Storage | null = null;
    try { store = window.localStorage; } catch { return; }
    const held = heldAcceptance(store);
    if (!held) return;
    tried.current = userId;
    (async () => {
      try {
        const headers = await authedHeaders();
        const res = await fetch('/api/profile/terms-acceptance', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ termsVersion: held.termsVersion, privacyVersion: held.privacyVersion, ageConfirmed: true }),
        });
        const body = await res.json().catch(() => null);
        // Cleared even if this screen unmounted meanwhile: the server HAS the record, and a stale marker would repeat it.
        if (res.ok && body?.ok === true) clearHeldAcceptance(store);
      } catch { /* kept on the device; retried on the next launch */ }
    })();
  }, [userId]);
}
