/**
 * Which database Database Studio is looking at, and how honestly it says so (ROADMAP #1 Phase 2.1).
 *
 * THE BUG THIS REPLACES. The studio had two sources: hard-coded demo rows, and — if you typed a
 * collection name — NavBharatAI's OWN Firestore. Neither is the database the user's app runs on. The
 * second is worse than useless: it browses the platform's store, which by standing constraint is
 * never allowed to back a user's app. Both are gone; the real source is the Supabase project Phase 1
 * provisions into the user's own account.
 *
 * Demo data survives for exactly one case — nobody has connected a database yet — and it is labelled
 * as demo, because a sample row that looks live is a lie about where the user's data is.
 *
 * Pure and isomorphic so the label logic is testable without mounting the studio.
 */

export type StudioSource = 'live' | 'demo';

export interface StudioState {
  source: StudioSource;
  /** What the badge says. Never "Live" for sample rows. */
  label: string;
  /** Whether the rows on screen belong to the user. Drives every write-guard downstream. */
  isRealData: boolean;
  /** Shown when there is nothing real to show, so the empty state is a next step, not a dead end. */
  hint: string;
}

/**
 * Resolve what the studio should say.
 *
 * `connected` means the user linked their Supabase account; `hasDatabase` means a project actually
 * exists. They are separate on purpose: connecting without provisioning is a real, common state, and
 * telling that user "no database" without saying they can create one strands them one click away
 * from the fix.
 */
export function studioState(opts: { connected: boolean; hasDatabase: boolean }): StudioState {
  if (opts.connected && opts.hasDatabase) {
    return { source: 'live', label: 'Your database', isRealData: true, hint: '' };
  }
  if (opts.connected) {
    return {
      source: 'demo',
      label: 'Sample data',
      isRealData: false,
      hint: 'Your Supabase account is connected, but no database has been created yet. Open Settings → Database to create one — then your real data appears here.',
    };
  }
  return {
    source: 'demo',
    label: 'Sample data',
    isRealData: false,
    hint: 'These are sample rows, not your data. Connect a database in Settings → Database and your app\'s real tables appear here.',
  };
}

/**
 * Render one cell.
 *
 * Postgres hands back JSON for jsonb/array columns and `null` for empty ones. A null shown as the
 * text "null" is indistinguishable from a string containing "null" — which, in a data browser, is
 * the difference between "this field is empty" and "this field says null". The em-dash is the empty
 * marker and the caller styles it differently; the value is never invented.
 */
export function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '[unreadable]'; }
  }
  return String(value);
}

/** Rows containing the search text, matched across every column the way a person expects. */
export function filterRows<T extends Record<string, unknown>>(rows: T[], query: string): T[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return rows ?? [];
  return (rows ?? []).filter((row) =>
    row && typeof row === 'object' && Object.values(row).some((v) => renderCell(v).toLowerCase().includes(q)));
}

/**
 * "Showing 1–50 of about 1,200".
 *
 * "about" is doing real work: the row count is the planner's estimate, not `count(*)`, because an
 * exact count scans every table on every page load. Saying "about" is what makes the cheap number
 * honest instead of a precise-looking figure that is quietly wrong.
 */
export function pageSummary(opts: { offset: number; shown: number; rowEstimate?: number | null }): string {
  if (opts.shown === 0) return 'No rows';
  const from = opts.offset + 1;
  const to = opts.offset + opts.shown;
  const est = opts.rowEstimate;
  if (typeof est === 'number' && est > 0 && est >= to) {
    return `Showing ${from}–${to} of about ${est.toLocaleString()}`;
  }
  return `Showing ${from}–${to}`;
}
