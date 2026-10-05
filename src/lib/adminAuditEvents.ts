// WHICH AUDIT EVENTS ARE ADMIN ACTIONS, AND HOW ONE READS ON THE AUDIT LOG SCREEN (admin panel audit, PR 3).
//
// Every admin action already wrote a line through `audit()` — with the admin's name and reason since PR 1 —
// but those lines landed in `server_logs` among every other server event, and the only way to read them
// was the Monitor's last 40 lines. This module is the one definition of "an admin action", read by the
// writer (audit.ts copies these into `admin_audit_log`) and by the screen (to label each row). PURE.

/** Admin actions whose event name does not start with ADMIN_: the store-admin decisions, and one older name. */
const STORE_ADMIN_EVENTS = new Set([
  'GALLERY_REVIEW_DECISION',
  'STORE_APK_REVIEW_DECISION',
  'STORE_WEB_REVIEW_DECISION',
  'STORE_COMMENT_REMOVED_BY_ADMIN',
  // The admin's reply to a user's report (routes/reports.ts) — an admin action whose name predates the prefix.
  'REPORT_REPLY',
]);

/**
 * ADMIN_-named events that are NOT an administrator's action, and why. Kept out of the admin audit log:
 * the first fires on every request carrying a missing or expired panel token (a stale tab polling, or a
 * stranger probing), so it would bury the real actions and pay a database write per request; the second
 * is the platform failing to save a report, which no admin did. Both stay in the general server log.
 * `tests/adminAuditLogScreen.test.ts` fails on a NEW ADMIN_ event that is in neither list's decision.
 */
export const NOT_ADMIN_ACTIONS: Readonly<Record<string, string>> = {
  ADMIN_ACCESS_DENIED: 'a refused request with no valid admin token — not an action, and fires per request',
  ADMIN_BUILD_REPORT_SAVE_FAILED: 'the platform failing to store a report — no admin did anything',
};

/** Is this audit event an action taken by (or against the login of) an administrator? */
export function isAdminAuditEvent(event: unknown): boolean {
  const e = typeof event === 'string' ? event : '';
  if (e in NOT_ADMIN_ACTIONS) return false;
  return /^ADMIN_[A-Z0-9_]+$/.test(e) || STORE_ADMIN_EVENTS.has(e);
}

/** The fields a row of the audit log needs, taken from an audit entry's metadata. */
export interface AdminAuditRow {
  ts: number;
  event: string;
  /** Who acted: the admin panel login, the store admin's email, or '' when the event does not say. */
  actor: string;
  /** What it acted on: an app, a user, a report — the first id the entry carries. */
  target: string;
  /** The admin's own reason or review note, when there was one. */
  reason: string;
  /** ok / failed / blocked / not-saved … as the route recorded it, or '' when it did not. */
  result: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

const TARGET_KEYS = ['workspaceId', 'userId', 'targetUid', 'id', 'commentId', 'channelId', 'reportId', 'appKey'] as const;

export function adminAuditRow(entry: { ts?: unknown; event?: unknown } & Record<string, unknown>): AdminAuditRow {
  const target = TARGET_KEYS.map((k) => str(entry[k])).find(Boolean) || '';
  return {
    ts: typeof entry.ts === 'number' ? entry.ts : 0,
    event: str(entry.event),
    actor: str(entry.admin) || str(entry.reviewer) || '',
    target,
    reason: str(entry.reason) || str(entry.note) || '',
    result: str(entry.result),
  };
}

/** A readable label for an event name: ADMIN_APP_TAKEDOWN → "App takedown". */
export function adminEventLabel(event: string): string {
  const words = event.replace(/^ADMIN_/, '').toLowerCase().split('_').filter(Boolean);
  if (!words.length) return event;
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
