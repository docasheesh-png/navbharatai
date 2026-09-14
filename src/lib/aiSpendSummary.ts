// THE USER'S REAL AI SPEND — what NavBharatAI actually charged them, derived from their own wallet.
//
// 🔴 WHY THIS EXISTS (admin 2026-09-14, verbatim: "user ko ai call by provider ki jagah par total AI
// spend dikhna chahiye — jahan hamne (admin) user se app building me jo charge liya hai, wo show hona
// chahiye").
//
// The billing screen showed a row PER AI CALL, read from `ai_usage_logs`. Three things were wrong with
// that surface, and only the first is cosmetic:
//
//   1. It is the wrong QUESTION. `ai_usage_logs` is a per-provider-call engine log. A user does not buy
//      calls; they buy builds. The number they care about is what left their wallet.
//   2. Its money column could only ever be ZERO. It read `amount_deducted` / `output_tokens`, and
//      NEITHER is written any more — the streaming turn records no token counts at all, and
//      `estimated_provider_cost` was deliberately DELETED in the 2026-09-12 money audit ("a field whose
//      only value was a lie is not worth keeping"). So every row rendered `-₹0.0000`, for every user,
//      on every account, however much they had really been charged.
//   3. Those rows carry `providerName` and `modelName`, which the White-Label Law forbids ever reaching
//      an end user. (Fixed at the route in the same change — the browser is no longer sent them.)
//
// THE REAL CHARGE HAS ALWAYS BEEN IN THE WALLET LEDGER. `computeDebitedWallet` writes one `type:'usage'`
// entry per charge, carrying the exact tokens debited, the build it belongs to, and our own user-facing
// description. That is the authoritative record of what we took — it IS the balance movement, not a
// telemetry row that happens to sit beside it.
//
// 🔒 ₹ IS DERIVED FROM TOKENS, NEVER PARSED OUT OF THE DESCRIPTION. The debit itself computes
// `billedInr = tokens / TOKENS_PER_RUPEE`, so recomputing it here from the same field reproduces the
// charge exactly and cannot drift when the wording changes. The description is a label; the tokens are
// the money.
//
// 🔒 AND "WE COULD NOT READ IT" IS NOT "₹0". `ledgerAvailable: false` is a distinct outcome the screen
// must render as an honest failure. This is the lesson of the Live Metrics bug found four days ago: a
// dashboard of confident zeros, assembled entirely out of `?? 0` fallbacks over an auth failure, is
// worse than no dashboard — it answers a question it never actually asked.
//
// PURE. No imports beyond the shared money constant, no I/O, no React.

import { TOKENS_PER_RUPEE } from './walletPricing';

/** How a charge got made, in the user's terms — never a vendor, never a model. */
export type AiSpendKind = 'build' | 'assistant' | 'other';

export interface AiSpendRow {
  /** ISO timestamp as recorded on the ledger entry; '' when the entry carried none. */
  at: string;
  /** Our own user-facing text for this charge. White-label by construction — we author it. */
  label: string;
  /** The authoritative ₹ charged, derived from the tokens actually debited. */
  inr: number;
  /** Wallet tokens debited by this entry. */
  tokens: number;
  kind: AiSpendKind;
}

export interface AiSpendSummary {
  /**
   * FALSE means the wallet has no readable ledger — not that nothing was spent. The screen must say so
   * rather than print a zero, which is the whole point of separating this from `totalInr === 0`.
   */
  ledgerAvailable: boolean;
  /** Everything NavBharatAI has charged this wallet for AI work. */
  totalInr: number;
  /** The part of it spent building apps — the number the admin asked to headline. */
  buildInr: number;
  /** The part spent on the assistants (chat, Professionals, the AI tools). */
  assistantInr: number;
  /** Number of charges the total is made of, BEFORE the display cap below. */
  chargeCount: number;
  /** Newest first, capped for rendering. `chargeCount` is the honest total. */
  rows: AiSpendRow[];
}

const EMPTY: AiSpendSummary = {
  ledgerAvailable: false, totalInr: 0, buildInr: 0, assistantInr: 0, chargeCount: 0, rows: [],
};

/** Round to paise. Money is never carried at float precision into a rendered total. */
function paise(n: number): number {
  return Math.round(n * 100) / 100;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Which bucket a ledger entry belongs in.
 *
 * `buildRef` is stamped by the build settle and is the only positive evidence that a charge came from
 * building an app. `feature` is stamped by the assistant/tool spend zone. An entry with neither is
 * 'other' rather than being guessed into a bucket — a wrong attribution on a money screen is worse
 * than an unattributed one.
 */
export function spendKind(entry: Record<string, unknown>): AiSpendKind {
  if (str(entry.buildRef).trim()) return 'build';
  if (str(entry.feature).trim()) return 'assistant';
  return 'other';
}

/**
 * The user's real AI spend, from their own wallet ledger.
 *
 * Accepts the raw wallet document exactly as `/api/wallet/:userId` returns it — every field is treated
 * as untrusted, because this renders money and a malformed entry must degrade rather than throw.
 */
export function aiSpendSummary(wallet: unknown, opts?: { maxRows?: number }): AiSpendSummary {
  if (!wallet || typeof wallet !== 'object') return EMPTY;
  const ledger = (wallet as Record<string, unknown>).walletLedger;
  // An ABSENT ledger and an EMPTY one are different facts. A wallet that exists with no charges yet is
  // a true "₹0 so far"; a wallet we could not read is not.
  if (!Array.isArray(ledger)) return EMPTY;

  const maxRows = Number.isFinite(opts?.maxRows) && (opts!.maxRows as number) > 0
    ? Math.floor(opts!.maxRows as number)
    : 25;

  const rows: AiSpendRow[] = [];
  let buildInr = 0;
  let assistantInr = 0;
  let otherInr = 0;

  for (const raw of ledger) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    if (entry.type !== 'usage') continue; // credits, top-ups and purchases are not AI spend

    // A usage entry debits, so its amount is negative. Take the magnitude and ignore anything that is
    // not a finite number — a corrupt row must not poison the total.
    const amount = Number(entry.amountCoinsOrTokens);
    if (!Number.isFinite(amount)) continue;
    const tokens = Math.abs(amount);
    // A sub-token charge legitimately debits 0 tokens and is carried to the next one; it belongs in the
    // count (the user was told about it) but contributes no rupees, which is exactly right.
    const inr = TOKENS_PER_RUPEE > 0 ? tokens / TOKENS_PER_RUPEE : 0;

    const kind = spendKind(entry);
    if (kind === 'build') buildInr += inr;
    else if (kind === 'assistant') assistantInr += inr;
    else otherInr += inr;

    rows.push({
      at: str(entry.timestamp),
      label: str(entry.description) || 'NavBharatAI usage',
      inr: paise(inr),
      tokens,
      kind,
    });
  }

  // Newest first. The ledger is appended in order, so reversing is both correct and stable for entries
  // that share a timestamp — sorting by the string would reorder same-second charges arbitrarily.
  rows.reverse();

  return {
    ledgerAvailable: true,
    totalInr: paise(buildInr + assistantInr + otherInr),
    buildInr: paise(buildInr),
    assistantInr: paise(assistantInr),
    chargeCount: rows.length,
    rows: rows.slice(0, maxRows),
  };
}

/** ₹ formatted the way every other money line on the billing screen is. */
export function formatInr(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
