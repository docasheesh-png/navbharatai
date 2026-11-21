// WHAT THE ADMIN ANALYTICS TILES COVER (Firestore bill audit, 2026-11-21).
//
// `/api/admin/analytics` stopped reading whole collections: chat usage, token purchases and recent purchases are
// now the last N days, while total users and total revenue stay all-time (aggregations). A tile that silently
// changed from "all time" to "30 days" would be a number with the wrong label, so the server states the window
// in its payload and every windowed tile appends this note. An old server that sends no window gets no note.

export interface AnalyticsWindow {
  days: number;
  usageRows?: number;
  usageRowCap?: number;
  usageCapped?: boolean;
}

/** " · last 30 days", plus a warning when the chat rows were capped; '' when the server stated no window. PURE. */
export function analyticsWindowNote(w: unknown): string {
  if (!w || typeof w !== 'object') return '';
  const { days, usageCapped, usageRowCap } = w as AnalyticsWindow;
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return '';
  const base = ` · last ${Math.floor(days)} days`;
  return usageCapped === true && typeof usageRowCap === 'number'
    ? `${base} (newest ${usageRowCap.toLocaleString('en-IN')} chat turns only)`
    : base;
}
