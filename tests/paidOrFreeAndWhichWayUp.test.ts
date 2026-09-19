// The admin Users list's two new controls (admin 2026-09-19):
//   1. "paid (jis user ne life me 1 bar bhi navbharatai ko real money se wallet recharge kiya hai) / free user"
//   2. "assending/dessending"
//
// What these cases exist to hold: that "paid" is the rule this repo ALREADY has rather than a fourth
// one, that leaving both controls alone reproduces the previous screen exactly, and that a direction
// flip does not quietly reshuffle tied rows.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parsePaidFilter, parseSortDirection, effectiveDirection, directed, DEFAULT_SORT_DIRECTION,
} from '../src/lib/adminUserSort';
import { walletPassesPaidFilter } from '../src/server/lib/adminUserListQuery';
import { hasEverPaid } from '../src/server/AgentV3/FreeTierBuildRouting';

const ADMIN = readFileSync(join(__dirname, '..', 'src/server/routes/admin.ts'), 'utf8');
const PANEL = readFileSync(join(__dirname, '..', 'src/components/AdminDashboard.tsx'), 'utf8');
/** Comments carry the reasoning, quoted code included — never assert against them. */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('the PAID filter parses in the safe direction', () => {
  it('takes the two real values', () => {
    expect(parsePaidFilter('paid')).toBe('paid');
    expect(parsePaidFilter('free')).toBe('free');
    expect(parsePaidFilter(' PAID ')).toBe('paid');
  });

  it('anything unrecognised means ALL — a malformed value must never HIDE accounts', () => {
    for (const bad of [undefined, null, '', '   ', 'yes', 'true', '1', 'payed', {}, 0]) {
      expect(parsePaidFilter(bad), String(bad)).toBe('all');
    }
  });
});

describe('"paid" is the rule this repo already has', () => {
  const paidWallet = { totalMoneySpent: 250 };
  const giftedWallet = { totalMoneySpent: 0, totalTokensPurchased: 90_000 };

  it('agrees with hasEverPaid, wallet for wallet', () => {
    for (const w of [paidWallet, giftedWallet, {}, { totalMoneySpent: '0' }]) {
      expect(walletPassesPaidFilter(w, 'paid')).toBe(hasEverPaid(w as never));
      expect(walletPassesPaidFilter(w, 'free')).toBe(!hasEverPaid(w as never));
    }
  });

  it('a GIFTED balance never reads as a customer — the whole point of the question', () => {
    // 90,000 purchased credits with ₹0 of real money is the welcome gift, which is exactly what the
    // admin's screenshot showed on every row.
    expect(walletPassesPaidFilter(giftedWallet, 'paid')).toBe(false);
    expect(walletPassesPaidFilter(giftedWallet, 'free')).toBe(true);
  });

  it('`all` lets everything through, so the filter is genuinely off', () => {
    for (const w of [paidWallet, giftedWallet, {}, null]) {
      expect(walletPassesPaidFilter(w, 'all')).toBe(true);
    }
  });

  it('does NOT define its own predicate — it imports the shared one', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/lib/adminUserListQuery.ts'), 'utf8');
    expect(src).toMatch(/import \{ hasEverPaid \} from '\.\.\/AgentV3\/FreeTierBuildRouting'/);
    expect(codeOnly(src)).not.toMatch(/totalMoneySpent\s*[)>]/);
    expect(codeOnly(src)).not.toMatch(/lastRechargeAt/);
  });
});

describe('direction: leaving it alone is the previous behaviour, exactly', () => {
  it('every sort keeps the direction it has always had', () => {
    expect(DEFAULT_SORT_DIRECTION).toEqual({
      alpha: 'asc', tokens: 'desc', ai_per_day: 'desc', paid: 'desc', recent: 'desc',
    });
  });

  it('an absent or malformed dir falls back to that natural direction, never to a fixed one', () => {
    for (const bad of [undefined, null, '', 'up', 'ascending', 1]) {
      expect(parseSortDirection(bad, 'alpha'), String(bad)).toBe('asc');
      expect(parseSortDirection(bad, 'tokens'), String(bad)).toBe('desc');
      expect(parseSortDirection(bad, 'recent'), String(bad)).toBe('desc');
    }
  });

  it('an unknown sort name is descending — the reading four of the five sorts have', () => {
    expect(parseSortDirection(undefined, 'something_new')).toBe('desc');
  });

  it('an explicit value always wins', () => {
    expect(parseSortDirection('asc', 'tokens')).toBe('asc');
    expect(parseSortDirection('desc', 'alpha')).toBe('desc');
  });

  it('the panel and the server read the SAME table — effectiveDirection IS parseSortDirection', () => {
    expect(effectiveDirection).toBe(parseSortDirection);
  });
});

describe('the comparator is inverted, never the array', () => {
  const byN = (a: { n: number }, b: { n: number }) => a.n - b.n;

  it('desc reverses the order', () => {
    const rows = [{ n: 1 }, { n: 3 }, { n: 2 }];
    expect([...rows].sort(directed(byN, 'asc')).map(r => r.n)).toEqual([1, 2, 3]);
    expect([...rows].sort(directed(byN, 'desc')).map(r => r.n)).toEqual([3, 2, 1]);
  });

  it('🔒 TIES KEEP THEIR ORIGINAL ORDER IN BOTH DIRECTIONS — a `.reverse()` would flip them', () => {
    // Ties on a 0 balance are the COMMON case in this list, not an edge one: pressing the direction
    // button must not reshuffle hundreds of equal rows.
    const rows = [{ n: 0, id: 'a' }, { n: 0, id: 'b' }, { n: 0, id: 'c' }];
    expect([...rows].sort(directed(byN, 'asc')).map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect([...rows].sort(directed(byN, 'desc')).map(r => r.id)).toEqual(['a', 'b', 'c']);
    // And this is what the rejected implementation would have done:
    expect([...rows].sort(byN).reverse().map(r => r.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('the route is wired, and wired in the right order', () => {
  // Bounded by the route's OWN end marker rather than a character count, so the slice cannot fall
  // short of the part being asserted as the handler grows.
  const route = (() => {
    const start = ADMIN.indexOf("app.get('/api/admin/users',");
    expect(start, 'the users route moved').toBeGreaterThan(-1);
    const end = ADMIN.indexOf('res.json(paged ?', start);
    expect(end, 'the users route no longer ends with its paged envelope').toBeGreaterThan(start);
    return ADMIN.slice(start, end + 200);
  })();

  it('filters, then counts — so "Showing 25 of N" states the FILTERED total', () => {
    const filter = route.indexOf('walletPassesPaidFilter');
    const total = route.indexOf('const total = users.length');
    expect(filter).toBeGreaterThan(-1);
    expect(total).toBeGreaterThan(-1);
    expect(filter, 'the filter must run before the count').toBeLessThan(total);
  });

  it('every comparator goes through directed(), so no sort ignores the button', () => {
    const sorts = codeOnly(route).match(/users\.sort\(/g) || [];
    const wrapped = codeOnly(route).match(/users\.sort\(asc\(/g) || [];
    expect(sorts.length).toBe(5);
    expect(wrapped.length).toBe(5);
  });

  it('the row carries the server\'s own verdict, so the browser never re-derives it', () => {
    expect(route).toMatch(/hasEverPaid: hasEverPaid\(/);
  });
});

describe('the panel', () => {
  const code = codeOnly(PANEL);

  it('starts at every account and the natural direction — the previous screen', () => {
    expect(code).toMatch(/useState<'all' \| 'paid' \| 'free'>\('all'\)/);
    expect(code).toMatch(/useState<'' \| 'asc' \| 'desc'>\(''\)/);
  });

  it('omits dir entirely while untouched, rather than guessing at the default', () => {
    expect(code).toMatch(/userDir \? `&dir=\$\{userDir\}` : ''/);
  });

  it('resets paging when either control changes, so Load-more cannot page stale results', () => {
    expect(code).toMatch(/\[userSearch, userSort, userPaid, userDir\]/);
  });

  it('refetches on either control — a filter that needs a manual Load is a filter that looks broken', () => {
    expect(code).toMatch(/\[adminToken, userSort, userSearch, userLimit, userPaid, userDir\]/);
  });

  it('the arrow reads the SHARED table, not a second copy of the defaults', () => {
    expect(code).toMatch(/effectiveDirection\(userDir, userSort\)/);
    expect(code).not.toMatch(/alpha:\s*'asc'/);
  });

  it('the per-row badge uses the server field and never `moneySpent > 0`', () => {
    expect(code).toMatch(/typeof u\.hasEverPaid === 'boolean'/);
    expect(code).not.toMatch(/moneySpent\s*>\s*0/);
  });
});
