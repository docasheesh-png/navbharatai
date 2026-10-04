// CHANGE ENGINE — the app's OPEN ISSUE QUEUE, with a lifecycle that only evidence can move.
//
// WHY THIS EXISTS (Change Intelligence Engine, slice 1, 2026-10-04). A build report already names what is
// wrong with an app — dozens of codes, each with a severity. And then the report is filed, and the next
// build starts knowing none of it. The audit that preceded this module found three dead ends of exactly
// that shape: `recordDebt` writes security findings on every build and nothing reads them back;
// `WorkspaceMemory.openErrors` keeps three tsc lines; the diagnostics store is read by the report screen
// and never by the builder. So a problem the platform saw on Monday is rediscovered on Tuesday, or not at
// all, and a report with twelve problems produces twelve lines nobody owns.
//
// The queue gives every unresolved APP finding an id and an owner, and moves it through:
//
//   DETECTED  — seen unresolved in one build.
//   TRIAGED   — confirmed as real: seen unresolved again in a later build, or an ERROR on first sight.
//               (A one-off warning that never recurs is not worth a builder's attention — it stays
//               DETECTED and ages out.)
//   ASSIGNED  — handed to the builder as named work in a build's context.
//   FIXED     — absent from a build that ran its checks to the end (the release gate was recorded).
//   VERIFIED  — absent again from the NEXT such build. One clean pass can be luck; two cannot.
//
// 🔒 NOTHING MOVES ON A CLAIM. FIXED/VERIFIED need a build whose checks actually ran (`checksRan`), and
// an issue that reappears after FIXED goes straight back to TRIAGED. A build that was stopped, failed or
// never reached its gate cannot fix anything in this ledger — "we did not look" is never "it is gone".
//
// 🔒 ONLY APP FINDINGS ENTER. Provider, sandbox and process-only codes are about NavBharatAI, not the
// user's app (`isAppFinding`), and the summary code RELEASE_GATE is excluded because it restates the
// others. Stored text is redacted of secrets and provider names before it is written — the queue is
// rendered into a builder prompt and may later be shown to the user.
//
// PURE.

import { isAppFinding } from '../BuildDiagnostics';
import type { BuildIssue } from '../BuildDiagnostics';

export type IssueStatus = 'detected' | 'triaged' | 'assigned' | 'fixed' | 'verified';

export interface QueuedIssue {
  /** Stable id: ISS-001. */
  id: string;
  /** Dedup key: code + normalised message. */
  key: string;
  code: string;
  severity: 'warning' | 'error';
  /** Redacted, platform-authored message, ≤ 240 chars. */
  message: string;
  status: IssueStatus;
  firstSeen: number;
  lastSeen: number;
  /** How many builds have seen it unresolved. */
  seenCount: number;
  /** Consecutive check-complete builds it was absent from. */
  cleanPasses: number;
  /** The change ids that saw it. Last 5. */
  changes: string[];
  /** The file it was found in, when the finding names one (security findings do). */
  file?: string;
}

export interface IssueQueue {
  issues: QueuedIssue[];
  nextIss: number;
}

export const EMPTY_QUEUE: IssueQueue = Object.freeze({ issues: [], nextIss: 1 }) as IssueQueue;

export const MAX_OPEN_ISSUES = 150;
/** Resolved (verified) issues kept for the record. */
export const MAX_CLOSED_ISSUES = 50;
/** A DETECTED issue that has not recurred for this many check-complete builds ages out. */
export const DETECTED_AGE_OUT_PASSES = 3;
/** Codes that summarise other findings, so queuing them would count one problem twice. */
const SUMMARY_CODES = new Set(['RELEASE_GATE', 'CHANGE_CLASSIFIED', 'CHANGE_RECORDED', 'ISSUE_QUEUE']);

export function issId(n: number): string {
  return `ISS-${String(n).padStart(3, '0')}`;
}

/** Dedup key — digits stripped so "3 fields unlabelled" and "4 fields unlabelled" are one issue. */
export function issueKey(code: string, message: string): string {
  const norm = String(message || '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${code}::${norm}`;
}

const OPEN: ReadonlySet<IssueStatus> = new Set(['detected', 'triaged', 'assigned', 'fixed']);

export function parseIssueQueue(raw: unknown): IssueQueue {
  if (!raw || typeof raw !== 'object') return { issues: [], nextIss: 1 };
  const r = raw as { issues?: unknown; nextIss?: unknown };
  const statuses = new Set<IssueStatus>(['detected', 'triaged', 'assigned', 'fixed', 'verified']);
  const issues: QueuedIssue[] = [];
  for (const x of Array.isArray(r.issues) ? r.issues : []) {
    if (!x || typeof x !== 'object') continue;
    const i = x as Record<string, unknown>;
    if (typeof i.id !== 'string' || typeof i.key !== 'string' || typeof i.code !== 'string') continue;
    if (!statuses.has(i.status as IssueStatus)) continue;
    issues.push({
      id: i.id, key: i.key, code: i.code,
      severity: i.severity === 'error' ? 'error' : 'warning',
      message: typeof i.message === 'string' ? i.message.slice(0, 240) : '',
      status: i.status as IssueStatus,
      firstSeen: Number(i.firstSeen) || 0,
      lastSeen: Number(i.lastSeen) || 0,
      seenCount: Number(i.seenCount) || 1,
      cleanPasses: Number(i.cleanPasses) || 0,
      changes: Array.isArray(i.changes) ? (i.changes as unknown[]).filter((c): c is string => typeof c === 'string').slice(-5) : [],
      ...(typeof i.file === 'string' ? { file: i.file.slice(0, 200) } : {}),
    });
  }
  const maxSeen = issues.reduce((m, it) => Math.max(m, Number(it.id.replace(/^ISS-/, '')) || 0), 0);
  const nextIss = typeof r.nextIss === 'number' && r.nextIss > maxSeen ? Math.floor(r.nextIss) : maxSeen + 1;
  return { issues, nextIss };
}

/** Which of a build's recorded issues are unresolved APP findings the queue should carry. */
export function queueableFindings(issues: ReadonlyArray<Pick<BuildIssue, 'phase' | 'code' | 'severity' | 'message' | 'autoResolved' | 'observation'>>): Array<{ code: string; severity: 'warning' | 'error'; message: string }> {
  const out: Array<{ code: string; severity: 'warning' | 'error'; message: string }> = [];
  for (const i of issues || []) {
    if (!i || i.severity === 'info' || i.autoResolved || i.observation === true) continue;
    if (SUMMARY_CODES.has(i.code)) continue;
    if (!isAppFinding(i)) continue;
    out.push({ code: i.code, severity: i.severity === 'error' ? 'error' : 'warning', message: String(i.message || '') });
  }
  return out;
}

export interface QueueFoldInput {
  /** Unresolved app findings of THIS build (already redacted). */
  findings: ReadonlyArray<{ code: string; severity: 'warning' | 'error'; message: string; file?: string }>;
  changeId: string;
  now: number;
  /** True only when the build reached its release gate — the evidence that its checks ran. */
  checksRan: boolean;
  /**
   * Was the check that found THIS issue able to see it this time? Absence only fixes an issue whose check
   * could have found it — a security finding in a file this build never analysed is not gone, it is unseen.
   * Default: yes.
   */
  couldSee?: (issue: QueuedIssue) => boolean;
}

export interface QueueFold {
  queue: IssueQueue;
  opened: QueuedIssue[];
  reopened: QueuedIssue[];
  fixed: QueuedIssue[];
  verified: QueuedIssue[];
}

/** Fold one build's findings into the queue. Pure; never throws. */
export function foldBuildFindings(queue: IssueQueue, input: QueueFoldInput): QueueFold {
  const issues = queue.issues.map((i) => ({ ...i, changes: [...i.changes] }));
  let nextIss = queue.nextIss;
  const opened: QueuedIssue[] = [];
  const reopened: QueuedIssue[] = [];
  const fixed: QueuedIssue[] = [];
  const verified: QueuedIssue[] = [];
  const seenKeys = new Set<string>();

  for (const f of input.findings) {
    const key = issueKey(f.code, f.message);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const existing = issues.find((i) => i.key === key);
    if (existing) {
      const wasClosed = existing.status === 'fixed' || existing.status === 'verified';
      existing.seenCount += 1;
      existing.cleanPasses = 0;
      existing.lastSeen = input.now;
      existing.message = f.message.slice(0, 240);
      if (f.severity === 'error') existing.severity = 'error';
      if (!existing.changes.includes(input.changeId)) existing.changes = [...existing.changes, input.changeId].slice(-5);
      // A recurrence is the evidence that makes it real; an assigned issue stays assigned (still owed).
      if (wasClosed) { existing.status = 'triaged'; reopened.push(existing); }
      else if (existing.status === 'detected') existing.status = 'triaged';
      continue;
    }
    const it: QueuedIssue = {
      id: issId(nextIss++), key, code: f.code, severity: f.severity, message: f.message.slice(0, 240),
      status: f.severity === 'error' ? 'triaged' : 'detected',
      firstSeen: input.now, lastSeen: input.now, seenCount: 1, cleanPasses: 0, changes: [input.changeId],
      ...(f.file ? { file: f.file.slice(0, 200) } : {}),
    };
    issues.push(it);
    opened.push(it);
  }

  if (input.checksRan) {
    for (const it of issues) {
      if (seenKeys.has(it.key) || !OPEN.has(it.status)) continue;
      if (input.couldSee && !input.couldSee(it)) continue; // unseen is not fixed
      it.cleanPasses += 1;
      if (it.status === 'fixed' && it.cleanPasses >= 2) { it.status = 'verified'; verified.push(it); }
      else if (it.status === 'triaged' || it.status === 'assigned') { it.status = 'fixed'; fixed.push(it); }
    }
  }

  // Age out one-off detections; keep the closed record bounded; never exceed the open cap.
  const kept = issues.filter((i) => !(i.status === 'detected' && i.cleanPasses >= DETECTED_AGE_OUT_PASSES));
  const open = kept.filter((i) => i.status !== 'verified');
  const closed = kept.filter((i) => i.status === 'verified').sort((a, b) => b.lastSeen - a.lastSeen).slice(0, MAX_CLOSED_ISSUES);
  const openSorted = open.sort((a, b) => sevRank(b) - sevRank(a) || b.seenCount - a.seenCount || b.lastSeen - a.lastSeen).slice(0, MAX_OPEN_ISSUES);
  return { queue: { issues: [...openSorted, ...closed], nextIss }, opened, reopened, fixed, verified };
}

function sevRank(i: QueuedIssue): number {
  return i.severity === 'error' ? 1 : 0;
}

/** The issues worth handing to a builder: triaged or already assigned, highest severity first. */
export function workableIssues(queue: IssueQueue, limit = 8): QueuedIssue[] {
  return queue.issues
    .filter((i) => i.status === 'triaged' || i.status === 'assigned')
    .sort((a, b) => sevRank(b) - sevRank(a) || b.seenCount - a.seenCount)
    .slice(0, limit);
}

/** Mark the given issues ASSIGNED (they were handed to a build). Pure. */
export function markAssigned(queue: IssueQueue, ids: ReadonlyArray<string>, changeId: string): IssueQueue {
  const set = new Set(ids);
  return {
    nextIss: queue.nextIss,
    issues: queue.issues.map((i) => set.has(i.id) && (i.status === 'triaged' || i.status === 'assigned')
      ? { ...i, status: 'assigned' as const, changes: i.changes.includes(changeId) ? i.changes : [...i.changes, changeId].slice(-5) }
      : i),
  };
}

/**
 * The builder-facing block. Only on standard/deep changes, and framed as known problems the user did NOT
 * ask about in this message — so the builder fixes them when it touches that code, and never lets them
 * out-shout the current request.
 */
export function renderIssuesForBuilder(issues: ReadonlyArray<QueuedIssue>): string {
  if (!issues.length) return '';
  return [
    'KNOWN OPEN ISSUES IN THIS APP (found by earlier checks; not part of the current request — fix one only if your change touches that code, never at the expense of the request):',
    ...issues.map((i) => `  • ${i.id} [${i.severity}] ${i.message}`),
  ].join('\n');
}
