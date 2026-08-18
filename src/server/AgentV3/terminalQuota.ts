// A2 — the daily free allowance for the real Terminal (ROADMAP §8A / §8F.1).
//
// THE DECISION BEHIND IT (admin, 2026-08-18, asked and answered because it was theirs to make): a
// user-facing shell holds a BILLED E2B VM (~₹7/hour, measured), and today sandbox time is charged to
// the user only for BUILD seconds — terminal time is absorbed by NavBharatAI. Of the three options put
// to the admin (bill it like build time · keep it free with a daily cap · paid tiers only), they chose
// **free with a 30-minute daily cap**, which is the right call: opening a terminal should not feel
// expensive, and the cap is what stops an idle tab — or a deliberate abuser — from running up hours of
// VM time on our account.
//
// 🔒 WHY A CAP AND NOT TRUST. An uncapped shell on our own billing is an invitation: one account
// leaving a terminal open around the clock costs ~₹5,000/month, and a miner costs whatever they like.
// The cap converts an unbounded liability into a known, small one.
//
// Pure — the arithmetic and the decision, so the limit is a test rather than something to observe in
// production billing.

/** Default free terminal minutes per user per day. Env-tunable without a deploy. */
export const DEFAULT_TERMINAL_DAILY_MINUTES = 30;

/**
 * Longest single stretch we will add for one accrual tick. A tick should be seconds; anything much
 * larger means the process slept, a request was delayed, or a clock moved — and charging the user for
 * wall time nobody spent in a terminal would be exactly the invented number the billing law forbids.
 */
export const MAX_ACCRUAL_SECONDS = 120;

/**
 * The daily allowance in seconds. An explicit `AGENTV3_TERMINAL_DAILY_MINUTES=0` disables the terminal.
 *
 * ⚠️ AN EMPTY VALUE MEANS UNSET, NOT ZERO. `Number('')` is 0, which is finite and non-negative — so the
 * obvious implementation turns a key set with no value in Cloud Run (an easy thing to do by accident)
 * into a silent, total shutdown of the terminal for every user, with nothing in the logs to explain it.
 * Only a deliberate "0" switches it off. Caught by its own test.
 */
export function terminalDailyLimitSeconds(): number {
  const raw = String(process.env.AGENTV3_TERMINAL_DAILY_MINUTES ?? '').trim();
  if (!raw) return DEFAULT_TERMINAL_DAILY_MINUTES * 60;
  const n = Number(raw);
  const minutes = Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_TERMINAL_DAILY_MINUTES;
  return minutes * 60;
}

export interface TerminalAccessInput {
  /** Seconds already used today (IST day). */
  usedSeconds: number;
  limitSeconds: number;
  /** Admin/test accounts on AGENTV3_FREE_LIST — never metered, exactly as everywhere else. */
  unlimited?: boolean;
}

export interface TerminalAccess {
  allowed: boolean;
  remainingSeconds: number;
  /** '' when allowed and there is nothing worth saying. Plain language; never a raw number of seconds. */
  message: string;
  /** True when the user is close enough that a warning is honest rather than nagging. */
  warn: boolean;
}

/**
 * May this user open (or keep) a terminal right now?
 *
 * The refusal names the real reason and when it lifts. A bare "limit reached" would leave someone
 * staring at a dead button with no idea whether it is broken or deliberate — which is the same dead-end
 * the Apple sign-in bug produced, and the reason that fix exists. Pure.
 */
export function decideTerminalAccess(input: TerminalAccessInput): TerminalAccess {
  const limit = Math.max(0, Math.floor(input.limitSeconds || 0));
  const used = Math.max(0, Math.floor(input.usedSeconds || 0));

  if (input.unlimited) return { allowed: true, remainingSeconds: Number.POSITIVE_INFINITY, message: '', warn: false };
  if (limit <= 0) {
    return { allowed: false, remainingSeconds: 0, warn: false, message: 'The terminal is not available on this account.' };
  }

  const remaining = Math.max(0, limit - used);
  if (remaining <= 0) {
    return {
      allowed: false,
      remainingSeconds: 0,
      warn: false,
      message: `You've used your ${Math.round(limit / 60)} free terminal minutes for today. They reset tomorrow — your app and files are not affected.`,
    };
  }

  // Warn in the last five minutes: early enough to finish what you were doing, late enough that it is
  // real news rather than a banner people learn to ignore.
  const warn = remaining <= 5 * 60;
  return {
    allowed: true,
    remainingSeconds: remaining,
    warn,
    message: warn ? `About ${Math.max(1, Math.round(remaining / 60))} minute(s) of free terminal time left today.` : '',
  };
}

/**
 * How many seconds one accrual tick should add.
 *
 * Clamped at both ends: a negative or non-finite gap (a clock change, a bad timestamp) adds ZERO rather
 * than a wild number, and a gap longer than MAX_ACCRUAL_SECONDS is capped — the user was not sitting in
 * a terminal for the hour the server spent asleep, and charging them for it would be an invented
 * measurement. Pure.
 */
export function accrualSeconds(lastAccruedAt: number, now: number): number {
  if (!Number.isFinite(lastAccruedAt) || !Number.isFinite(now)) return 0;
  const gap = Math.floor((now - lastAccruedAt) / 1000);
  if (gap <= 0) return 0;
  return Math.min(gap, MAX_ACCRUAL_SECONDS);
}

/** The status line the UI shows. '' when there is nothing true worth saying. Pure. */
export function terminalQuotaLine(access: TerminalAccess): string {
  if (!access.allowed) return access.message;
  return access.warn ? access.message : '';
}
