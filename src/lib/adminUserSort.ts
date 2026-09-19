// The admin Users list's PAID filter and SORT DIRECTION vocabulary — shared by the server route and
// the admin panel, because the panel draws an ARROW for the direction currently in force and the
// server decides what that direction is. Two copies of `DEFAULT_SORT_DIRECTION` would mean an arrow
// pointing down over a list sorted up, with nothing failing to reveal it.
//
// `src/lib/` is this repo's existing home for a rule both halves need (`platformFee.ts` is imported
// by `routes/health.ts` the same way). PURE — no Firestore, no env, no clock, nothing browser-only.

/** What the admin asked for: everyone, only customers, or only the never-paid. */
export type PaidFilter = 'all' | 'paid' | 'free';

export type SortDirection = 'asc' | 'desc';

/**
 * Parse `?paid=`. Anything unrecognised — absent, empty, a typo, an old client — means `all`, which
 * is today's behaviour exactly. On the screen used to judge who pays, a malformed value must never
 * silently HIDE accounts.
 */
export function parsePaidFilter(raw: unknown): PaidFilter {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'paid' || v === 'free' ? v : 'all';
}

/**
 * Each sort's NATURAL direction — the one it has always had, so leaving `?dir=` off is byte-identical
 * to the behaviour before this existed.
 *
 * 🔑 Expressed as data rather than baked into the comparators, because "descending" is the sensible
 * reading of every sort here EXCEPT alphabetical: an admin wants the biggest balance, the heaviest
 * user and the most recent visit first, but names from A. Stating it once is what lets a single
 * `dir` flag mean the same thing on all five — and lets the button show the truth.
 */
export const DEFAULT_SORT_DIRECTION: Record<string, SortDirection> = {
  alpha: 'asc',
  tokens: 'desc',
  ai_per_day: 'desc',
  paid: 'desc',
  recent: 'desc',
};

/** The direction actually in force: the explicit choice, else this sort's natural one. */
export function effectiveDirection(chosen: unknown, sort: string): SortDirection {
  const v = String(chosen ?? '').trim().toLowerCase();
  if (v === 'asc' || v === 'desc') return v;
  return DEFAULT_SORT_DIRECTION[sort] ?? 'desc';
}

/** Parse `?dir=`. Unrecognised ⇒ that sort's natural direction, i.e. today's behaviour. */
export const parseSortDirection = effectiveDirection;

/**
 * Wrap an ASCENDING comparator so it honours `direction`. One helper, so no call site has to
 * remember which way round its own `a - b` was written.
 *
 * 🔒 THE COMPARATOR IS INVERTED, NEVER THE ARRAY. `[...].sort(cmp).reverse()` also flips every TIE,
 * so two users with identical balances would swap places purely because the direction button was
 * pressed — and with hundreds of wallets, ties on a 0 balance are the common case, not an edge one.
 * Inverting the comparison keeps equal rows in their original relative order.
 */
export function directed<T>(
  ascending: (a: T, b: T) => number,
  direction: SortDirection,
): (a: T, b: T) => number {
  return direction === 'desc' ? (a, b) => ascending(b, a) : ascending;
}
