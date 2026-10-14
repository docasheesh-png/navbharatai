// THE TOKEN HISTORY, AS A PERSON READS IT — a view over the wallet statement, never a second ledger.
//
// The statement route (`/api/wallet/:userId/statement`, built by `walletStatement.ts`) is the one
// reconciled source of every credit and debit. This module only SORTS, FILTERS and LABELS what that
// route already returned: it never adds a row, never sums for display, and never fills a gap. A row
// the classifier cannot place is shown under "Other" with the server's own words — it is not hidden
// and not guessed into "Bought" or "Earned".
//
// 🔒 THE FILTERS CANNOT HIDE MONEY. Every row belongs to exactly one filter, so Bought + Earned +
// Spent + Other always equals All (`tests/walletHistoryView.test.ts` holds that over a mixed fixture).
// A filter that silently dropped a kind would be the "filters silently omit transactions" defect.
//
// PURE. No React, no clock except the `now` a caller passes in.

export type HistoryFilter = 'all' | 'bought' | 'earned' | 'spent' | 'other';
export type HistoryRange = 'all' | '30d' | '90d' | '365d';
export type HistoryKind = Exclude<HistoryFilter, 'all'>;

export const HISTORY_FILTERS: readonly HistoryFilter[] = ['all', 'bought', 'earned', 'spent', 'other'];
export const HISTORY_RANGES: readonly HistoryRange[] = ['all', '30d', '90d', '365d'];

export const HISTORY_FILTER_LABEL: Readonly<Record<HistoryFilter, string>> = Object.freeze({
  all: 'All',
  bought: 'Bought',
  earned: 'Earned',
  spent: 'Spent',
  other: 'Other',
});

export const HISTORY_RANGE_LABEL: Readonly<Record<HistoryRange, string>> = Object.freeze({
  all: 'All time',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '365d': 'Last year',
});

/** How many rows one "Show more" reveals. */
export const HISTORY_PAGE_SIZE = 20;

/** The shape of one statement row this module needs — a subset of the server's `StatementRow`. */
export interface HistoryRowInput {
  timestamp: string;
  description: string;
  tokens: number;
  kind: 'credit' | 'debit' | 'nil';
  feature: string | null;
  runningTokens?: number;
}

export interface HistoryItem {
  /** Stable within one statement load: its position in the server's oldest-first order. */
  key: string;
  timestamp: string;
  whenMs: number | null;
  /** A short plain label. */
  title: string;
  /** The server's own full description, shown as the second line when it adds something. */
  detail: string;
  /** Signed tokens: positive is money in. */
  tokens: number;
  credit: boolean;
  kind: HistoryKind;
  balanceAfter: number | null;
}

// What a credit is, from the server's own description. Ordered: the first matching rule wins, and the
// "earned" words are tested before the "bought" ones because a referral reward's description can also
// mention a recharge-like word.
const EARNED = /referral|reward|bonus|coupon|promo|gift|welcome|sign[- ]?up|verified|verification|claim|returned as credit|refund|build credit included|remixed/i;
const BOUGHT = /recharge|top[- ]?up|purchase|pack|bought|tokens added/i;

export function classifyRow(row: HistoryRowInput): HistoryKind {
  if (row.kind === 'debit' || row.tokens < 0) return 'spent';
  if (row.kind === 'credit' || row.tokens > 0) {
    const d = row.description || '';
    if (EARNED.test(d)) return 'earned';
    if (BOUGHT.test(d)) return 'bought';
    return 'other';
  }
  return 'other';
}

function titleFor(kind: HistoryKind, row: HistoryRowInput): string {
  const d = (row.description || '').trim();
  if (kind === 'bought') return 'Tokens bought';
  if (kind === 'earned') return /referral/i.test(d) ? 'Referral reward' : /coupon|promo|gift/i.test(d) ? 'Promo code credit' : 'Free credit received';
  if (kind === 'spent') {
    if (/hosting|add-on|plan|traffic|database/i.test(d)) return 'Hosting and add-ons';
    if (/build|app/i.test(`${d} ${row.feature ?? ''}`)) return 'AI app building';
    return 'Tokens used';
  }
  return 'Wallet entry';
}

export function toHistoryItems(rows: readonly HistoryRowInput[]): HistoryItem[] {
  // The server sends oldest first (the order a running balance makes sense in). A person reads
  // newest first, so the order is reversed HERE, once, and the key keeps the server position.
  const items = rows.map((row, i): HistoryItem => {
    const kind = classifyRow(row);
    const ms = Date.parse(row.timestamp);
    const detail = (row.description || '').trim();
    return {
      key: `${i}`,
      timestamp: row.timestamp,
      whenMs: Number.isNaN(ms) ? null : ms,
      title: titleFor(kind, row),
      detail,
      tokens: row.tokens,
      credit: row.tokens > 0,
      kind,
      balanceAfter: typeof row.runningTokens === 'number' ? row.runningTokens : null,
    };
  });
  return items.reverse();
}

const RANGE_DAYS: Record<Exclude<HistoryRange, 'all'>, number> = { '30d': 30, '90d': 90, '365d': 365 };

/** A row with no readable date is KEPT by every range — hiding money because its date is unreadable is the worse error. */
export function filterHistory(
  items: readonly HistoryItem[],
  filter: HistoryFilter,
  range: HistoryRange,
  now: number,
): HistoryItem[] {
  const cutoff = range === 'all' ? null : now - RANGE_DAYS[range] * 86_400_000;
  return items.filter((it) => {
    if (filter !== 'all' && it.kind !== filter) return false;
    if (cutoff !== null && it.whenMs !== null && it.whenMs < cutoff) return false;
    return true;
  });
}

/** How many of each kind, for the filter chips — counted over the SAME items the list filters. */
export function countByFilter(items: readonly HistoryItem[]): Record<HistoryFilter, number> {
  const c: Record<HistoryFilter, number> = { all: items.length, bought: 0, earned: 0, spent: 0, other: 0 };
  for (const it of items) c[it.kind] += 1;
  return c;
}

/** The first `shown` rows, and whether more remain. */
export function pageOf<T>(items: readonly T[], shown: number): { rows: T[]; more: number } {
  const n = Math.max(0, Math.floor(shown));
  return { rows: items.slice(0, n), more: Math.max(0, items.length - n) };
}
