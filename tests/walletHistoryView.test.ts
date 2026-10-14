import { describe, it, expect } from 'vitest';
import {
  classifyRow, toHistoryItems, filterHistory, countByFilter, pageOf, HISTORY_FILTERS,
  HISTORY_PAGE_SIZE, type HistoryRowInput,
} from '../src/lib/walletHistoryView';

/**
 * THE TOKEN HISTORY IS A VIEW OVER THE STATEMENT, AND A FILTER CAN NEVER HIDE MONEY.
 *
 * The CLASS: a list whose filters each silently drop some rows ("filters and pagination do not silently
 * omit or duplicate transactions"). Every row must belong to EXACTLY ONE filter, so the four kinds always
 * add up to "All"; a row the classifier cannot place is shown as "Other" with the server's own words.
 * Rows below are the real description shapes the server writes (payments.ts, hostingPlan.ts, …).
 */
const day = 86_400_000;
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const iso = (daysAgo: number) => new Date(NOW - daysAgo * day).toISOString();

const row = (over: Partial<HistoryRowInput>): HistoryRowInput => ({
  timestamp: iso(1), description: 'x', tokens: 100, kind: 'credit', feature: null, runningTokens: 0, ...over,
});

const FIXTURE: HistoryRowInput[] = [
  row({ timestamp: iso(60), description: 'Wallet recharge: ₹100 (₹2.00 platform fee) (9,800 tokens added)', tokens: 9800, runningTokens: 9800 }),
  row({ timestamp: iso(40), description: 'Referral reward — friend verified their mobile', tokens: 2500, runningTokens: 12300 }),
  row({ timestamp: iso(20), description: 'AI app build — Business Website — 12,000 tokens (₹120.00)', tokens: -12000, kind: 'debit', feature: 'build', runningTokens: 300 }),
  row({ timestamp: iso(10), description: 'Hosting plan — Starter (30 days)', tokens: -9900, kind: 'debit', runningTokens: -9600 }),
  row({ timestamp: iso(5), description: 'Promo code credit — NAVWELCOME', tokens: 5000, runningTokens: -4600 }),
  row({ timestamp: iso(2), description: 'Accounts merged — combined balance 5,000 tokens', tokens: 400, runningTokens: -4200 }),
  row({ timestamp: iso(1), description: 'Adjustment', tokens: 0, kind: 'nil', runningTokens: -4200 }),
];

describe('classifyRow', () => {
  it('a debit is always Spent, whatever its words say', () => {
    expect(classifyRow(row({ tokens: -5, kind: 'debit', description: 'Wallet recharge refund' }))).toBe('spent');
  });
  it('a recharge is Bought; a referral / promo / welcome / refund is Earned', () => {
    expect(classifyRow(FIXTURE[0])).toBe('bought');
    expect(classifyRow(FIXTURE[1])).toBe('earned');
    expect(classifyRow(FIXTURE[4])).toBe('earned');
    expect(classifyRow(row({ description: 'Welcome gift' }))).toBe('earned');
    expect(classifyRow(row({ description: 'Unused days on your Starter plan, returned as credit' }))).toBe('earned');
  });
  it('a credit it cannot place is Other — shown, never guessed into Bought or Earned', () => {
    expect(classifyRow(FIXTURE[5])).toBe('other');
    expect(classifyRow(FIXTURE[6])).toBe('other');
  });
});

describe('🔒 a filter can never hide money', () => {
  const items = toHistoryItems(FIXTURE);

  it('every row belongs to exactly one filter: the four kinds add up to All', () => {
    const c = countByFilter(items);
    expect(c.all).toBe(FIXTURE.length);
    expect(c.bought + c.earned + c.spent + c.other).toBe(c.all);
    expect(c).toEqual({ all: 7, bought: 1, earned: 2, spent: 2, other: 2 });
  });

  it('filtering by each kind and concatenating returns every row exactly once', () => {
    const seen = HISTORY_FILTERS.filter((f) => f !== 'all')
      .flatMap((f) => filterHistory(items, f, 'all', NOW).map((i) => i.key));
    expect([...seen].sort()).toEqual(items.map((i) => i.key).sort());
    expect(new Set(seen).size).toBe(items.length);
  });

  it('newest first; the key keeps the server position', () => {
    expect(items[0].title).toBe('Wallet entry');
    expect(items[items.length - 1].tokens).toBe(9800);
    expect(items[items.length - 1].key).toBe('0');
  });

  it('a date range drops only rows older than the cutoff; a row with an unreadable date is KEPT', () => {
    const withBadDate = toHistoryItems([...FIXTURE, row({ timestamp: 'not a date', description: 'Referral reward' })]);
    const r30 = filterHistory(withBadDate, 'all', '30d', NOW);
    expect(r30.some((i) => i.timestamp === 'not a date')).toBe(true);
    expect(r30.every((i) => i.whenMs === null || i.whenMs >= NOW - 30 * day)).toBe(true);
    expect(filterHistory(withBadDate, 'all', 'all', NOW)).toHaveLength(withBadDate.length);
  });

  it('credits and debits are signed, so a screen can colour them without guessing', () => {
    const debit = items.find((i) => i.tokens === -12000)!;
    expect(debit.credit).toBe(false);
    expect(debit.title).toBe('AI app building');
    expect(items.find((i) => i.tokens === -9900)!.title).toBe('Hosting and add-ons');
  });
});

describe('pagination neither omits nor repeats', () => {
  const many = toHistoryItems(Array.from({ length: 45 }, (_, i) => row({ description: 'Referral reward', timestamp: iso(i), tokens: i + 1 })));
  it('pages of 20 cover all 45 rows exactly once', () => {
    const p1 = pageOf(many, HISTORY_PAGE_SIZE);
    const p2 = pageOf(many, HISTORY_PAGE_SIZE * 2);
    const p3 = pageOf(many, HISTORY_PAGE_SIZE * 3);
    expect(p1.rows).toHaveLength(20); expect(p1.more).toBe(25);
    expect(p2.rows).toHaveLength(40); expect(p2.more).toBe(5);
    expect(p3.rows).toHaveLength(45); expect(p3.more).toBe(0);
    expect(new Set(p3.rows.map((r) => r.key)).size).toBe(45);
    expect(p3.rows.slice(0, 20)).toEqual(p1.rows);
  });
});
