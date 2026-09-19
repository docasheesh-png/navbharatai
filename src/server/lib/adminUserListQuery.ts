// The admin Users list's PAID/FREE filter — the half that needs a wallet predicate, so it cannot live
// in the shared module beside it (`src/lib/adminUserSort.ts`, which the browser also imports).
//
// Admin, 2026-09-19: "admin penal me user ke colom me, ek buton/filter aur add karna hai.
//   1. paid (jis user ne life me 1 bar bhi navbharatai ko real money se wallet recharge kiya hai) / free user
//   2. assending/dessending"
//
// 🔑 "PAID" IS NOT A NEW RULE, AND IT MUST NOT BECOME ONE. `hasEverPaid` already answers exactly the
// question the admin asked, and `adminUserLookup.ts` already uses THAT ONE for the admin account
// panel, with its own comment saying why: "ONE rule, shared with the build router … so the admin list
// and the engine can never disagree about who is a paying user." A second definition here would put
// two answers on one screen — the filter saying paid and the account sheet saying free.
//
// 🔴 AND THERE ARE ALREADY TWO OF THEM IN THIS REPO, WHICH IS RECORDED RATHER THAN QUIETLY PICKED:
//   • `AgentV3/FreeTierBuildRouting.hasEverPaid` → `Number(totalMoneySpent) > 0`
//   • `lib/giftSpend.hasEverPaid`                → `lifetimeMoneySpentInr(w) > 0 || lastRechargeAt`
// They disagree about a wallet carrying `lastRechargeAt` with no `totalMoneySpent`. This module takes
// the FIRST, because that is the one the admin surface and the build router already share — making
// the panel self-consistent. Unifying them is a MONEY-SEMANTICS decision (does a recharge timestamp
// alone make somebody a customer?) with the build router and the gift plan downstream of it, so it is
// an OPEN root cause in PROGRESS.md, not a change smuggled into a filter.

import { hasEverPaid } from '../AgentV3/FreeTierBuildRouting';
import type { PaidFilter } from '../../lib/adminUserSort';

/**
 * Whether a wallet passes the filter.
 *
 * ⚠️ `free` is the strict complement of `paid` — there is no third state here, because this list is
 * built from wallet documents and every row therefore HAS an account. (`adminUserLookup` needs a
 * `null` for an anonymous build, which has no wallet at all; that case cannot reach this list.)
 */
export function walletPassesPaidFilter(wallet: unknown, filter: PaidFilter): boolean {
  if (filter === 'all') return true;
  const paid = hasEverPaid(wallet as { totalMoneySpent?: unknown });
  return filter === 'paid' ? paid : !paid;
}
