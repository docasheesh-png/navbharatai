/**
 * FILENAMES FOR A DOWNLOADED APK/AAB BUILD-FAILURE REPORT (admin 2026-09-15: "apk build report
 * download ka option hi nahi banaya aapne?").
 *
 * The APK Reports inbox could be read on screen and nothing else — no Download, no Copy — while the
 * two older inboxes beside it (Build Reports, User Reports) have had both since the day they shipped.
 * On screen the log excerpt sits in a scrolling box, so handing the cause to anyone else meant
 * retyping it. This module is the only part of that fix with real logic: turning a report into a
 * filename a browser will actually write.
 *
 * WHY SANITISING MATTERS HERE: `owner` and `repo` come from a USER's GitHub account, so they are
 * outside our control. A slash, a quote or a control character in a download name is refused or
 * silently rewritten by the browser, and the admin would be left with a file they cannot find. Same
 * reasoning as `apkReportId` on the server, which sanitises the same three values before they become
 * a Firestore document id.
 */

/** Everything the filename needs. Loose on purpose — the admin page holds these records untyped. */
export interface ApkReportNameParts {
  owner?: unknown;
  repo?: unknown;
  runId?: unknown;
  id?: unknown;
}

const FALLBACK = 'apk-build-report';

/** Keep only what is safe in a filename on every OS, and never emit an empty or dot-only part. */
function safePart(value: unknown): string {
  const text = String(value ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return text.slice(0, 60);
}

/**
 * `apk-build-report-<owner>-<repo>-<runId>.json`, dropping any part that sanitises to nothing.
 *
 * Falls back to the report's own id, and then to a bare name — a download must never be blocked
 * because a repository was called something unusual.
 */
export function apkReportFilename(report: ApkReportNameParts | null | undefined): string {
  const parts = [report?.owner, report?.repo, report?.runId].map(safePart).filter(Boolean);
  if (parts.length === 0) {
    const id = safePart(report?.id);
    return `${FALLBACK}${id ? `-${id}` : ''}.json`;
  }
  return `${FALLBACK}-${parts.join('-')}.json`;
}

/** `apk-build-reports-YYYY-MM-DD.json` for the whole inbox. Dated so two exports never collide. */
export function apkReportsArchiveFilename(when: Date = new Date()): string {
  const stamp = Number.isNaN(when.getTime()) ? new Date() : when;
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`;
  return `apk-build-reports-${date}.json`;
}
