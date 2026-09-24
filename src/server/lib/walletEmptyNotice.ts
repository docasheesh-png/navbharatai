// WHAT A USER IS TOLD WHEN THEIR BALANCE RUNS OUT — one sentence, one place (admin 2026-09-22).
//
// Admin, verbatim: *"agar user ke pas balance khatam hai, to proper likh kar ana chahiye. this is paid
// service!!"* — and two things were wrong when that was said.
//
// 🔴 1. THE SENTENCE WAS A DRIFTED COPY. `professionals/passGate.ts`, `tools/toolGate.ts` and a
// third route each carried their own wording of the same refusal, and they had already
// drifted ("Add credit" / "Add credits", "balance is empty" / "credits are used up"). This repo has
// paid for that class four times over (`safeRelPath` ×4, `tagsOnLine` ×2, the HTML boot guard ×2,
// `PLAYWRIGHT_BROWSERS_PATH` ×2). One builder, every caller.
//
// 🔴 2. AND FOR A USER IN DEBT IT WAS SIMPLY FALSE. The refusal fires at `balanceInr <= 0`
// (`walletTooEmptyForTurn`), and a build may legitimately leave a wallet DOWN TO −₹50 before
// `WALLET_OVERDRAFT_FLOOR_INR` clamps it — a real one was found at **−₹506**. Telling that person
// *"your balance is empty"* is not a rounding of the truth: they top up ₹20, are refused again by the
// identical sentence, and have no way to learn that they needed ₹506 first. A paid service that
// cannot say what is owed is not asking for money, it is just saying no.
//
// So the notice now states the REAL number and, when the caller knows it, what the refused thing
// costs — the same honesty the build's own `Affordability` notice has always had, applied to the
// assistants and the tools that never got it.
//
// ⚠️ IT IS A MESSAGE BUILDER, NOT A GATE. The decision to refuse stays exactly where it was
// (`walletTooEmptyForTurn`), unchanged and still fail-open on an unreadable balance. Nothing here can
// allow or deny anything — which is why it is pure and why it may be called after the decision.
//
// 🔒 WHITE-LABEL LAW: no vendor, no model, no routing hint ever reaches this text. It names one
// balance, one price and one action.

/** The machine-readable code every empty-balance refusal carries. Clients switch on this, never on prose. */
export const WALLET_EMPTY_CODE = 'wallet_empty';

/** HTTP status for an empty-balance refusal — Payment Required, which is literally the case. */
export const WALLET_EMPTY_STATUS = 402;

function inr(n: number): string {
  // Two decimals, because a balance is money and ₹-0.4 rounded to ₹0 is how "empty" became a lie.
  return `₹${Math.abs(n).toFixed(2)}`;
}

export interface WalletEmptyNoticeInput {
  /** The balance the gate actually read. `null`/undefined means it could not be read — see below. */
  balanceInr?: number | null;
  /** What this one request would have cost, when the caller knows it. */
  priceInr?: number | null;
  /** What was refused, in the user's words: "this image", "this answer". Defaults to "this". */
  what?: string;
  /** An extra, caller-specific way out — e.g. the exam's free questions. Appended verbatim. */
  alternative?: string;
}

/**
 * The user-facing sentence. Three shapes, because three different things are true:
 *
 *  • **in debt** — names what was overspent, because that is the number that has to be cleared;
 *  • **exactly empty** — the ordinary case, and the wording production already used;
 *  • **unknown** — the balance could not be read, so it says so rather than inventing "empty".
 *
 * The unknown branch is defensive: the gates fail OPEN on an unreadable balance, so it should be
 * unreachable from them. It exists because a caller that reaches it must still not state a number
 * nobody measured — the same rule the billing law applies to an unmeasured provider.
 */
export function walletEmptyNotice(input: WalletEmptyNoticeInput = {}): string {
  const what = input.what?.trim() || 'this';
  const raw = input.balanceInr;
  const balance = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;

  const head = balance === null
    ? `Your balance could not be read, so ${what} was not run.`
    : balance < 0
      ? `You have spent ${inr(balance)} more than your balance, so ${what} could not run.`
      : `Your balance is empty, so ${what} could not run.`;

  // In debt, "add credit" alone is not actionable — it is why the same refusal can repeat after a
  // top-up. Name the figure that actually unblocks them.
  const action = balance !== null && balance < 0
    ? `Add more than ${inr(balance)} of credit to carry on.`
    : 'Add credit to carry on.';

  const price = typeof input.priceInr === 'number' && Number.isFinite(input.priceInr) && input.priceInr > 0
    ? ` ${what.charAt(0).toUpperCase()}${what.slice(1)} costs ${inr(input.priceInr)}.`
    : '';

  const alt = input.alternative?.trim() ? ` ${input.alternative.trim()}` : '';

  return `${head} NavBharatAI is pay-as-you-go — you only pay for what you actually use.${price} ${action}${alt}`;
}

/**
 * The whole refusal body, so a caller cannot ship the sentence without the code the clients read.
 *
 * `balanceInr` is echoed as a NUMBER for the UI to render, and `0` is used when the balance was
 * unreadable — matching what every caller already sent, and safe because the prose above says
 * plainly that it could not be read rather than claiming a zero.
 */
export function walletEmptyBody(
  input: WalletEmptyNoticeInput = {},
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    error: walletEmptyNotice(input),
    code: WALLET_EMPTY_CODE,
    reason: 'wallet-empty',
    balanceInr: typeof input.balanceInr === 'number' && Number.isFinite(input.balanceInr) ? input.balanceInr : 0,
    ...extra,
  };
}
