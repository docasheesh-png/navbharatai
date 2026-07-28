// The Other AI tools' pass/quota gate (admin 2026-07-27).
//
// WHY: the LLM-backed tools under "Other AI" — App Debugger, AI Debugger, Design suggest/palette,
// Screenshot→Code, Image Gen — call the platform's own AI on NavBharatAI's account, with no metering
// and no revenue. Everything else in that section (Minifier, Diff, Versioning, Test Runner, APK
// Builder, CI/CD, SEO, Components, Design System, Dark Mode, Monetize, Nav App Store) is deterministic
// and costs nothing to run, so it stays free and unmetered — metering it would be friction with no
// saving behind it.
//
// ONE SUBSCRIPTION, NOT TWO. This deliberately rides the SAME master switch, the SAME Professional Pass
// and the SAME free-list as the professionals: the customer makes one decision ("₹99/month for the
// assistants and the tools") instead of juggling two products. Only the counter and the daily
// allowance are separate — see ToolUsageStore for why.
//
// THE DECISION ITSELF IS NOT REIMPLEMENTED. `decideProfessionalAccess` is already pure and exhaustively
// tested, and the rules here are identical (flag off → allow; free-list and pass → unlimited; signed
// out → sign in; otherwise a daily allowance). A second copy would drift, so this only supplies
// different facts to the same decision.

import { decideProfessionalAccess } from '../professionals/access';
import {
  professionalPaidEnabled, professionalPassPriceInr, professionalPassDays, isProfessionalFreeUser,
} from '../professionals/professionalPaid';
import { professionalPassStore } from '../professionals/ProfessionalPassStore';
import { toolUsageStore, type ToolBucket } from './ToolUsageStore';

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

/** Monthly image cap for a Pass holder — unlimited chat is affordable, unlimited image generation is not. */
export function imagePassDailyLimit(): number {
  const n = Number(process.env.AI_IMAGE_PASS_DAILY_LIMIT);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 25;
}

export function dailyLimitFor(bucket: ToolBucket): number {
  return bucket === 'image' ? imageFreeDailyLimit() : aiToolFreeDailyLimit();
}

/** What a tool route needs back: run it (and whether to burn a free action), or a ready-to-send block. */
export type ToolGateResult =
  | { allow: true; countsAgainstFree: boolean; remainingFree?: number; uid: string | null; tier: 'free' | 'paid' }
  | { allow: false; status: number; body: Record<string, unknown> };

/** The human name each bucket is refused by, so the paywall message names the thing the user just tried. */
const BUCKET_LABEL: Record<ToolBucket, string> = {
  ai_tool: 'AI tool actions',
  image: 'image generations',
};

/**
 * Decide access for one Other AI tool action. `uid`/`email` MUST be the server-verified identity.
 *
 * A Pass holder is unlimited on `ai_tool` but still capped on `image`, because unlimited image
 * generation is the one promise the ₹99 price genuinely cannot carry. That cap is metered on the same
 * counter, so a Pass holder's images are counted too.
 */
export async function gateToolAction(
  uid: string | null,
  email: string | null,
  bucket: ToolBucket,
): Promise<ToolGateResult> {
  if (!professionalPaidEnabled()) {
    // Flag off → today's behaviour exactly: allow, meter nothing, touch no Firestore.
    return { allow: true, countsAgainstFree: false, uid, tier: 'paid' };
  }
  const freeListed = isProfessionalFreeUser(uid, email);
  const hasActivePass = !!uid && !freeListed ? (await professionalPassStore.getStatus(uid)).active : false;

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
    return { allow: true, countsAgainstFree: decision.countsAgainstFree, remainingFree: decision.remainingFree, uid, tier };
  }

  const login = decision.reason === 'login-required';
  const label = BUCKET_LABEL[bucket];
  return {
    allow: false,
    status: login ? 401 : 402,
    body: {
      error: login
        ? `Please sign in to use this tool. New users get free ${label} every day.`
        : hasActivePass
          ? `You've used your ${dailyLimit} ${label} for today. This one resets tomorrow.`
          : `You've used your ${dailyLimit} free ${label} for today. Get the Professional Pass for unlimited access.`,
      code: login ? 'login_required' : 'tool_paywall',
      reason: decision.reason,
      bucket,
      remainingFree: 0,
      dailyLimit,
      ...(hasActivePass ? {} : { passPriceInr: professionalPassPriceInr(), passDays: professionalPassDays() }),
    },
  };
}

/** Record one consumed free action. Only call after the action genuinely succeeded. Best-effort. */
export function burnToolAction(uid: string | null | undefined, bucket: ToolBucket): void {
  if (uid) void toolUsageStore.increment(uid, bucket);
}
