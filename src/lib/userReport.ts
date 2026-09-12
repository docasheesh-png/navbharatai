// What a user report IS — shared by the sheet the user fills in, the route that stores it, and the
// admin screen that reads it. One definition, so those three can never disagree about a report.
//
// ADMIN 2026-08-21: report anything, anywhere in NavBharatAI, with a screenshot; the admin reads every
// one, can see WHO reported and WHO was reported, open either account, and act.
//
// WHY A `target` INSTEAD OF SEPARATE REPORT TYPES. The store already had an app-only report that
// nothing read. Adding a second, user-only one beside it would give us two half-systems and two admin
// screens. A report is one thing with a subject: an app, a person, or the app itself misbehaving.

import type { OverflowFinding } from './reportDiagnostics';

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

/**
 * The technical facts we attach ourselves, so the user does not have to describe them.
 *
 * ADMIN 2026-09-12, on a real report they could not act on: *"aapne yeh aisa reporting system banaya
 * hai ki user ki problem theek hi nahi ki ja sakti."* Everything added below was knowable by the app
 * at the moment Send was pressed, and we were asking a non-technical person to type it from memory
 * instead — which is how "some content goes outside the mobile" arrives with no width, no build and
 * no element in it.
 *
 * 🔒 Each field is OPTIONAL and each is allowed to be absent, but "we looked and found nothing" is
 * never encoded as absence — see `overflowScanned`.
 */
export interface ReportContext {
  /** Which screen they were on. */
  view?: string;
  /** The frontend build stamp (`__BUILD_TIME__`) — which code this person is actually running. */
  build?: string;
  /** The native shell's own versionCode, when there is one. A web visitor has none. */
  appBuild?: string;
  platform?: string;
  userAgent?: string;
  /** CSS-pixel viewport, e.g. `390x844`. The single most useful fact for any layout complaint. */
  viewport?: string;
  /** Device pixel ratio, e.g. 3 — a 3x phone renders differently from a 2x one at the same width. */
  dpr?: number;
  /** Whether the browser believed it was online when the report was sent. */
  online?: boolean;
  /** The Network Information API's label for the connection, e.g. `4g`, `slow-2g`. */
  connection?: string;
  /** The browser's language, which decides text length and therefore a lot of layout. */
  language?: string;
  /** Elements reaching past the right edge of the screen, worst first. */
  overflow?: OverflowFinding[];
  /**
   * Whether the off-screen scan RAN.
   *
   * 🔒 The reason this is a separate flag rather than an empty `overflow` array: an empty list that
   * silently meant "not measured" would send the admin looking for a layout bug that was never
   * checked for — worse than the vague report it replaced.
   */
  overflowScanned?: boolean;
  /** True when the scan hit its element budget, so a clean result is not proof of a clean page. */
  overflowTruncated?: boolean;
  /** The last few uncaught errors in that tab, oldest first. Messages only, never stacks. */
  errors?: string[];
}

/**
 * WHAT KIND of problem, in the reporter's own terms.
 *
 * WHY A PICKER AT ALL, when there is already a free-text box. Because the free-text box is what
 * produced "App is not responsive and sometimes it does not work in Mobile phones" — a sentence that
 * could mean a layout bug, a hang, or a dead button, and that costs a round trip to disambiguate we
 * had no way to make. One tap removes that ambiguity before it is created, and it lets the box ask
 * the RIGHT follow-up question instead of a generic one.
 */
export const PROBLEM_KINDS = [
  { id: 'layout', label: 'Looks broken / goes off the screen', ask: 'Which part goes off the screen, and on which page?' },
  { id: 'slow', label: 'Slow, stuck or frozen', ask: 'What were you doing when it got stuck? Did it recover?' },
  { id: 'action', label: "A button didn't work", ask: 'Which button, and what did you expect it to do?' },
  { id: 'wrong', label: 'It did the wrong thing', ask: 'What did you expect, and what happened instead?' },
  { id: 'signin', label: 'Sign-in or my account', ask: 'What happens when you try? Any message on screen?' },
  { id: 'money', label: 'Payment, tokens or billing', ask: 'What did you pay or expect, and what does it show now?' },
  { id: 'other', label: 'Something else', ask: 'What happened? Even one line helps.' },
] as const;

export type ProblemKind = typeof PROBLEM_KINDS[number]['id'];

export function isProblemKind(v: unknown): v is ProblemKind {
  return typeof v === 'string' && PROBLEM_KINDS.some((k) => k.id === v);
}

/** The label for a kind, or '' for anything unknown — never a guess, never a raw id shown to a human. */
export function problemKindLabel(v: unknown): string {
  return PROBLEM_KINDS.find((k) => k.id === v)?.label ?? '';
}

/** The question the text box should be asking, once a kind is chosen. */
export function problemKindAsk(v: unknown): string {
  return PROBLEM_KINDS.find((k) => k.id === v)?.ask ?? 'What happened? Even one line helps.';
}

export type ReportStatus = 'open' | 'reviewed' | 'actioned' | 'dismissed';

/**
 * One message in the conversation ON a report.
 *
 * ADMIN 2026-09-12, the other half of *"jisse uski help ho sake"*: capturing more facts told us WHAT
 * a report meant; it still left no way to ASK the person anything. A report with no reply channel is
 * a suggestion box — the reporter cannot be asked "which page?", cannot be told it is fixed, and
 * learns nothing from having written in, which is exactly how people stop reporting.
 */
export interface ReportMessage {
  /** Who wrote it. `admin` is shown to the user as NavBharatAI, never as a person's name. */
  from: 'admin' | 'user';
  text: string;
  at: number;
}

/** Long enough for a real answer, short enough that the whole thread stays far under Firestore's cap. */
export const REPLY_MAX = 1000;
export const REPLY_MIN = 1;

/**
 * How many messages one report keeps.
 *
 * ⚠️ A CAP, NOT A PREFERENCE. The thread lives on the report DOCUMENT, which Firestore stops at
 * 1 MiB — and the failure mode of an uncapped thread is not an untidy screen, it is a reply that
 * silently refuses to save on a conversation that was going well.
 */
export const THREAD_MAX = 30;

/** Shared by the sheet, both reply routes and the admin screen, so a refusal is never a surprise. */
export function validateReply(text: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const t = (typeof text === 'string' ? text : '').trim();
  if (t.length < REPLY_MIN) return { ok: false, error: 'Write something first.' };
  if (t.length > REPLY_MAX) return { ok: false, error: `Please keep it under ${REPLY_MAX} characters.` };
  return { ok: true, text: t };
}

/**
 * Append a message and keep the thread bounded. PURE.
 *
 * 🔒 IT DROPS FROM THE FRONT, NEVER THE BACK. Losing the newest message would lose the one the person
 * is reading right now; losing the oldest costs the opening line, which the report's own `message`
 * field still holds. So the one irreplaceable thing is never what gets dropped.
 */
export function appendReportMessage(
  existing: readonly ReportMessage[] | undefined,
  message: ReportMessage,
  max: number = THREAD_MAX,
): ReportMessage[] {
  const cap = Math.max(1, max);
  const next = [...(existing ?? []), message];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * True when the reporter is owed an answer — the last word is theirs.
 *
 * This is what stops a conversation dying quietly: a report the user replied to must come BACK to
 * the top of the admin's queue, not stay filed under whatever the admin marked it before.
 */
export function awaitingAdmin(messages: readonly ReportMessage[] | undefined): boolean {
  const last = messages?.[messages.length - 1];
  return !!last && last.from === 'user';
}

export interface UserReport {
  id: string;
  reporterUid: string;
  target: ReportTarget;
  /** The reporter's own one-tap answer to "what kind of problem is this?". */
  problemKind?: ProblemKind;
  message: string;
  /** True when a screenshot was attached (the image itself lives outside the doc — see the store). */
  hasScreenshot: boolean;
  context: ReportContext;
  at: number;
  status: ReportStatus;
  /** What the admin wrote when they handled it. */
  adminNote?: string;
  handledAt?: number;
  /** The conversation on this report, oldest first. Absent on every report filed before replies existed. */
  messages?: ReportMessage[];
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
  problemKind?: unknown;
}): { ok: true; message: string; kind: ReportTargetKind; targetId?: string; screenshot?: string; problemKind?: ProblemKind }
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

  // 🔒 OPTIONAL ON PURPOSE, even though the current sheet always sends it.
  //
  // The Android app is BUNDLED (`capacitor.config.ts` has no `server.url`), so an installed build
  // keeps running the frontend it shipped with until the user takes a new one from Play. Making the
  // kind mandatory here would make every report from every older install fail — silently turning the
  // one channel a stuck user has into a dead button, in the name of a tidier record. An unknown value
  // is dropped rather than refused, for the same reason.
  const problemKind = isProblemKind(input.problemKind) ? input.problemKind : undefined;

  return {
    ok: true,
    message,
    kind,
    ...(targetId ? { targetId } : {}),
    ...(screenshot ? { screenshot } : {}),
    ...(problemKind ? { problemKind } : {}),
  };
}

/**
 * A one-line summary for the admin list. Never invents anything the report does not contain.
 *
 * When the reporter chose a kind, THAT is the lead — "Frozen · the build screen stops at 40%" says
 * more at a glance than "Problem · the build screen stops at 40%", and it is the reporter's own word
 * rather than our inference.
 */
export function reportHeadline(r: Pick<UserReport, 'target' | 'message'> & { problemKind?: ProblemKind }): string {
  const kindLabel = problemKindLabel(r.problemKind);
  const what = r.target.kind === 'app' ? 'App' : r.target.kind === 'user' ? 'User' : (kindLabel || 'Problem');
  const first = r.message.replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${what} · ${first}${r.message.length > 80 ? '…' : ''}`;
}
