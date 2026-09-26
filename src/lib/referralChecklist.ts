// THE REWARD CHECKLIST shown inside the testing notice (admin 2026-09-15).
//
// The admin asked for the four steps to appear in the popup that already greets every app open, in
// this shape:
//
//     ✅ referral code used — ₹100 claimed
//     ✅ email verified — ₹100 claimed
//     ✅ mobile number verified — ₹100 claimed
//     ❌ github not verified — ₹100 pending
//
// ⚠️ AND THAT POPUP DISAPPEARS BY ITSELF AFTER THREE SECONDS, which is the one thing that had to
// change with it. Three seconds is right for a sentence asking people to report bugs; it is not
// enough to read four lines, work out that ₹100 is unclaimed, and act — and once it has gone the
// user cannot get it back until the next cold start. A notice that shows somebody money and then
// removes it before they can reach it is worse than not showing it.
//
// So: WHILE ANY STEP IS PENDING THE NOTICE WAITS FOR THE USER. The countdown is not merely paused,
// it never starts. When all four are claimed the money section disappears entirely and the notice
// goes back to its three seconds — otherwise a user who finished weeks ago would be shown a
// congratulation on every single launch, which is how a helpful thing becomes a nagging one.
//
// 🔒 THE TESTING-NOTICE POPUP STAYS ANDROID-ONLY (`shouldShowChecklist`). ⚠️ CORRECTED 2026-09-26: the
// website is no longer a place that "cannot claim any of them" — it earns mobile + GitHub (₹200 max,
// mobile first) — and the rows themselves are now platform-aware, because the SERVER returns only the
// steps the asking surface can finish (`?platform=web` → two rows). The checklist every surface shows
// is the pinned card at the top of the notifications panel (RewardsChecklistCard); this popup keeps its
// Android-only rule so the website's launch notice is not made to wait on money.
//
// PURE — no DOM, no clock, no fetch.

import type { RewardStep } from './referralStepNames';
import { STEP_ORDER } from './referralStepNames';

export interface ChecklistRow {
  step: RewardStep;
  claimed: boolean;
  rupees: number;
  /** The whole line, ready to render. Built here so the words are testable. */
  label: string;
}

/** One step's status line. The claimed and pending wordings differ, as the admin's example does. */
export function checklistLabel(step: RewardStep, claimed: boolean, rupees: number): string {
  const amount = `₹${rupees}`;
  const done: Record<RewardStep, string> = {
    'referral-code': 'Referral code applied',
    email: 'Gmail / email verified',
    mobile: 'Mobile number verified',
    github: 'GitHub connected',
  };
  const todo: Record<RewardStep, string> = {
    'referral-code': 'Referral code not applied',
    email: 'Gmail / email not verified',
    mobile: 'Mobile number not verified',
    github: 'GitHub not connected',
  };
  return claimed
    ? `${done[step]} — ${amount} claimed`
    : `${todo[step]} — ${amount} pending`;
}

/**
 * Build the rows from whatever the server returned.
 *
 * Defensive on purpose: this renders MONEY, and a half-parsed response that showed a claimed step as
 * pending would send a user hunting for ₹100 they already have. An unreadable row is DROPPED rather
 * than guessed at, and a response that yields no rows shows no checklist at all.
 */
export function buildChecklist(steps: unknown): ChecklistRow[] {
  if (!Array.isArray(steps)) return [];
  const rows: ChecklistRow[] = [];
  for (const raw of steps) {
    const r = (raw || {}) as { step?: unknown; claimed?: unknown; rupees?: unknown };
    const step = String(r.step ?? '') as RewardStep;
    if (!STEP_ORDER.includes(step)) continue;
    if (rows.some((x) => x.step === step)) continue;
    const rupees = Number(r.rupees);
    if (!Number.isFinite(rupees) || rupees <= 0) continue;
    // Only an explicit `true` counts as claimed. Anything else is pending, which errs toward telling
    // the user there is money left rather than hiding money they can still take.
    const claimed = r.claimed === true;
    rows.push({ step, claimed, rupees, label: checklistLabel(step, claimed, rupees) });
  }
  // The admin's own order, not the server's: code, email, mobile, github.
  return rows.sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step));
}

/** What is still unclaimed, in ₹. The number that decides whether the notice waits. */
export function pendingRupees(rows: ChecklistRow[]): number {
  return rows.filter((r) => !r.claimed).reduce((sum, r) => sum + r.rupees, 0);
}

/**
 * Should the checklist be rendered at all?
 *
 * Only on Android, only with rows, and only while something is unclaimed. The last condition is what
 * keeps this from becoming a congratulation shown on every launch for ever.
 */
export function shouldShowChecklist(rows: ChecklistRow[], platform: string | null | undefined): boolean {
  if (String(platform ?? '').trim().toLowerCase() !== 'android') return false;
  return rows.length > 0 && pendingRupees(rows) > 0;
}

/**
 * Should the notice sit and wait instead of counting down?
 *
 * True exactly when the checklist is being shown — i.e. when there is unclaimed money on screen. A
 * notice with nothing to claim keeps the admin's three seconds.
 */
export function noticeShouldWait(rows: ChecklistRow[], platform: string | null | undefined): boolean {
  return shouldShowChecklist(rows, platform);
}

/** The one-line summary above the rows. Says the amount, because the amount is the reason to read on. */
export function checklistHeadline(rows: ChecklistRow[]): string {
  const pending = pendingRupees(rows);
  return `₹${pending} of free credit is still waiting for you`;
}
