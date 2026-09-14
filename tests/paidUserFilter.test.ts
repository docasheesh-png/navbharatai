import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accountTier, matchesTier, parseTierFilter, accountTierShort, accountTierLabel } from '../src/server/lib/accountTier';
import { hasEverPaid, isFreeTierUser } from '../src/server/AgentV3/FreeTierBuildRouting';
import { identityFrom } from '../src/server/lib/adminUserLookup';
import { rowMatches, hasActiveFilters, EMPTY_FILTERS, TIER_OPTIONS, type ListFilterState } from '../src/lib/reportListFilter';
import { tierFactFor, submittedRowFacts, allBuildRowFacts } from '../src/lib/reportRowFacts';

/**
 * ADMIN 2026-09-14, verbatim:
 *   "par filter me paid/free user wala filter nhi lagaya — woh lagao!!
 *    jis user ne real ₹ se token purchase kiye hai, woh paid user hai!!"
 *
 * Two things had to be true, and only the first was asked for out loud:
 *   1. the control exists on BOTH lists (it had existed on the inbox alone);
 *   2. it MEANS what the admin said — which the old one did not.
 */

describe('THE DEFINITION: paid = this account bought tokens with real ₹', () => {
  it('a purchase makes a paying user', () => {
    expect(hasEverPaid({ totalMoneySpent: 499 })).toBe(true);
    expect(accountTier({ wallet: { totalMoneySpent: 499 }, walletFound: true })).toBe('paid');
  });

  it('a GIFTED balance does not — the welcome bonus is not a purchase', () => {
    // The welcome bonus, the weekly gift, a coupon and an admin adjustment all credit through
    // mirroredCreditPatch(..., 'gift'), which never writes totalMoneySpent.
    expect(hasEverPaid({ totalMoneySpent: 0 })).toBe(false);
    expect(accountTier({ wallet: { totalMoneySpent: 0 }, walletFound: true })).toBe('free');
  });

  it('is the SAME rule the build router already used — one definition, not two', () => {
    for (const w of [{ totalMoneySpent: 1 }, { totalMoneySpent: 0 }, {}, null]) {
      expect(isFreeTierUser(w)).toBe(!hasEverPaid(w));
    }
  });

  it('junk is never read as a payment', () => {
    for (const v of [NaN, Infinity, -5, 0, null, undefined, {}, [], 'abc']) {
      expect(hasEverPaid({ totalMoneySpent: v }), String(v)).toBe(false);
    }
    expect(hasEverPaid(null)).toBe(false);
    expect(hasEverPaid(undefined)).toBe(false);
  });

  it('a NUMERIC STRING still counts as paid, and that is deliberate — do not "tighten" it', () => {
    // `Number('500')` is 500, so a legacy document holding the amount as a string reads as paid.
    // That is the RIGHT answer (they did pay ₹500), and tightening it would not be a tidy-up: this
    // predicate also drives BUILD ROUTING via isFreeTierUser, so rejecting the string would silently
    // move a paying customer onto the cheap free-tier ladder. Locked here so nobody "fixes" it.
    expect(hasEverPaid({ totalMoneySpent: '500' as unknown as number })).toBe(true);
    expect(isFreeTierUser({ totalMoneySpent: '500' as unknown as number })).toBe(false);
  });
});

describe('UNKNOWN is never folded into FREE', () => {
  it('a signed-out build has no account, so it has no answer', () => {
    expect(accountTier({ anonymous: true })).toBe('unknown');
    expect(identityFrom('anon', null).paid).toBeNull();
  });

  it('a uid with no wallet record is unknown, not free', () => {
    expect(accountTier({ walletFound: false })).toBe('unknown');
    expect(identityFrom('uid-1', null).paid).toBeNull();
  });

  it('a wallet that WAS found gives a real answer', () => {
    expect(identityFrom('uid-1', { totalMoneySpent: 250 }).paid).toBe(true);
    expect(identityFrom('uid-1', { totalMoneySpent: 0 }).paid).toBe(false);
  });

  it('and the filter offers Unknown, so those rows are reachable', () => {
    expect(TIER_OPTIONS.map((o) => o.value)).toEqual(['all', 'paid', 'free', 'admin', 'unknown']);
  });

  it('a row with NO tier answers to Unknown rather than disappearing', () => {
    const f = (tier: ListFilterState['tier']): ListFilterState => ({ ...EMPTY_FILTERS, tier });
    const row = { ok: true, at: 1, uid: 'u', search: ['x'] };   // no tier at all
    expect(rowMatches(row, f('unknown'))).toBe(true);
    expect(rowMatches(row, f('free'))).toBe(false);
    expect(rowMatches(row, f('all'))).toBe(true);
  });
});

describe('the free list is its own bucket, never counted among real users', () => {
  it('an admin/tester outranks whatever their wallet says', () => {
    expect(accountTier({ freeListed: true, wallet: { totalMoneySpent: 999 }, walletFound: true })).toBe('admin');
    expect(accountTier({ freeListed: true, walletFound: false })).toBe('admin');
  });

  it('but an anonymous build is unknown even then — there is no account to be on a list', () => {
    expect(accountTier({ anonymous: true, freeListed: true })).toBe('unknown');
  });
});

describe('the filter itself', () => {
  it('matches only its own bucket, and "all" matches everything', () => {
    expect(matchesTier('paid', 'paid')).toBe(true);
    expect(matchesTier('free', 'paid')).toBe(false);
    expect(matchesTier('unknown', 'all')).toBe(true);
    expect(matchesTier(null, 'all')).toBe(true);
  });

  it('an unrecognised ?tier= never silently narrows the list', () => {
    expect(parseTierFilter('paid')).toBe('paid');
    expect(parseTierFilter('PAID')).toBe('paid');
    expect(parseTierFilter('nonsense')).toBe('all');
    expect(parseTierFilter(undefined)).toBe('all');
    expect(parseTierFilter(null)).toBe('all');
  });

  it('choosing a tier shows Clear', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, tier: 'paid' })).toBe(true);
  });

  it('labels are one vocabulary', () => {
    expect(accountTierShort('paid')).toBe('Paid');
    expect(accountTierLabel('free')).toMatch(/never purchased/);
    expect(accountTierLabel('unknown')).toMatch(/no account record/i);
  });
});

/**
 * 🔴 THE BUG THE OLD FILTER HAD, and the reason this is not just a new <select>.
 *
 * routes/agentv3.ts: `if (!freeTierBuildActive && powerSpecResolved.cheapOnly && …) freeTierBuildActive = true;`
 * — so choosing the WEAK engine stamps the build `"free (welcome bonus — cheap engines)"`, whoever
 * you are. The inbox classified from that string, so a customer who had paid ₹500 and picked Weak was
 * listed as **Free**, and "show me my paying users" hid a real customer.
 */
describe('a paying customer who picked the Weak engine is still a paying customer', () => {
  const customerOnWeak = {
    name: 'Asha', email: 'asha@x.com', userId: 'u1', reportedAt: 1,
    userTier: 'free (welcome bonus — cheap engines)',  // what the BUILD recorded
    accountTier: 'paid',                                // what the ACCOUNT says
    billedInr: 0, billedUsd: 0, ok: true,
  };

  it('the filter follows the ACCOUNT, not the build', () => {
    const row = { ok: true, at: 1, uid: 'u1', tier: 'paid' as const, search: ['asha'] };
    expect(rowMatches(row, { ...EMPTY_FILTERS, tier: 'paid' })).toBe(true);
    expect(rowMatches(row, { ...EMPTY_FILTERS, tier: 'free' })).toBe(false);
  });

  it('and the panel shows BOTH facts, so the build tier is not lost — just no longer mistaken for it', () => {
    const facts = submittedRowFacts(customerOnWeak, 2);
    const user = facts.find((f) => f.label === 'User');
    const build = facts.find((f) => f.label === 'This build');
    expect(user?.value).toBe('Paid');
    expect(build?.value).toMatch(/welcome bonus/);
    expect(build?.hint).toMatch(/not whether the user has ever paid/);
  });

  it('the all-builds row shows the same two facts under the same labels', () => {
    const facts = allBuildRowFacts({ workspaceId: 'w', savedAt: 1, tier: 'paid', userTier: 'free (welcome bonus — cheap engines)' }, 2);
    expect(facts.find((f) => f.label === 'User')?.value).toBe('Paid');
    expect(facts.find((f) => f.label === 'This build')?.value).toMatch(/welcome bonus/);
  });

  it('an unknown account says so rather than claiming "free"', () => {
    expect(tierFactFor(null).value).toBe('Unknown');
    expect(tierFactFor(null).hint).toMatch(/not the same as "never paid"/);
  });
});

describe('the wiring — both lists, one control, one meaning', () => {
  const bar = readFileSync(join(process.cwd(), 'src/components/admin/ReportFilterBar.tsx'), 'utf8');
  const dash = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');
  const routes = readFileSync(join(process.cwd(), 'src/server/routes/admin.ts'), 'utf8');
  const lookup = readFileSync(join(process.cwd(), 'src/server/lib/adminUserLookup.ts'), 'utf8');

  it('the control lives in the SHARED bar, so both lists have it by construction', () => {
    expect(bar).toContain('aria-label="Filter by paid or free user"');
    expect(bar).toContain('TIER_OPTIONS.map');
    // Not passed in per list as a one-off, which is how it came to exist on only one of them.
    expect(dash).not.toContain('setReportTierFilter');
  });

  it('both server lists resolve the tier from the ACCOUNT', () => {
    expect(routes.split('accountTier({').length - 1).toBe(2);
    expect(routes).toContain('const tierFilter = parseTierFilter(req.query.tier);');
    expect(routes).toContain('matchesTier(b.tier, tierFilter)');
  });

  it('all-builds narrows on the SERVER — filtering in the browser would only narrow 500 fetched rows', () => {
    expect(dash).toContain("if (tier && tier !== 'all') params.set('tier', tier);");
    expect(dash).toMatch(/\}, \[activeTab, allBuildsStatus, allBuildsDate, allBuildsUid, allBuildsTier\]\)/);
  });

  it('the paid fact rides the wallet read the lookup ALREADY makes — no extra round trip', () => {
    expect(lookup).toContain("import { hasEverPaid } from '../AgentV3/FreeTierBuildRouting';");
    expect(lookup).toContain('const paid = record ? hasEverPaid(');
  });
});
