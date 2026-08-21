// What a user report IS — shared by the sheet the user fills in, the route that stores it, and the
// admin screen that reads it. One definition, so those three can never disagree about a report.
//
// ADMIN 2026-08-21: report anything, anywhere in NavBharatAI, with a screenshot; the admin reads every
// one, can see WHO reported and WHO was reported, open either account, and act.
//
// WHY A `target` INSTEAD OF SEPARATE REPORT TYPES. The store already had an app-only report that
// nothing read. Adding a second, user-only one beside it would give us two half-systems and two admin
// screens. A report is one thing with a subject: an app, a person, or the app itself misbehaving.

/** What is being reported. */
export type ReportTargetKind = 'app' | 'user' | 'bug';

export interface ReportTarget {
  kind: ReportTargetKind;
  /** The store app id, or the reported user's uid. Absent for a plain bug report. */
  id?: string;
  /**
   * The uid this report is ABOUT, when there is one.
   *
   * For an app report this is the app's OWNER, resolved on the SERVER from the app id — never taken
   * from the client. A reporter must not be able to point a complaint at somebody they choose.
   */
  ownerUid?: string;
}

/** The technical facts we attach ourselves, so the user does not have to describe them. */
export interface ReportContext {
  /** Which screen they were on. */
  view?: string;
  /** App version / build, when the native shell knows it. */
  build?: string;
  platform?: string;
  userAgent?: string;
}

export type ReportStatus = 'open' | 'reviewed' | 'actioned' | 'dismissed';

export interface UserReport {
  id: string;
  reporterUid: string;
  target: ReportTarget;
  message: string;
  /** True when a screenshot was attached (the image itself lives outside the doc — see the store). */
  hasScreenshot: boolean;
  context: ReportContext;
  at: number;
  status: ReportStatus;
  /** What the admin wrote when they handled it. */
  adminNote?: string;
  handledAt?: number;
}

/** Enough to be actionable, short enough to store. */
export const MESSAGE_MIN = 5;
export const MESSAGE_MAX = 2000;

/**
 * A screenshot is compressed to JPEG by the client before it is sent; this is the ceiling the server
 * enforces. Deliberately under Firestore's 1 MiB document limit even with the rest of the record, and
 * the image is stored in its own document besides — a report must never fail to save because the
 * picture was large.
 */
export const SCREENSHOT_MAX_CHARS = 700_000;

/**
 * Validate a submission. Pure, so both sides run the SAME rules and the user never meets a refusal the
 * form could have shown them first.
 */
export function validateReport(input: {
  message?: unknown;
  targetKind?: unknown;
  targetId?: unknown;
  screenshot?: unknown;
}): { ok: true; message: string; kind: ReportTargetKind; targetId?: string; screenshot?: string }
  | { ok: false; error: string } {
  const message = (typeof input.message === 'string' ? input.message : '').trim();
  if (message.length < MESSAGE_MIN) {
    return { ok: false, error: 'Please say briefly what went wrong — a few words is enough.' };
  }
  if (message.length > MESSAGE_MAX) {
    return { ok: false, error: `Please keep it under ${MESSAGE_MAX} characters.` };
  }

  const kindRaw = typeof input.targetKind === 'string' ? input.targetKind : 'bug';
  if (kindRaw !== 'app' && kindRaw !== 'user' && kindRaw !== 'bug') {
    return { ok: false, error: 'That is not something that can be reported.' };
  }
  const kind = kindRaw as ReportTargetKind;

  const targetId = typeof input.targetId === 'string' ? input.targetId.trim() : '';
  if ((kind === 'app' || kind === 'user') && !targetId) {
    return { ok: false, error: 'This report is missing the thing it is about.' };
  }

  const screenshot = typeof input.screenshot === 'string' ? input.screenshot : '';
  if (screenshot) {
    if (!screenshot.startsWith('data:image/')) {
      return { ok: false, error: 'The attachment could not be read as an image.' };
    }
    if (screenshot.length > SCREENSHOT_MAX_CHARS) {
      return { ok: false, error: 'That screenshot is too large. Try a smaller one.' };
    }
  }

  return {
    ok: true,
    message,
    kind,
    ...(targetId ? { targetId } : {}),
    ...(screenshot ? { screenshot } : {}),
  };
}

/** A one-line summary for the admin list. Never invents anything the report does not contain. */
export function reportHeadline(r: Pick<UserReport, 'target' | 'message'>): string {
  const what = r.target.kind === 'app' ? 'App' : r.target.kind === 'user' ? 'User' : 'Problem';
  const first = r.message.replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${what} · ${first}${r.message.length > 80 ? '…' : ''}`;
}
