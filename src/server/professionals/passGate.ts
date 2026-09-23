// Shared Professional gate — the ONE place both the config-driven professional route and the bespoke
// Doctor AI (SDA) route decide a turn, so "Doctor AI = same as all professionals" (admin 2026-07-15) can
// never drift between the two. Since 2026-09-23: the first professionalFreeDailyLimit() answers a day
// (shared across ALL professionals AND Doctor AI) are free, every answer after that is paid from the one
// wallet; free-list and an active pass are unlimited; anonymous callers must sign in. Exam mode has its
// own question allowance (`gateProfessionalExam`). `PROFESSIONAL_FREE_QUOTA=off` restores the previous
// behaviour exactly. Returns the model tier + charged share for an allowed turn, or a block payload.

import { decideProfessionalAccess, splitExamQuestions } from './access';
import {
  professionalFreeDailyLimit, isProfessionalFreeUser,
  professionalFreeQuotaEnabled, professionalExamFreeDailyQuestions,
} from './professionalPaid';
import { professionalPassStore } from './ProfessionalPassStore';
import { professionalUsageStore, professionalExamUsageStore } from './ProfessionalUsageStore';
import { aiWalletSpendEnabled } from '../lib/aiTurnCharge';
import { readWalletBalanceInr, firestoreWalletReader } from '../AgentV3/WalletBalance';
import { getServerDb } from '../lib/serverDb';
import { walletEmptyBody, WALLET_EMPTY_STATUS } from '../lib/walletEmptyNotice';

export type ProfessionalTier = 'free' | 'paid';

/**
 * Is the wallet empty enough to refuse a turn? PURE, so the money-sensitive comparison is testable.
 *
 * `null` means the balance could not be read at all, and that is deliberately ALLOWED through —
 * fail-open, matching the build gate. Refusing on a Firestore blip would deny a paying user their
 * assistant over an infrastructure hiccup; allowing means at worst one cheap turn we do not collect,
 * and the debit still records the debt honestly.
 *
 * A ₹0 or negative balance IS refused, because the alternative is unbounded free usage: unlike a build,
 * a chat turn has no "next pre-flight gate" to catch the overdraft later.
 */
export function walletTooEmptyForTurn(balanceInr: number | null): boolean {
  return balanceInr !== null && balanceInr <= 0;
}

export type PassGateResult =
  | {
      allow: true; countsAgainstFree: boolean; remainingFree?: number; uid: string | null; tier: ProfessionalTier;
      /** Carried so the caller can charge the wallet without re-deriving (or re-reading) either fact. */
      isFreeListed: boolean; hasActivePass: boolean;
      /**
       * The share of this turn's real cost the wallet is charged (0…1). `0` for one of the day's free
       * messages — they are FREE, and before 2026-09-23 nothing said so to the charge, so a counted
       * free message would still have been billed. Hand it straight to the charge context.
       */
      billableFraction: number;
    }
  | { allow: false; status: number; body: Record<string, unknown> };

/** Read the pass once for a verified, non-free-listed caller — and only when something will use it. */
async function activePassFor(uid: string | null, freeListed: boolean, needed: boolean): Promise<boolean> {
  if (!uid || freeListed || !needed) return false;
  return (await professionalPassStore.getStatus(uid).catch(() => ({ active: false }))).active;
}

/** The balance, or `null` when it cannot be read (fail-open — see `walletTooEmptyForTurn`). */
async function balanceFor(uid: string): Promise<number | null> {
  return readWalletBalanceInr(firestoreWalletReader(getServerDb() as any), uid).catch(() => null);
}

/** Decide access + model tier for one professional/Doctor-AI turn. `uid`/`email` MUST be the server-
 *  verified identity (never a client-claimed body field).
 *
 *  THE RULE (admin 2026-09-23, "din ke 10 message free honge, fir paid hoga"): a signed-in user's
 *  first `professionalFreeDailyLimit()` answers each day are FREE — the free model chain, never
 *  charged, and NOT refused for an empty wallet (a free message does not need a balance). After that
 *  every answer is PAID: the paid chain, charged its real cost + markup from the one wallet, and
 *  refused only when that wallet is empty. The free-list and a Pass holder are unlimited. */
export async function gateProfessionalTurn(uid: string | null, email: string | null): Promise<PassGateResult> {
  const freeListed = isProfessionalFreeUser(uid, email);
  const walletSpend = aiWalletSpendEnabled();
  const quotaOn = professionalFreeQuotaEnabled();
  // The pass is read at most ONCE per turn and shared by both gates below — it decides "unlimited
  // access" for the allowance AND "already paid for, do not charge the wallet" for the spend gate.
  const hasActivePass = await activePassFor(uid, freeListed, walletSpend || quotaOn);

  if (!quotaOn) {
    // PROFESSIONAL_FREE_QUOTA=off — the previous behaviour exactly: every answer on the paid chain,
    // charged its real cost from the first message, and an empty wallet refused up front.
    if (walletSpend && uid && !freeListed && !hasActivePass) {
      const balanceInr = await balanceFor(uid);
      if (walletTooEmptyForTurn(balanceInr)) {
        // ADMIN 2026-08-10 ("pass system hata do"): no Pass offer here — it has never been sellable.
        // ADMIN 2026-09-22: the wording is shared (`walletEmptyNotice`) and states a real debt.
        return { allow: false, status: WALLET_EMPTY_STATUS, body: walletEmptyBody({ balanceInr, what: 'this answer' }) };
      }
    }
    return { allow: true, countsAgainstFree: false, uid, tier: 'paid', isFreeListed: freeListed, hasActivePass, billableFraction: 1 };
  }

  const freeDailyLimit = professionalFreeDailyLimit();
  const usedToday = !!uid && !freeListed && !hasActivePass ? await professionalUsageStore.getTodayCount(uid) : 0;
  const decision = decideProfessionalAccess({
    enabled: true, signedIn: !!uid, isFreeListed: freeListed, hasActivePass, usedToday, freeDailyLimit,
    // "Then paid" needs a wallet to be paid FROM. Without wallet spending an over-allowance answer
    // could not be charged, so it is the old honest block rather than a silent free answer.
    overQuota: walletSpend ? 'paid' : 'block',
  });

  if (decision.action === 'allow') {
    if (decision.reason === 'paid-after-free') {
      const balanceInr = await balanceFor(uid as string);
      if (walletTooEmptyForTurn(balanceInr)) {
        return {
          allow: false,
          status: WALLET_EMPTY_STATUS,
          body: walletEmptyBody(
            { balanceInr, what: 'this answer', alternative: `Your ${freeDailyLimit} free messages come back tomorrow.` },
            { freeUsedUp: true, freeDailyLimit, remainingFree: 0 },
          ),
        };
      }
    }
    // Model tier: a free message → the free chain; a paid answer, a Pass or the free-list → the paid
    // chain. This is what makes "free = cheap models" real.
    const free = decision.reason === 'within-free-quota';
    return {
      allow: true, countsAgainstFree: decision.countsAgainstFree, remainingFree: decision.remainingFree, uid,
      tier: free ? 'free' : 'paid',
      isFreeListed: freeListed, hasActivePass,
      billableFraction: free ? 0 : 1,
    };
  }
  const login = decision.reason === 'login-required';
  return {
    allow: false,
    status: login ? 401 : 402,
    body: {
      error: login
        ? 'Please sign in to use the Professionals. New users get free messages every day.'
        // Reachable only while AI_WALLET_SPEND is off — with it on, an over-allowance answer is paid
        // instead. So there is nothing to buy here, and the message says the one true thing left.
        : `You've used your ${freeDailyLimit} free messages for today. They reset tomorrow.`,
      code: login ? 'login_required' : 'professional_paywall',
      reason: decision.reason,
      remainingFree: 0,
      freeDailyLimit,
    },
  };
}

export type ExamGateResult =
  | {
      allow: true; uid: string | null; tier: ProfessionalTier;
      isFreeListed: boolean; hasActivePass: boolean;
      /** Questions of this paper the day's free allowance covers (0 when uncounted or unlimited). */
      freeQuestions: number;
    }
  | { allow: false; status: number; body: Record<string, unknown> };

/**
 * The Exam-mode gate (admin 2026-09-23: *"exam mode me only 5 questions per day free ho, baaki sab
 * paid"*). A SEPARATE daily allowance from the chat messages, counted in questions: the free share of
 * a paper is free, the rest is charged at the same real-cost-plus-markup rate as a message.
 *
 * ⚠️ A partly-free paper needs a balance for its paid part. An empty wallet is refused BEFORE the
 * model is asked, with the one thing that still works named — a smaller paper that fits the free
 * questions left — rather than a paper the student cannot pay for.
 */
export async function gateProfessionalExam(uid: string | null, email: string | null, requested: number): Promise<ExamGateResult> {
  const freeListed = isProfessionalFreeUser(uid, email);
  const walletSpend = aiWalletSpendEnabled();
  const quotaOn = professionalFreeQuotaEnabled();

  if (!quotaOn) {
    const gate = await gateProfessionalTurn(uid, email);
    if (!gate.allow) return gate;
    return { allow: true, uid, tier: gate.tier, isFreeListed: gate.isFreeListed, hasActivePass: gate.hasActivePass, freeQuestions: 0 };
  }

  const hasActivePass = await activePassFor(uid, freeListed, true);
  if (freeListed || hasActivePass) {
    return { allow: true, uid, tier: 'paid', isFreeListed: freeListed, hasActivePass, freeQuestions: 0 };
  }
  if (!uid) {
    return {
      allow: false,
      status: 401,
      body: { error: 'Please sign in to take a test. Every account gets free questions each day.', code: 'login_required', reason: 'login-required' },
    };
  }

  const freeLimit = professionalExamFreeDailyQuestions();
  const used = await professionalExamUsageStore.getTodayCount(uid);
  const split = splitExamQuestions(requested, used, freeLimit);
  const fitsFree = split.free > 0
    ? `You still have ${split.free} free question${split.free === 1 ? '' : 's'} today — a paper of ${split.free} or fewer is free.`
    : `Your ${freeLimit} free questions come back tomorrow.`;

  if (split.paid > 0) {
    if (!walletSpend) {
      return {
        allow: false,
        status: 402,
        body: { error: split.free > 0 ? fitsFree : `You've used your ${freeLimit} free exam questions for today. They reset tomorrow.`, code: 'exam_free_used', freeQuestionsLeft: split.free, examFreeDailyQuestions: freeLimit },
      };
    }
    const balanceInr = await balanceFor(uid);
    if (walletTooEmptyForTurn(balanceInr)) {
      return {
        allow: false,
        status: WALLET_EMPTY_STATUS,
        body: walletEmptyBody({ balanceInr, what: 'this paper', alternative: fitsFree }, { freeQuestionsLeft: split.free, examFreeDailyQuestions: freeLimit }),
      };
    }
  }
  return { allow: true, uid, tier: split.paid > 0 ? 'paid' : 'free', isFreeListed: false, hasActivePass: false, freeQuestions: split.free };
}

/**
 * What one delivered paper costs the student: how many of its questions spend the free allowance, and
 * the share of its real cost that is charged. PURE. Counted on what was DELIVERED, never on what was
 * asked — a paper that came back with 7 of 10 questions charges for 7, and one that came back empty
 * charges nothing and spends no free questions.
 */
export function examPaperCharge(delivered: number, freeQuestions: number): { freeUsed: number; billableFraction: number } {
  const d = Number.isFinite(delivered) && delivered > 0 ? Math.floor(delivered) : 0;
  if (d === 0) return { freeUsed: 0, billableFraction: 0 };
  const f = Number.isFinite(freeQuestions) && freeQuestions > 0 ? Math.floor(freeQuestions) : 0;
  const freeUsed = Math.min(d, f);
  return { freeUsed, billableFraction: (d - freeUsed) / d };
}

/** Record one consumed free message (only call after a genuinely-answered free-tier turn). Best-effort. */
export function burnFreeMessage(uid: string | null | undefined): void {
  if (uid) void professionalUsageStore.increment(uid);
}
