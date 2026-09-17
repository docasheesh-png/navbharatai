// THE ADMIN TAB BAR, ANSWERING "WHERE DO I NEED TO WORK RIGHT NOW?" — admin-asked 2026-09-17.
//
// In their own words: *"us header me naam ke sath number bhi chahiye … jisse admin ko ek nazar me pata
// lag jaye, kaha kaam abhi karna hai."* Nine tabs, and nothing on them said which one was on fire. The
// admin was opening each page in turn to find out.
//
// 🔴 THE ONE RULE THIS FILE EXISTS TO ENFORCE: **`null` IS NOT `0`.**
//
// A badge that cannot be measured must render NOTHING. It must never render `0`, because on this bar a
// zero is a promise — "I looked, and there is no work here" — and the admin will act on it by not
// opening the page. Every source behind these numbers can fail (Firestore read, a Google API, an
// instance that just booted), and a failure that silently becomes a calm zero is the exact dishonesty
// the second absolute rule forbids. `value: null` ⇒ the tab renders as it does today, with no badge.
//
// This module is PURE so that rule is testable: no fetch, no clock, no env.

/** One tab's badge. `value` is the number that needs attention; `of` is its denominator, when paired. */
export interface TabBadge {
  /** The actionable half — errors, unread, used-today. `null` means NOT MEASURED, never "none". */
  value: number | null;
  /** The total half of a pair (e.g. 1538 in "54/1538"). `null`/absent ⇒ render `value` alone. */
  of?: number | null;
  /**
   * Does a non-zero `value` mean WORK IS WAITING?
   *
   * `attention` — errors, unread reports: the number is a to-do list, so it is coloured when > 0.
   * `neutral`   — users today, revenue, engines in use: healthy activity. Colouring these would train
   *               the admin to ignore colour, which is what makes the `attention` ones useless.
   */
  tone: 'attention' | 'neutral';
  /** Rendered as a currency pair (₹) rather than a plain count. */
  money?: boolean;
}

export interface AdminTabBadges {
  monitor: TabBadge;
  users: TabBadge;
  engines: TabBadge;
  revenue: TabBadge;
  reports: TabBadge;
  userreports: TabBadge;
  apkreports: TabBadge;
}

/** Nothing measured — the shape every failed source degrades to. Renders no badge at all. */
export const NO_BADGE: TabBadge = { value: null, of: null, tone: 'neutral' };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Indian digit grouping — 8575 → "8,575". Matches how every other rupee figure in the panel reads. */
export function groupIndian(n: number): string {
  const neg = n < 0;
  const s = String(Math.floor(Math.abs(n)));
  if (s.length <= 3) return (neg ? '-' : '') + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${rest},${last3}`;
}

/**
 * The text a badge shows, or `null` for "render no badge". PURE.
 *
 * ⚠️ A PAIR WITH AN UNMEASURED TOTAL STILL SHOWS ITS NUMERATOR. "54 users active" is useful on its own;
 * withholding it because the lifetime total failed to load would throw away the half that answers the
 * admin's question. The reverse is not true — a denominator alone says nothing about today.
 */
export function formatBadge(b: TabBadge | null | undefined): string | null {
  if (!b || !isNum(b.value)) return null;
  const head = b.money ? `₹${groupIndian(b.value)}` : String(b.value);
  if (!isNum(b.of)) return head;
  const tail = b.money ? `₹${groupIndian(b.of)}` : String(b.of);
  return `${head}/${tail}`;
}

/**
 * Should this badge be coloured as "work waiting"? PURE.
 *
 * Only an `attention` badge with a POSITIVE value. Zero attention items is genuinely good news and is
 * shown plainly — the admin asked to see where work is, and a coloured `0` is noise that makes the
 * coloured `4` beside it harder to see.
 */
export function badgeNeedsAttention(b: TabBadge | null | undefined): boolean {
  return Boolean(b && b.tone === 'attention' && isNum(b.value) && b.value > 0);
}

/**
 * One line of hover text spelling out exactly what the two numbers mean.
 *
 * The bar has room for "54/1538" and nothing else, and a bare pair is ambiguous — the admin should not
 * have to remember which half is which. Every badge therefore carries its own sentence.
 */
export const BADGE_HINTS: Readonly<Record<keyof AdminTabBadges, string>> = {
  monitor: 'Things needing attention right now — capacity ceilings at warning or critical.',
  users: 'Active in the last 24 hours / total registered users.',
  engines: 'AI engines that actually served a request today / engines configured and holding a key.',
  revenue: "Today's revenue / revenue all time.",
  reports: 'Build reports never opened / build reports not yet marked fixed.',
  userreports: 'User reports never opened / user reports not yet marked fixed.',
  apkreports: 'APK build reports never opened / APK reports not yet marked fixed.',
};

/**
 * Read a server payload into badges, degrading EVERY unreadable field to "no badge". PURE.
 *
 * Deliberately total and defensive: this runs on whatever the admin route returned, including an older
 * server during a rolling deploy that knows nothing about badges. A missing field must leave the tab
 * bar exactly as it is today, never throw and never invent a zero.
 */
export function badgesFromPayload(raw: unknown): AdminTabBadges {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const num = (v: unknown): number | null => (isNum(v) ? v : null);
  const pair = (
    key: string, valueKey: string, ofKey: string, tone: TabBadge['tone'], money = false,
  ): TabBadge => {
    const src = (p[key] && typeof p[key] === 'object' ? p[key] : {}) as Record<string, any>;
    return { value: num(src[valueKey]), of: num(src[ofKey]), tone, ...(money ? { money: true } : {}) };
  };
  return {
    monitor: { value: num((p.monitor || {}).needsAttention), of: null, tone: 'attention' },
    users: pair('users', 'activeToday', 'total', 'neutral'),
    engines: pair('engines', 'usedToday', 'configured', 'neutral'),
    revenue: pair('revenue', 'todayInr', 'totalInr', 'neutral', true),
    reports: pair('reports', 'unopened', 'open', 'attention'),
    userreports: pair('userreports', 'unopened', 'open', 'attention'),
    apkreports: pair('apkreports', 'unopened', 'open', 'attention'),
  };
}
