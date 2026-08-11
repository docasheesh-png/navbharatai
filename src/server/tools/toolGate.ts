// The Other AI tools' pass/quota gate (admin 2026-07-27).
//
// WHY: the LLM-backed tools under "Other AI" — App Debugger, AI Debugger, Design suggest/palette,
// Screenshot→Code, Image Gen — call the platform's own AI on NavBharatAI's account, with no metering
// and no revenue. Everything else in that section (Minifier, Diff, Versioning, Test Runner, APK
// Builder, CI/CD, SEO, Components, Design System, Dark Mode, Monetize, Nav App Store) is deterministic
// and costs nothing to run, so it stays free and unmetered — metering it would be friction with no
// saving behind it.
//
// ONE BILLING MODEL, NOT TWO (updated 2026-08-10, "pass system hata do"). This used to ride the same
// ₹99/month Professional Pass as the professionals so the customer made one subscription decision for
// both. The Pass is gone — it was a second billing model competing with the one the platform actually
// adopted (THE ONE-WALLET LAW: every AI draws on the same balance, and the price of the thing IS the
// limit) — so what is left here is the free daily allowance and the shared free-list. The pass reads
// below are inert: nothing can grant a pass any more, so `hasActivePass` is false for every real user.
//
// THE DECISION ITSELF IS NOT REIMPLEMENTED. `decideProfessionalAccess` is already pure and exhaustively
// tested, and the rules here are identical (flag off → allow; free-list and pass → unlimited; signed
// out → sign in; otherwise a daily allowance). A second copy would drift, so this only supplies
// different facts to the same decision.

import { decideProfessionalAccess } from '../professionals/access';
import {
  professionalPaidEnabled, isProfessionalFreeUser,
} from '../professionals/professionalPaid';
import { professionalPassStore } from '../professionals/ProfessionalPassStore';
import { toolUsageStore, type ToolBucket } from './ToolUsageStore';
import { aiWalletSpendEnabled, chargeForAiTurns } from '../lib/aiTurnCharge';
import { currentAiSpend } from '../lib/aiSpendZone';
import { usdInrRate } from '../lib/UsdInrRate';
import { walletTooEmptyForTurn } from '../professionals/passGate';
import { readWalletBalanceInr, firestoreWalletReader } from '../AgentV3/WalletBalance';
import { getServerDb } from '../lib/serverDb';

export type { ToolBucket };

/**
 * Daily free allowance for the AI-backed tools (App Debugger, AI Debugger, Design advisor,
 * Screenshot→Code), shared across all of them. Default 5 — these run on the free cheap chain, so the
 * allowance is about bounding abuse, not about cost. Env-tunable without a deploy.
 */
export function aiToolFreeDailyLimit(): number {
  const n = Number(process.env.AI_TOOL_FREE_DAILY_LIMIT);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5;
}

/**
 * Daily free allowance for image generation. Default 3, deliberately tighter than the rest: this is the
 * one Other AI action with a real per-image provider charge, and the route's own rate limiter allows 40
 * an hour — enough for a single account to run up a genuine bill in an afternoon.
 */
export function imageFreeDailyLimit(): number {
  const n = Number(process.env.AI_IMAGE_FREE_DAILY_LIMIT);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3;
}

/**
 * Daily image cap for an account that is otherwise unlimited here. It existed because unlimited chat
 * was affordable under the Pass and unlimited image generation never was. With the Pass removed
 * nothing reaches this in production; it is kept so the cap survives if an unlimited tier ever returns.
 */
export function imagePassDailyLimit(): number {
  const n = Number(process.env.AI_IMAGE_PASS_DAILY_LIMIT);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 25;
}

export function dailyLimitFor(bucket: ToolBucket): number {
  return bucket === 'image' ? imageFreeDailyLimit() : aiToolFreeDailyLimit();
}

/** What a tool route needs back: run it (and whether to burn a free action), or a ready-to-send block. */
export type ToolGateResult =
  | {
      allow: true; countsAgainstFree: boolean; remainingFree?: number; uid: string | null; tier: 'free' | 'paid';
      /** Carried so the route can charge the wallet without re-deriving (or re-reading) either fact. */
      isFreeListed: boolean; hasActivePass: boolean;
    }
  | { allow: false; status: number; body: Record<string, unknown> };

/** The human name each bucket is refused by, so the paywall message names the thing the user just tried. */
const BUCKET_LABEL: Record<ToolBucket, string> = {
  ai_tool: 'AI tool actions',
  image: 'image generations',
};

/**
 * Decide access for one Other AI tool action. `uid`/`email` MUST be the server-verified identity.
 *
 * The pass branches are dead weight in production since the Pass was removed (2026-08-10) — nothing
 * can grant one — but they are left intact rather than ripped out mid-flight: this function guards
 * money on every Other AI action, and the honest sequencing is to remove the pass STORE and its
 * grant path first (a separate change), then delete these branches once nothing can set them.
 */
export async function gateToolAction(
  uid: string | null,
  email: string | null,
  bucket: ToolBucket,
): Promise<ToolGateResult> {
  const freeListed = isProfessionalFreeUser(uid, email);
  const walletSpend = aiWalletSpendEnabled();
  // Read the pass at most ONCE and share it between the two gates — it answers "unlimited access?" for
  // the paywall and "already paid for, do not charge the wallet" for the spend gate.
  const needsPass = !!uid && !freeListed && (walletSpend || professionalPaidEnabled());
  const hasActivePass = needsPass
    ? (await professionalPassStore.getStatus(uid as string).catch(() => ({ active: false }))).active
    : false;

  // ONE WALLET (admin 2026-08-01): a tool action costs NavBharatAI the same kind of money a build or a
  // professional answer does, so it draws on the same balance and an empty one is refused before any
  // provider is called. Independent of the Pass paywall — the two answer different questions. Entirely
  // inert (not even a Firestore read) while AI_WALLET_SPEND is off, which is the default.
  if (walletSpend && uid && !freeListed && !hasActivePass) {
    const balanceInr = await readWalletBalanceInr(firestoreWalletReader(getServerDb() as any), uid).catch(() => null);
    if (walletTooEmptyForTurn(balanceInr)) {
      return {
        allow: false,
        status: 402,
        body: {
          // ADMIN 2026-08-10 ("pass system hata do"): the Pass offer that used to close this sentence
          // was a LIVE LIE — this branch runs today (AI_WALLET_SPEND on since 2026-08-08) while the
          // Pass has never been sellable, so an empty-balance user was sent to buy something that does
          // not exist. Adding credit is the only instruction that actually resolves their block.
          error: 'Your balance is empty. Add credit to keep using NavBharatAI — you only pay for what you actually use.',
          code: 'wallet_empty',
          reason: 'wallet-empty',
          bucket,
          balanceInr: balanceInr ?? 0,
        },
      };
    }
  }

  if (!professionalPaidEnabled()) {
    // Flag off → today's quota behaviour exactly: allow, meter nothing.
    return { allow: true, countsAgainstFree: false, uid, tier: 'paid', isFreeListed: freeListed, hasActivePass };
  }

  // Images are capped even WITH a pass; every other bucket is unlimited for a pass holder.
  const passIsUnlimitedHere = hasActivePass && bucket !== 'image';
  const dailyLimit = hasActivePass && bucket === 'image' ? imagePassDailyLimit() : dailyLimitFor(bucket);
  const needsCount = !!uid && !freeListed && !passIsUnlimitedHere;
  const usedToday = needsCount ? await toolUsageStore.getTodayCount(uid!, bucket) : 0;

  const decision = decideProfessionalAccess({
    enabled: true,
    signedIn: !!uid,
    isFreeListed: freeListed,
    hasActivePass: passIsUnlimitedHere,
    usedToday,
    freeDailyLimit: dailyLimit,
  });

  if (decision.action === 'allow') {
    const tier: 'free' | 'paid' = decision.reason === 'within-free-quota' && !hasActivePass ? 'free' : 'paid';
    return {
      allow: true, countsAgainstFree: decision.countsAgainstFree, remainingFree: decision.remainingFree, uid, tier,
      isFreeListed: freeListed, hasActivePass,
    };
  }

  const login = decision.reason === 'login-required';
  const label = BUCKET_LABEL[bucket];
  return {
    allow: false,
    status: login ? 401 : 402,
    body: {
      error: login
        ? `Please sign in to use this tool. New users get free ${label} every day.`
        // One message for both cases now (admin 2026-08-10) — with the Pass gone there is no longer a
        // "pass holder vs everyone else" distinction to draw here, and no product to point anyone at.
        : `You've used your ${dailyLimit} free ${label} for today. They reset tomorrow.`,
      code: login ? 'login_required' : 'tool_paywall',
      reason: decision.reason,
      bucket,
      remainingFree: 0,
      dailyLimit,
    },
  };
}

/** Record one consumed free action. Only call after the action genuinely succeeded. Best-effort. */
export function burnToolAction(uid: string | null | undefined, bucket: ToolBucket): void {
  if (uid) void toolUsageStore.increment(uid, bucket);
}

/**
 * Charge the wallet for everything the model did during THIS tool action. Call it beside
 * `burnToolAction`, at the point the route has already decided the action genuinely succeeded.
 *
 * The cost comes from the surrounding spend zone (aiSpendZone.ts), so a tool that fans out over batches
 * is billed for ALL its model calls rather than one of them, and a tool that adds a model call later is
 * billed correctly without touching this. A route that failed never reaches here, which keeps the
 * platform's standing rule intact: a user is not charged for something that did not work.
 *
 * Fire-and-forget on purpose — a money-path failure must never cost the user their result.
 */
export function chargeToolAction(gate: Extract<ToolGateResult, { allow: true }>): void {
  void chargeForAiTurns(
    getServerDb() as any,
    { userId: gate.uid, isFreeListed: gate.isFreeListed, hasActivePass: gate.hasActivePass },
    currentAiSpend(),
    usdInrRate(),
    Date.now(),
  );
}
