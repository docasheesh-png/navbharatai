// The referral progress a screen needs: the steps, the code, the earnings — and the automatic claim.
//
// 📱 BOTH SURFACES NOW (admin 2026-09-26). The website used to receive nothing from this hook, because
// the website could claim nothing. It now earns mobile + GitHub (₹200 at most, nothing until the mobile
// is verified) and a website user can share their code and earn as a referrer, so the website asks too —
// with `?platform=web`, and the SERVER answers with only the two steps it can finish. The app asks as
// `android` and gets all four ("refer" only while the account can still apply a code).
//
// 🔒 IT NEVER DECIDES ANYTHING ABOUT MONEY. It reports what the server said, and the automatic claim
// below only ASKS for what the server has already said is done-but-unpaid; the server re-decides every
// rupee inside a transaction regardless.
//
// ⚡ THE AUTOMATIC CLAIM (admin: *"gmail se login kare to 100 milne chahiye"*). A reward whose step is
// already done should not wait for somebody to find a Claim button: signing in with Google verifies the
// email, so the Gmail-login ₹100 lands on the first load after sign-in; a mobile or GitHub verified from
// ANY screen lands on the next refresh. Three rules keep it honest and cheap:
//   1. Deduplicated across every mounted instance (App, Profile, Wallet all use this hook) by a
//      module-level key of user + surface + the ready steps — one request per new fact, not one per screen.
//      A claim that failed is not retried on every render: the same key is never sent twice.
//   2. It waits for a referral code typed on the sign-in screen to be applied first
//      (`heldRedeemInFlight`). A phone sign-in has a verified mobile on arrival; paying that ₹100 first
//      would make the account "old" and refuse the code the user just typed.
//   3. A landed reward broadcasts `REFERRAL_GRANTED_EVENT`, so every instance refreshes and App shows ONE
//      toast — rather than each screen discovering the new balance on its own schedule.

import { useCallback, useEffect, useState } from 'react';
import { buildChecklist, type ChecklistRow } from '../lib/referralChecklist';
import { authedHeaders } from '../lib/authHeaders';
import {
  currentReferralSurface, readyReferralSteps, claimReadySteps, REFERRAL_GRANTED_EVENT,
  type ReferralSurface,
} from '../lib/referralClaim';
import { heldReferralCode } from '../lib/pendingReferralCode';
import { heldRedeemInFlight } from './useHeldReferralCode';
import type { RewardStep } from '../lib/referralStepNames';

export interface ReferralProgress {
  enabled: boolean;
  /** Which rule set this account is being shown: the app's four steps or the website's two. */
  surface: ReferralSurface;
  code: string | null;
  shareMessage: string;
  rows: ChecklistRow[];
  earnedRupees: number;
  capRupees: number;
  capReached: boolean;
  /** True once a code has been applied to this account — the box is then never offered again. */
  referred: boolean;
  /** True while this account may still apply a code (the app only; never on the website). */
  canRedeem: boolean;
  /** The website's own ceiling (₹200), or null in the app. */
  webCapRupees: number | null;
  /** What the account has actually verified, so a row can say what is missing. Server's answer. */
  emailVerified: boolean;
  phoneVerified: boolean;
  githubLinked: boolean;
  loading: boolean;
}

const EMPTY: ReferralProgress = {
  enabled: false, surface: 'web', code: null, shareMessage: '', rows: [],
  earnedRupees: 0, capRupees: 0, capReached: false, referred: false, canRedeem: false, webCapRupees: null,
  emailVerified: false, phoneVerified: false, githubLinked: false, loading: false,
};

/** Every (user, surface, ready-steps) combination already sent. Module-level: shared by all instances. */
const attemptedClaims = new Set<string>();

/**
 * Ask for the ready rewards, once per new combination of facts. Exported for the test only.
 * Returns the ₹ granted (0 when nothing was sent or nothing was owed).
 */
export async function autoClaimIfReady(
  userId: string,
  surface: ReferralSurface,
  ready: RewardStep[],
): Promise<number> {
  if (!userId || ready.length === 0) return 0;
  // A code typed on the sign-in screen that the held-code hook has not picked up yet: do nothing this
  // time and do NOT mark the key, so the next refresh (which that hook triggers) tries again.
  if (heldReferralCode()) return 0;
  const key = `${userId}|${surface}|${ready.join(',')}`;
  if (attemptedClaims.has(key)) return 0;
  attemptedClaims.add(key);
  const inFlight = heldRedeemInFlight();
  if (inFlight) await inFlight;
  const rupees = await claimReadySteps(userId, ready, surface);
  if (rupees > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(REFERRAL_GRANTED_EVENT, { detail: { rupees } }));
  }
  return rupees;
}

export function useReferralProgress(userId: string | null | undefined): ReferralProgress & { refresh: () => void } {
  const [state, setState] = useState<ReferralProgress>({ ...EMPTY, loading: Boolean(userId) });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Any instance's landed reward refreshes every instance.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onGranted = () => refresh();
    window.addEventListener(REFERRAL_GRANTED_EVENT, onGranted);
    return () => window.removeEventListener(REFERRAL_GRANTED_EVENT, onGranted);
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    if (!userId) { setState({ ...EMPTY }); return; }
    (async () => {
      const surface = await currentReferralSurface();
      try {
        // A RELATIVE path on purpose: `installNativeApiRewrite` (lib/apiBase.ts) already rewrites every
        // /api call in the native shell to the production origin.
        const res = await fetch(`/api/referral/${encodeURIComponent(userId)}?platform=${surface}`, {
          headers: await authedHeaders(),
        });
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok || !data?.ok || !data.enabled) { setState({ ...EMPTY, surface }); return; }
        const next: ReferralProgress = {
          enabled: true,
          surface,
          code: typeof data.code === 'string' ? data.code : null,
          shareMessage: typeof data.shareMessage === 'string' ? data.shareMessage : '',
          rows: buildChecklist(data.steps),
          earnedRupees: Number(data.earnedRupees) || 0,
          capRupees: Number(data.capRupees) || 0,
          capReached: data.capReached === true,
          referred: data.referred === true,
          canRedeem: data.canRedeem === true,
          webCapRupees: Number.isFinite(Number(data.webCapRupees)) && data.webCapRupees !== null
            ? Number(data.webCapRupees) : null,
          emailVerified: data.emailVerified === true,
          phoneVerified: data.phoneVerified === true,
          githubLinked: data.githubLinked === true,
          loading: false,
        };
        setState(next);
        const ready = readyReferralSteps({
          steps: next.rows.map((r) => ({ step: r.step, claimed: r.claimed })),
          emailVerified: next.emailVerified,
          phoneVerified: next.phoneVerified,
          githubLinked: next.githubLinked,
          referred: next.referred,
        }, surface);
        void autoClaimIfReady(userId, surface, ready).catch(() => { /* a manual Claim stays available */ });
      } catch {
        // A failed lookup shows NOTHING rather than a wrong or empty-looking checklist. The user's money
        // is unaffected — this is a view, and the next launch tries again.
        if (alive) setState({ ...EMPTY, surface });
      }
    })();
    return () => { alive = false; };
  }, [userId, tick]);

  return { ...state, refresh };
}
