// "YOU HAVE USED 80% OF YOUR TRAFFIC" — the warning the plan agreement already promises.
//
// The agreement a user ticks before paying says, in its own words: *"You can see your usage in the
// app at any time, so this is never a surprise."* A screen they have to go and look at is half of
// that promise; the half that actually prevents a surprise is being TOLD before the charge, not after
// it. Without this, the first a user hears about going over is a rupee figure in their ledger.
//
// 🔒 THE DEDUPE IS THE WHOLE DESIGN, and it is `hostingPlan.ts`'s `remindedFor` pattern rather than a
// new idea: a threshold is keyed on the PLAN PERIOD it fired for, so a new period resets it naturally
// and nothing has to be cleaned up on renewal. CLAUDE.md's alert-noise law — one message per episode,
// two at most — is what makes this non-negotiable: a daily job with no memory would send the same
// "you are at 80%" every single day for three weeks, which is how a useful warning becomes something
// people filter.
//
// 🔴 THE LARGEST REACHED THRESHOLD FIRES, NOT THE SMALLEST — the MIRROR of the expiry reminders, for
// exactly the same reason, and it is worth stating because copying that file blindly would get it
// backwards. There, the windows count DOWN to expiry and the smallest reached one is the only
// accurate description ("1 day left", not "5 days left"). Here the thresholds count UP, so a user who
// jumps from 40% to 100% in one day must be told they are AT the limit — being told "you have used
// half your traffic" when the wallet is about to be charged is the false statement. Every smaller
// threshold is burned in the same write, because it can no longer be said truthfully.
//
// PURE. No clock beyond what the caller passes, no store, no I/O.

/**
 * Where a user is told. 100 is included deliberately: crossing the allowance is the moment money
 * starts moving, and it is the one message that must never be missed.
 */
export const USAGE_WARN_PERCENTS = [50, 80, 100] as const;

export type UsageWarnPercent = typeof USAGE_WARN_PERCENTS[number];

/** Which meter this warning is about. A user has two allowances and they are counted separately. */
export type UsageMeterKind = 'frontend' | 'backend';

export interface UsageWarningDecision {
  warn: boolean;
  percent: UsageWarnPercent | null;
  /** The `warnedFor` map to persist — every fired threshold AND every smaller one. */
  warnedFor: Record<string, string>;
  /** What to tell the user. '' when nothing fires. Plain, no jargon, no vendor names. */
  message: string;
}

const NOTHING = (warnedFor: Record<string, string>): UsageWarningDecision =>
  ({ warn: false, percent: null, warnedFor, message: '' });

/** `frontend:80` — the meter is part of the key, so one allowance's warning cannot silence the other's. */
export function warnKey(meter: UsageMeterKind, percent: number): string {
  return `${meter}:${Math.round(percent)}`;
}

function describe(meter: UsageMeterKind): { what: string; noun: string } {
  return meter === 'frontend'
    ? { what: 'visitor traffic', noun: 'your published apps' }
    : { what: 'server traffic', noun: 'the apps that run a server' };
}

/**
 * Should this user hear about their usage right now?
 *
 * @param usedGb      GB used in this period so far, INCLUDING today.
 * @param includedGb  What the plan sold them. A non-positive allowance never warns — there is no
 *                    percentage of zero, and a "you have used Infinity%" message is worse than none.
 * @param periodStart The plan period these totals belong to. Stored as the value, so a renewal makes
 *                    every key stale at once and the thresholds arm themselves again.
 * @param warnedFor   What has already been said this period.
 */
export function decideUsageWarning(input: {
  usedGb: number;
  includedGb: number;
  meter: UsageMeterKind;
  periodStart: string;
  warnedFor?: Record<string, string> | null;
  /** ₹ per GB above the allowance, so the 100% message can quote the real rate. */
  overageInrPerGb?: number;
}): UsageWarningDecision {
  const warnedFor = { ...(input.warnedFor ?? {}) };
  const used = Number(input.usedGb);
  const included = Number(input.includedGb);
  if (!Number.isFinite(used) || used < 0) return NOTHING(warnedFor);
  if (!Number.isFinite(included) || included <= 0) return NOTHING(warnedFor);
  if (!input.periodStart) return NOTHING(warnedFor);

  const pct = (used / included) * 100;
  // Largest reached first — see the header. `reached` is empty below 50%, which is most days.
  const reached = [...USAGE_WARN_PERCENTS].filter((p) => pct >= p).sort((a, b) => b - a);
  if (reached.length === 0) return NOTHING(warnedFor);

  const percent = reached.find((p) => warnedFor[warnKey(input.meter, p)] !== input.periodStart);
  if (percent === undefined) return NOTHING(warnedFor);

  // Burn the fired threshold and every smaller one — none of them can be said truthfully now.
  for (const p of USAGE_WARN_PERCENTS) {
    if (p <= percent) warnedFor[warnKey(input.meter, p)] = input.periodStart;
  }

  const { what, noun } = describe(input.meter);
  const usedStr = used < 10 ? used.toFixed(2) : used.toFixed(1);
  let message: string;
  if (percent === 100) {
    const rate = Number(input.overageInrPerGb);
    const rateStr = Number.isFinite(rate) && rate > 0 ? ` Beyond this, extra traffic is ₹${rate} per GB from your wallet.` : '';
    message = `${noun[0].toUpperCase()}${noun.slice(1)} have now used all ${included} GB of ${what} included in your plan `
      + `for this period (${usedStr} GB).${rateStr} Your apps stay online.`;
  } else {
    message = `${noun[0].toUpperCase()}${noun.slice(1)} have used ${percent}% of the ${included} GB of ${what} `
      + `included in your plan for this period (${usedStr} GB). Nothing to do — this is just so it is never a surprise.`;
  }
  return { warn: true, percent, warnedFor, message };
}
