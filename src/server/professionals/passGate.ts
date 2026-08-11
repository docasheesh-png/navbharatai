// Shared Professional Pass gate — the ONE place both the config-driven professional route and the
// bespoke Doctor AI (SDA) route enforce the pass/quota gate, so "Doctor AI = same as all professionals"
// (admin 2026-07-15) can never drift between the two. FLAG OFF ⇒ always allow (today's behaviour, zero
// extra Firestore reads). FLAG ON ⇒ free-list & active-pass are unlimited; anonymous callers must sign
// in; everyone else gets professionalFreeDailyLimit() free messages/day (shared across ALL professionals
// AND Doctor AI). Returns the model tier for an allowed turn, or a ready-to-send block payload.

import { decideProfessionalAccess } from './access';
import {
  professionalPaidEnabled, professionalFreeDailyLimit, isProfessionalFreeUser,
} from './professionalPaid';
import { professionalPassStore } from './ProfessionalPassStore';
import { professionalUsageStore } from './ProfessionalUsageStore';
import { aiWalletSpendEnabled } from '../lib/aiTurnCharge';
import { readWalletBalanceInr, firestoreWalletReader } from '../AgentV3/WalletBalance';
import { getServerDb } from '../lib/serverDb';

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
    }
  | { allow: false; status: number; body: Record<string, unknown> };

/** Decide access + model tier for one professional/Doctor-AI turn. `uid`/`email` MUST be the server-
 *  verified identity (never a client-claimed body field). */
export async function gateProfessionalTurn(uid: string | null, email: string | null): Promise<PassGateResult> {
  const freeListed = isProfessionalFreeUser(uid, email);
  const walletSpend = aiWalletSpendEnabled();
  // The pass is read at most ONCE per turn and shared by both gates below — it decides "unlimited
  // access" for the paywall AND "already paid for, do not charge the wallet" for the spend gate.
  const needsPass = !!uid && !freeListed && (walletSpend || professionalPaidEnabled());
  const hasActivePass = needsPass
    ? (await professionalPassStore.getStatus(uid as string).catch(() => ({ active: false }))).active
    : false;

  // ONE WALLET (admin 2026-08-01). When AI spending is on, every assistant draws from the SAME balance
  // as a build, so an empty wallet is refused here — before any provider is called. This runs
  // independently of the Pass paywall below: the two answer different questions ("has this user paid for
  // unlimited access?" vs "does this user have any credit left at all?"), and the wallet promise should
  // not require the paywall to be switched on. Entirely inert — not even a Firestore read — while the
  // flag is off, which is the default.
  if (walletSpend && uid && !freeListed && !hasActivePass) {
    const balanceInr = await readWalletBalanceInr(firestoreWalletReader(getServerDb() as any), uid).catch(() => null);
    if (walletTooEmptyForTurn(balanceInr)) {
      return {
        allow: false,
        status: 402,
        body: {
          // ADMIN 2026-08-10 ("pass system hata do"): this used to end "…or get the Professional Pass
          // for unlimited access to every professional." That sentence was a LIVE LIE — this branch is
          // reachable today (AI_WALLET_SPEND has been on since 2026-08-08) while the Pass has never
          // been sellable (PROFESSIONAL_PAID_ENABLED defaults off, and it is not set in Cloud Run), so
          // a user with an empty balance was pointed at a product that cannot be bought. One honest
          // instruction is worth more than two, and adding credit is the only thing that actually works.
          error: 'Your balance is empty. Add credit to keep using NavBharatAI — you only pay for what you actually use.',
          code: 'wallet_empty',
          reason: 'wallet-empty',
          balanceInr: balanceInr ?? 0,
        },
      };
    }
  }

  if (!professionalPaidEnabled()) {
    // Flag off → today's behaviour: full paid-quality chain, no metering.
    return { allow: true, countsAgainstFree: false, uid, tier: 'paid', isFreeListed: freeListed, hasActivePass };
  }
  const freeDailyLimit = professionalFreeDailyLimit();
  const usedToday = !!uid && !freeListed && !hasActivePass ? await professionalUsageStore.getTodayCount(uid) : 0;
  const decision = decideProfessionalAccess({
    enabled: true, signedIn: !!uid, isFreeListed: freeListed, hasActivePass, usedToday, freeDailyLimit,
  });
  if (decision.action === 'allow') {
    // Model tier: an active Pass (or the admin free-list) → the full paid chain; a within-quota free
    // user → the free chain (GLM → Vertex only). This is what makes "free = cheap models" real.
    const tier: ProfessionalTier = decision.reason === 'within-free-quota' ? 'free' : 'paid';
    return {
      allow: true, countsAgainstFree: decision.countsAgainstFree, remainingFree: decision.remainingFree, uid, tier,
      isFreeListed: freeListed, hasActivePass,
    };
  }
  const login = decision.reason === 'login-required';
  return {
    allow: false,
    status: login ? 401 : 402,
    body: {
      error: login
        ? 'Please sign in to use the Professionals. New users get free messages every day.'
        // No upsell here any more (admin 2026-08-10). The only thing that ever unblocked this was the
        // Pass, and the Pass is gone — so the message says the one true thing left: when it comes back.
        : `You've used your ${freeDailyLimit} free messages for today. They reset tomorrow.`,
      code: login ? 'login_required' : 'professional_paywall',
      reason: decision.reason,
      remainingFree: 0,
      freeDailyLimit,
    },
  };
}

/** Record one consumed free message (only call after a genuinely-answered free-tier turn). Best-effort. */
export function burnFreeMessage(uid: string | null | undefined): void {
  if (uid) void professionalUsageStore.increment(uid);
}
