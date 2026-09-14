// WHO IS A PAYING USER? One answer, for both admin build-report lists (admin 2026-09-14).
//
// The admin asked for the paid/free filter on BOTH lists, and defined it in the same breath:
//   *"jis user ne real ₹ se token purchase kiye hai, woh paid user hai!!"*
//
// 🔴 THAT IS NOT WHAT THE EXISTING FILTER MEANT, and the difference is not academic. The inbox's
// `tier` came from `classifyReportTier(billing.userTier)` — a string describing how THAT BUILD was
// routed. `freeTierBuildActive` is set by feature flags and, in routes/agentv3.ts, by the user simply
// CHOOSING the Weak tier:
//
//     if (!freeTierBuildActive && powerSpecResolved.cheapOnly && …) freeTierBuildActive = true;
//
// So a customer who has paid ₹500 and picks Weak was recorded as *"free (welcome bonus — cheap
// engines)"* and shown in the admin list as **Free**. Filtering for "my paying users" would have
// hidden a real customer. This module asks the account instead.
//
// 🔑 `totalMoneySpent` is the field, and it is the only one: exactly ONE writer increments it —
// `computeCreditedWallet` on a verified purchase — while the welcome bonus, the weekly gift, coupons
// and admin adjustments all credit through `mirroredCreditPatch(…, 'gift')`, which never touches it.
// A gifted balance therefore can never make somebody look like a customer.
//
// Pure, so the meaning is test-locked and cannot drift between the two lists that read it.

import { hasEverPaid } from '../AgentV3/FreeTierBuildRouting';

/** What the admin lists filter by. */
export type AccountTier = 'paid' | 'free' | 'admin' | 'unknown';

/** 'all' plus the four above — the filter control's own vocabulary. */
export type AccountTierFilter = 'all' | AccountTier;

/** The wallet fields this decision reads. Everything else in that document is irrelevant here. */
export interface TierWallet {
  totalMoneySpent?: unknown;
}

/**
 * The tier of ONE account. Pure.
 *
 * Order matters and each step is a different question:
 *  1. ANONYMOUS — no account at all, so "has this person paid?" has no answer. `unknown`, never free.
 *  2. FREE-LIST — the admin/tester emails, whose builds are deliberately not billed. Naming them
 *     `paid` or `free` would put our own test builds in one of the buckets the admin filters by to
 *     judge real users.
 *  3. PAID — `totalMoneySpent > 0`. The admin's definition, verbatim.
 *  4. FREE — a real account that has never purchased. This is the ONLY case that may be called free.
 *  5. UNKNOWN — a uid with no wallet record. We have not seen the account, so we have not seen that
 *     they never paid. An unknown is never folded into free: doing so would inflate the exact number
 *     ("how many of my users have never paid?") the filter exists to answer.
 */
export function accountTier(input: {
  anonymous?: boolean;
  freeListed?: boolean;
  wallet?: TierWallet | null | undefined;
  /** True when a wallet record was genuinely found. Absent ⇒ inferred from `wallet` being non-null. */
  walletFound?: boolean;
}): AccountTier {
  if (input?.anonymous) return 'unknown';
  if (input?.freeListed) return 'admin';
  const found = typeof input?.walletFound === 'boolean' ? input.walletFound : Boolean(input?.wallet);
  if (!found) return 'unknown';
  return hasEverPaid(input?.wallet) ? 'paid' : 'free';
}

/** Does a row's tier match the filter? Pure. `all` matches everything, including `unknown`. */
export function matchesTier(tier: AccountTier | null | undefined, filter: AccountTierFilter): boolean {
  if (!filter || filter === 'all') return true;
  return tier === filter;
}

/** The label the filter control and the ⓘ panel print. Pure — so both say the same words. */
export function accountTierLabel(tier: AccountTier | null | undefined): string {
  switch (tier) {
    case 'paid': return 'Paid — has bought tokens';
    case 'free': return 'Free — never purchased';
    case 'admin': return 'Admin / tester';
    default: return 'Unknown — no account record';
  }
}

/** The short form for a dense row or a <select>. Pure. */
export function accountTierShort(tier: AccountTier | null | undefined): string {
  switch (tier) {
    case 'paid': return 'Paid';
    case 'free': return 'Free';
    case 'admin': return 'Admin/Tester';
    default: return 'Unknown';
  }
}

/** Parse the `?tier=` query parameter. Anything unrecognised means "do not filter". Pure. */
export function parseTierFilter(v: unknown): AccountTierFilter {
  const t = String(v ?? '').trim().toLowerCase();
  return t === 'paid' || t === 'free' || t === 'admin' || t === 'unknown' ? t : 'all';
}
