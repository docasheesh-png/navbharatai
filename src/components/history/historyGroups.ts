// A HISTORY LIST IS A LIST OF TITLES — the date lives in the group heading, not on every row.
//
// 🔴 WHY (admin 2026-09-20, with Claude's and ChatGPT's own sidebars beside ours): *"navbharatai free
// me jo history button hai … isko popup ka ui badalna hai!! claude and gpt jaisa karo!! open chat
// button kyu banaya hai. hatao isko!!"*
//
// Ours had become a stack of cards, each carrying a title, a `CUI:` id, a mode tag, an App/Chat
// badge, a full timestamp, the agent name and a big **Open Chat** button — seven pieces of chrome to
// reach one conversation, three or four rows to a phone screen. Claude and ChatGPT show the title and
// nothing else, and the reason is not minimalism for its own sake: **the group heading carries the
// time for every row beneath it**, so no row has to spend a line saying when it was. That one move is
// what turns a card stack back into a list.
//
// 🔒 IT NEVER RE-SORTS. The caller's order is already meaningful — `sortMergedRows` puts LIVE
// professional conversations on top, and the Firestore query is newest-first — so this walks the rows
// in the order it was handed and only buckets them. A sort here would silently overrule that rule and
// nothing would fail; the live chat would just stop being first.
//
// PURE — no React, no DOM, no clock of its own (`now` is passed in, so the boundaries are testable).

/** The least a row must have for this module to place it. */
export interface RecencyRow {
  /** ISO string or millis — whatever the session carries. An unreadable value is still placed. */
  lastUpdated?: string | number | null;
  /** True for a professional conversation that is still open (there is no "when" yet). */
  profLive?: boolean;
}

export interface HistoryGroup<T> {
  /** The heading shown above the rows. */
  label: string;
  rows: T[];
}

const DAY_MS = 86_400_000;

/** Midnight of the day `t` falls in, in the VIEWER's own timezone — a local list needs local days. */
function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function timeOf(row: RecencyRow): number | null {
  const raw = row?.lastUpdated;
  if (raw == null) return null;
  const t = typeof raw === 'number' ? raw : new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Which heading a row belongs under. PURE.
 *
 * ⚠️ An unreadable or missing date lands in **Older** rather than in Today. A row with no timestamp
 * is not new — it is a row whose date we do not know, and putting it at the top would place it above
 * conversations that genuinely are from today. Wrong toward "old" costs one scroll; wrong toward
 * "today" is a claim about the row that nothing supports.
 */
export function recencyLabel(row: RecencyRow, now: number): string {
  if (row?.profLive) return 'Ongoing';
  const t = timeOf(row);
  if (t == null) return 'Older';
  const today = startOfDay(now);
  if (t >= today) return 'Today';
  if (t >= today - DAY_MS) return 'Yesterday';
  if (t >= today - 7 * DAY_MS) return 'Previous 7 days';
  if (t >= today - 30 * DAY_MS) return 'Previous 30 days';
  return 'Older';
}

/** The headings in the order they are shown. A group with no rows is never rendered. */
export const RECENCY_ORDER: readonly string[] = [
  'Ongoing', 'Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older',
];

/**
 * Bucket rows under their headings, keeping the caller's order inside each. PURE.
 *
 * Returns only the groups that actually have rows, in `RECENCY_ORDER` — so an account with three
 * conversations from today shows one heading, not six with five empty.
 */
export function groupSessionsByRecency<T extends RecencyRow>(rows: readonly T[], now: number): HistoryGroup<T>[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const label = recencyLabel(row, now);
    const bucket = buckets.get(label);
    if (bucket) bucket.push(row);
    else buckets.set(label, [row]);
  }
  return RECENCY_ORDER
    .filter((label) => (buckets.get(label)?.length ?? 0) > 0)
    .map((label) => ({ label, rows: buckets.get(label) as T[] }));
}
