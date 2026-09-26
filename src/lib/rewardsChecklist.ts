// THE REWARDS CHECKLIST pinned at the top of the notifications panel (admin 2026-09-26):
//
//   "sath me hamesha 1st notification me dikhna chahiye 4 me se kon kon se step baki hai — refer (only
//    for new user), gmail, mobile verification, github link (web par bas 2). jo jo complete ho uspar
//    green tick, jo complete nahi ho usko complete karne ke liye user profile par redirect button."
//
// PURE — the card renders exactly what this returns, so every rule about what a row says and where its
// button goes is testable without a DOM.
//
// 🔒 EVERY ROW'S BUTTON CAN ACTUALLY WORK — the second absolute rule on a list of money:
//   • done         → a green tick and the amount. No button.
//   • claim        → the step is DONE but not yet paid (an automatic claim that could not reach the
//                    device check, say): a Claim button, because sending the user to "complete" a step
//                    they already completed is a dead end that looks like a bug.
//   • complete     → not done: "Complete →", which lands on the Verifications card of the profile, or on
//                    the Wallet for the referral code (that box lives there, not on the profile).
// The rows themselves come from the SERVER, already filtered to the asking surface — so the website
// shows its two steps and "refer" appears only while the account can still apply a code.

import type { ChecklistRow } from './referralChecklist';
import { readyReferralSteps, type ReferralSurface } from './referralClaim';
import type { RewardStep } from './referralStepNames';

export type RewardRowState = 'done' | 'claim' | 'complete';
export type RewardRowTarget = 'profile' | 'wallet';

export interface RewardChecklistRow {
  step: RewardStep;
  /** The admin's own short name for the step. */
  name: string;
  rupees: number;
  state: RewardRowState;
  /** Where "Complete →" goes. Only meaningful when `state === 'complete'`. */
  target: RewardRowTarget;
  /** One short line under the name: what is left to do, in the user's terms. */
  hint: string;
}

export interface RewardChecklistModel {
  rows: RewardChecklistRow[];
  pendingRupees: number;
  earnedRupees: number;
  allDone: boolean;
  headline: string;
  /** Shown on the website only: why it has two rows and a ceiling. */
  surfaceNote: string | null;
}

/** The admin's words for each step (the labels a user reads on this card). */
export const REWARD_STEP_NAMES: Record<RewardStep, string> = {
  'referral-code': 'Referral code',
  email: 'Gmail login',
  mobile: 'Mobile verification',
  github: 'GitHub link',
};

function hintFor(step: RewardStep, state: RewardRowState, surface: ReferralSurface, phoneVerified: boolean): string {
  if (state === 'done') return 'Claimed';
  if (state === 'claim') return 'Done — tap Claim to add it to your wallet';
  if (surface === 'web' && step === 'github' && !phoneVerified) return 'Verify your mobile first — it unlocks this';
  switch (step) {
    case 'referral-code': return 'Apply a friend’s code in your Wallet';
    case 'email': return 'Sign in with Gmail, or verify your email';
    case 'mobile': return 'Verify your mobile number with an OTP';
    case 'github': return 'Connect your GitHub account';
    default: return '';
  }
}

export interface RewardChecklistInput {
  enabled: boolean;
  surface: ReferralSurface;
  rows: ChecklistRow[];
  emailVerified: boolean;
  phoneVerified: boolean;
  githubLinked: boolean;
  referred: boolean;
  webCapRupees: number | null;
}

/**
 * Build the card. Returns null when there is nothing honest to show: the programme is off, or the
 * server returned no rows (a failed lookup must show nothing rather than a checklist of zeroes).
 */
export function rewardsChecklistModel(p: RewardChecklistInput): RewardChecklistModel | null {
  if (!p.enabled || !Array.isArray(p.rows) || p.rows.length === 0) return null;
  const ready = new Set(readyReferralSteps({
    steps: p.rows.map((r) => ({ step: r.step, claimed: r.claimed })),
    emailVerified: p.emailVerified,
    phoneVerified: p.phoneVerified,
    githubLinked: p.githubLinked,
    referred: p.referred,
  }, p.surface));

  const rows: RewardChecklistRow[] = p.rows.map((r) => {
    const state: RewardRowState = r.claimed ? 'done' : ready.has(r.step) ? 'claim' : 'complete';
    return {
      step: r.step,
      name: REWARD_STEP_NAMES[r.step],
      rupees: r.rupees,
      state,
      target: r.step === 'referral-code' ? 'wallet' : 'profile',
      hint: hintFor(r.step, state, p.surface, p.phoneVerified),
    };
  });

  const pendingRupees = rows.filter((r) => r.state !== 'done').reduce((s, r) => s + r.rupees, 0);
  const earnedRupees = rows.filter((r) => r.state === 'done').reduce((s, r) => s + r.rupees, 0);
  const allDone = pendingRupees === 0;
  const headline = allDone
    ? `All rewards claimed — ₹${earnedRupees} earned`
    : `₹${pendingRupees} free credit waiting for you`;
  const surfaceNote = p.surface === 'web'
    ? `On the website: mobile + GitHub${p.webCapRupees ? `, up to ₹${p.webCapRupees}` : ''}. Gmail-login and referral rewards are in the Android app.`
    : null;

  return { rows, pendingRupees, earnedRupees, allDone, headline, surfaceNote };
}
