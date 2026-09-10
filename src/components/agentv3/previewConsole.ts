// The preview console drawer's rules — which rows exist, and which of them are worth handing to the
// AI. Pure and dependency-free so the decisions are unit-tested without mounting the preview surface.

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

/** One mirrored row from the running app. `at` is the platform clock, not the app's. */
export interface PreviewConsoleEntry {
  level: ConsoleLevel;
  text: string;
  at: number;
  /** How many times this identical row arrived in a row. Absent means once. */
  repeats?: number;
}

/** Rows are capped so a chatty app (a render loop logging every frame) can never grow this unbounded. */
export const CONSOLE_BUFFER_MAX = 300;

/** Normalise whatever a mirrored message claims its level is. Anything unknown is an ordinary log. */
export function normalizeConsoleLevel(raw: unknown): ConsoleLevel {
  return raw === 'error' || raw === 'warn' || raw === 'info' ? raw : 'log';
}

/**
 * WARNINGS THAT ARE REALLY BUGS.
 *
 * "Fix with AI" used to be offered on `error` rows only. That misses the single most common class of
 * real defect a React app prints — React's own warnings, which are `console.warn`: a missing list
 * `key` (which silently corrupts list state on reorder), a controlled input flipping to uncontrolled
 * (which silently drops the user's typing), `validateDOMNesting` (invalid HTML the browser then
 * repairs into a different tree). Every one of those is a shipped bug, and every one of them was
 * unfixable from the drawer.
 *
 * It is deliberately NOT "offer it on every warn". An app's own `console.warn('cache miss')` is not
 * a defect, and putting a paid AI repair button beside ordinary logging teaches the user that the
 * button means nothing — and spends their wallet proving it.
 */
const FIXABLE_WARN_PATTERNS: readonly RegExp[] = [
  /^\s*warning:\s/i,                                   // React prefixes all of its own with this
  /unique\s+"?key"?\s+prop/i,
  /two children with the same key/i,
  /validatedomnesting/i,
  /cannot appear as a (?:child|descendant) of/i,
  /failed prop type/i,
  /react hook/i,
  /state update on an unmounted component/i,
  /(?:controlled|uncontrolled) input to be (?:uncontrolled|controlled)/i,
  /is deprecated/i,
  /findDOMNode/i,
  /each child in a list/i,
];

/**
 * Should this row carry a "Fix with AI" button? Errors always; warnings only when the text names a
 * real code defect. PURE.
 */
export function consoleRowFixable(level: string, text: string): boolean {
  if (level === 'error') return true;
  if (level !== 'warn') return false;
  const t = (text || '').trim();
  if (!t) return false;
  return FIXABLE_WARN_PATTERNS.some((re) => re.test(t));
}

/**
 * Append a row to the ring buffer.
 *
 * DEDUPLICATES A REPEAT OF THE ROW ALREADY AT THE TAIL, counting it instead. A React render loop can
 * print the same warning hundreds of times a second; without this the drawer becomes an unreadable
 * wall of one identical line and the buffer evicts every OTHER message the app printed — which is
 * how the one row that mattered disappears.
 */
export function appendConsoleEntry(
  prev: readonly PreviewConsoleEntry[],
  entry: PreviewConsoleEntry,
  max: number = CONSOLE_BUFFER_MAX,
): PreviewConsoleEntry[] {
  const last = prev.length ? prev[prev.length - 1] : null;
  if (last && last.level === entry.level && last.text === entry.text) {
    const merged: PreviewConsoleEntry = { ...last, at: entry.at, repeats: (last.repeats ?? 1) + 1 };
    return [...prev.slice(0, -1), merged];
  }
  return [...prev, entry].slice(-Math.max(1, max));
}

/** Count of rows at `error` level — what the toolbar badge shows. */
export function consoleErrorCount(entries: readonly PreviewConsoleEntry[]): number {
  return entries.reduce((n, e) => n + (e.level === 'error' ? 1 : 0), 0);
}

/**
 * Filter the drawer by level and a free-text needle.
 *
 * 'problems' is its own filter rather than a level: with a hundred rows on screen, "show me only
 * what is wrong" is the question actually being asked, and it spans two levels.
 */
export type ConsoleFilter = 'all' | 'problems' | ConsoleLevel;

export function filterConsoleEntries(
  entries: readonly PreviewConsoleEntry[],
  filter: ConsoleFilter,
  needle: string,
): PreviewConsoleEntry[] {
  const q = (needle || '').trim().toLowerCase();
  return entries.filter((e) => {
    if (filter === 'problems') { if (e.level !== 'error' && e.level !== 'warn') return false; }
    else if (filter !== 'all' && e.level !== filter) return false;
    if (!q) return true;
    return e.text.toLowerCase().includes(q);
  });
}
