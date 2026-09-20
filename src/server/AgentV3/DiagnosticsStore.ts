// AgentV3 — Durable BUILD DIAGNOSTICS persistence (so the "Build report" is never empty).
//
// The diagnostics report was held ONLY in an in-memory Map keyed by userId (lastDiagnostics). On
// Cloud Run that breaks the download: the build runs on instance A, but the "Build report" GET
// load-balances to instance B (or the user reloaded, losing the client copy) → empty report. This
// store persists the final report to Firestore keyed by workspaceId so the download survives
// instance rotation and page reloads.
//
// Pattern mirrors WorkspaceFileStore: firebase-admin, VITEST-skip, best-effort, never throws.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { audit, truncateForAudit } from '../lib/audit';
import { capProblems, outcomeCodeOf, severityOfOutcome, appWasSeenRunning, stoppedByUser, type BuildDiagnosticsReport } from './BuildDiagnostics';
import { trimChannel, dropChannel, mergeTruncation } from './reportTruncation';
import { redactSecrets } from './SecretRedactor';
import { summarizeModelPerformance, type ModelPerformanceSummary } from './modelPerformance';

const COLLECTION = 'workspace_diagnostics_v3';
/** Firestore's hard per-document limit is 1 MB; stay well under it after trimming. */
const MAX_DOC_BYTES = 900 * 1024;

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null; // unit tests never hit real Firestore
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

// ── NEVER-LOSE-THE-REPORT layer (admin 2026-07-07: "build report gayab nahi honi chahiye chahe
// kuch bhi ho") ─────────────────────────────────────────────────────────────────────────────────
// Root cause (recorded as an open root cause in PROGRESS.md until now): every persistence path
// swallowed its failure — `.catch(() => {})` at the callsites AND `catch { /* best-effort */ }`
// here — so a Firestore write failure (quota, network, IAM) lost the report SILENTLY: no log, no
// retry, no trace. The class dies here, centrally, in three layers:
//   1. RETRY    — every write gets bounded retries with backoff (transient failures self-heal).
//   2. HONESTY  — a final failure is LOUD: a structured console.error (greppable in Cloud Logging)
//                 plus a DIAGNOSTICS_SAVE_FAILED audit event. Never silent again.
//   3. FALLBACK — the trimmed report is stashed in a bounded in-memory emergency cache that the
//                 loaders consult whenever the durable read comes back empty — so even with
//                 Firestore fully down, the report stays downloadable from this instance until
//                 durability returns.
// "Best-effort" still holds for the BUILD (a persistence failure never blocks or breaks a build);
// it no longer means "silent".

const RETRY_DELAYS_MS = [400, 1500];

/**
 * Run one persistence attempt with bounded retries + backoff. Returns the outcome instead of
 * throwing, so callers can report honestly. Pure control flow (sleep injectable) + unit-tested.
 */
export async function persistWithRetry(
  attempt: () => Promise<void>,
  opts?: { delaysMs?: number[]; sleep?: (ms: number) => Promise<void> },
): Promise<{ ok: boolean; error?: unknown; attempts: number }> {
  const delays = opts?.delaysMs ?? RETRY_DELAYS_MS;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let i = 0; i <= delays.length; i++) {
    try {
      await attempt();
      return { ok: true, attempts: i + 1 };
    } catch (err) {
      lastErr = err;
      if (i < delays.length) await sleep(delays[i]);
    }
  }
  return { ok: false, error: lastErr, attempts: delays.length + 1 };
}

export type EmergencyKind = 'workspace' | 'user';
/** Bounded: reports are already trimmed to ≤900 KB, so 10+10 entries ≈ ≤18 MB absolute worst case. */
const EMERGENCY_MAX_ENTRIES = 10;
const emergencyCaches: Record<EmergencyKind, Map<string, { report: BuildDiagnosticsReport; savedAt: number }>> = {
  workspace: new Map(),
  user: new Map(),
};

/** Hold a report in the in-memory emergency cache (LRU, bounded). Unit-tested. */
export function emergencyStash(kind: EmergencyKind, key: string, report: BuildDiagnosticsReport): void {
  if (!key || !report) return;
  const cache = emergencyCaches[kind];
  if (cache.has(key)) cache.delete(key); // refresh LRU position
  cache.set(key, { report, savedAt: Date.now() });
  while (cache.size > EMERGENCY_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Recall a report from the emergency cache, or null. Unit-tested. */
export function emergencyRecall(kind: EmergencyKind, key: string): BuildDiagnosticsReport | null {
  if (!key) return null;
  return emergencyCaches[kind].get(key)?.report ?? null;
}

/** Test hook: wipe the emergency caches so unit tests stay independent of each other. */
export function emergencyClearForTest(): void {
  emergencyCaches.workspace.clear();
  emergencyCaches.user.clear();
}

/** A save definitively failed (after retries / with Firestore unavailable): stash + be LOUD. */
function reportSaveFailure(kind: EmergencyKind, key: string, report: BuildDiagnosticsReport, error: unknown): void {
  emergencyStash(kind, key, report);
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[DIAGNOSTICS] SAVE FAILED (${kind}=${key}) after retries — report held in the in-memory emergency cache. Cause: ${message}`);
  try { audit('DIAGNOSTICS_SAVE_FAILED', { kind, key, error: truncateForAudit(message) }); } catch { /* the honesty layer itself must never throw */ }
}

/** Keep the last `n` items of an array (newest), or the whole array if shorter. */
function lastN<T>(arr: T[] | undefined, n: number): T[] | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr.length <= n ? arr : arr.slice(arr.length - n);
}
function cap(s: string | undefined, n: number): string | undefined {
  if (s == null) return s;
  return s.length <= n ? s : `${s.slice(0, n)}…[truncated]`;
}

/**
 * SECURITY Phase 2.1 (admin-approved 2026-07-07) — mask secrets in EVERY free-text channel of a
 * report before it is persisted or downloaded. A build's stdout/stderr, model prompt/response
 * previews, error messages/stacks, generated-file bodies and the prompt/summary/root-cause can
 * inline an API key, a `TOKEN=…` env line, a JWT or a DB URL with a password — which would otherwise
 * be written to Firestore and handed out verbatim in the downloadable "Build report". This is the
 * single choke point: `trimReportForStorage` and `compactReportForRecord` both run it, and the
 * download reads only from the (redacted) persisted copy, so no un-redacted report can escape.
 * High-precision (redactSecrets masks only well-known secret shapes + secret-NAMED assignments), so
 * ordinary code is untouched. Pure; never throws (redactSecrets returns its input on any error).
 */
export function redactReportSecrets(report: BuildDiagnosticsReport): BuildDiagnosticsReport {
  const rs = (s: string | undefined): string | undefined => (s == null ? s : redactSecrets(s));
  return {
    ...report,
    prompt: rs(report.prompt),
    summary: rs(report.summary),
    rootCause: rs(report.rootCause),
    review: rs(report.review),
    issues: report.issues?.map((i) => ({ ...i, message: redactSecrets(i.message), detail: rs(i.detail) })),
    problems: report.problems?.map((i) => ({ ...i, message: redactSecrets(i.message), detail: rs(i.detail) })),
    commands: report.commands?.map((c) => ({ ...c, command: redactSecrets(c.command), stdout: redactSecrets(c.stdout), stderr: redactSecrets(c.stderr) })),
    llmCalls: report.llmCalls?.map((c) => ({ ...c, promptPreview: rs(c.promptPreview), responsePreview: rs(c.responsePreview) })),
    errors: report.errors?.map((e) => ({ ...e, message: redactSecrets(e.message), stack: rs(e.stack) })),
    generatedFiles: report.generatedFiles?.map((f) => ({ ...f, content: redactSecrets(f.content) })),
    previewErrors: report.previewErrors?.map((p) => ({ ...p, message: redactSecrets(p.message) })),
  };
}

/**
 * Bound a report so its JSON fits comfortably under the 1 MB Firestore doc limit. Deterministic
 * caps (no size-measuring loop): trims the heavy channels (issues / commands / llm previews /
 * errors) to safe sizes while keeping the most recent, most useful detail. Pure + exported + tested.
 * SECURITY 2.1: secrets are redacted first, so every persisted/downloaded copy is clean.
 */
/**
 * How many per-call LLM records the STORED report keeps (the newest ones). Exported because the admin
 * cost card recomputes an old build's cost from this list, and a list that has hit the cap is a
 * lower bound, not a measurement — the reader must know the cap to say so.
 */
export const STORED_LLM_CALLS_MAX = 40;

export function trimReportForStorage(reportIn: BuildDiagnosticsReport): BuildDiagnosticsReport {
  const report = redactReportSecrets(reportIn);
  const prior = report.truncation;
  // 🔒 EVERY CAP BELOW GOES THROUGH `trimChannel`, WHICH RETURNS THE LOSS WITH THE LIST. That is the
  // whole point: before 2026-09-20 these were four `slice`/`lastN` calls that returned only the
  // shorter list, so a report stored with 40 of 312 model calls said "40" and nothing else. Trimming
  // and declaring are now ONE operation and cannot be done separately. See reportTruncation.ts.
  const issues = trimChannel(report.issues, 500, prior?.channels?.issues);
  const commands = trimChannel(report.commands, 40, prior?.channels?.commands);
  const llmCalls = trimChannel(report.llmCalls, STORED_LLM_CALLS_MAX, prior?.channels?.llmCalls);
  const errors = trimChannel(report.errors, 50, prior?.channels?.errors);
  const trimmedIssues = issues.list ?? [];
  return {
    ...report,
    issues: trimmedIssues,
    // RECOMPUTE from the TRIMMED issues (not a pass-through of report.problems) so `problems` can
    // never reference an entry that just fell out of the stored `issues` timeline, and can never
    // itself bypass this function's byte-budget trimming with an unbounded list of its own.
    problems: capProblems(trimmedIssues.filter((i) => i.severity !== 'info')),
    commands: commands.list?.map((c) => ({ ...c, stdout: cap(c.stdout, 1500) ?? '', stderr: cap(c.stderr, 1500) ?? '' })),
    llmCalls: llmCalls.list?.map((c) => ({ ...c, promptPreview: cap(c.promptPreview, 800), responsePreview: cap(c.responsePreview, 800) })),
    errors: errors.list?.map((e) => ({ ...e, message: cap(e.message, 2000) ?? '', stack: cap(e.stack, 1500) })),
    // generatedFiles already capped at 20 × 6000 chars by BuildDiagnostics — kept as-is (the bug evidence).
    generatedFiles: report.generatedFiles,
    truncation: mergeTruncation(prior, {
      issues: issues.fact, commands: commands.fact, llmCalls: llmCalls.fact, errors: errors.fact,
    }),
  };
}

/**
 * THE LAST-RESORT DROP — one function, because there were four identical copies of it.
 *
 * 🔴 WHY IT IS A FUNCTION AND NOT FOUR SPREADS (rule 2 — fix the class, not the instance). Each of
 * `saveDiagnostics`, `saveDiagnosticsHistory` and their two per-user siblings carried its own
 * `{ ...stored, commands: undefined, llmCalls: undefined, issues: slice(-200) }`. A fix written at
 * one of them would have been forgotten at the fourth — the drifted-copy class this repo has already
 * paid for with `safeRelPath` (four copies) and the zombie-write lane (fixed in one of two). Here it
 * would have been worse than a drift: three of four paths would keep lying about the same build.
 *
 * 🔒 It declares what it destroys. `commands: undefined` is otherwise indistinguishable from a build
 * that ran no commands, and `dropChannel` carries the count forward so the record reads "0 of 312".
 */
export function dropHeavyChannelsForStorage(stored: BuildDiagnosticsReport): BuildDiagnosticsReport {
  const prior = stored.truncation;
  const issues = trimChannel(stored.issues, 200, prior?.channels?.issues);
  const commands = dropChannel(stored.commands, prior?.channels?.commands);
  const llmCalls = dropChannel(stored.llmCalls, prior?.channels?.llmCalls);
  const trimmedIssues = issues.list ?? [];
  return {
    ...stored,
    commands: commands.list,
    llmCalls: llmCalls.list,
    issues: trimmedIssues,
    problems: capProblems(trimmedIssues.filter((i) => i.severity !== 'info')),
    truncation: mergeTruncation(prior, {
      issues: issues.fact, commands: commands.fact, llmCalls: llmCalls.fact,
    }),
  };
}

/** How many issue-timeline lines to keep in the report EMBEDDED in the durable conversation record.
 *  Tighter than storage: the embedded copy rides inside the conversation doc (saved in the SAME place
 *  as the chat), so it must stay small — the heavy forensic channels remain in the separate
 *  workspace_diagnostics_v3 doc for the deep "AI Diagnosis Bundle" download. */
const EMBED_MAX_ISSUES = 120;

/**
 * A COMPACT build report for embedding INSIDE the durable conversation record, so the "Build report"
 * is saved in the same place as the chat and ALWAYS returns on reopen — never a separate best-effort
 * doc that can 404 after a long / killed build (admin report, 2026-07-05: "build report save nahi
 * huyi … hamesa ke liye wahin save honi chahiye").
 *
 * Keeps the user-facing essentials — readiness/root-cause/summary/counts/problems + a bounded issues
 * tail + a few preview errors + the reviewer's findings — and DROPS the heavy forensic channels
 * (sandbox command logs, LLM I/O, full error stacks, generated-file bodies), which stay in the
 * workspace-keyed forensic report. Pure + exported + unit-tested.
 */
export function compactReportForRecord(reportIn: BuildDiagnosticsReport): BuildDiagnosticsReport {
  const report = redactReportSecrets(reportIn); // SECURITY 2.1 — the embedded copy is redacted too
  const prior = report.truncation;
  const trimmed = trimChannel(report.issues, EMBED_MAX_ISSUES, prior?.channels?.issues);
  const issues = (trimmed.list ?? []).map((i) => ({ ...i, message: cap(i.message, 400) ?? '' }));
  // 🔒 THE DELIBERATE DROPS ARE DECLARED TOO, and that is not pedantry. This copy omits the forensic
  // channels ON PURPOSE (they live in workspace_diagnostics_v3), but a reader holding only this copy
  // cannot tell "omitted by design" from "the build made none" — the same ambiguity the storage caps
  // created. `fullerCopy` says where the whole record is, so the answer is findable rather than
  // guessable.
  const dropped = {
    issues: trimmed.fact,
    commands: dropChannel(report.commands, prior?.channels?.commands).fact,
    llmCalls: dropChannel(report.llmCalls, prior?.channels?.llmCalls).fact,
    errors: dropChannel(report.errors, prior?.channels?.errors).fact,
    generatedFiles: dropChannel(report.generatedFiles, prior?.channels?.generatedFiles).fact,
  };
  const truncation = mergeTruncation(
    { ...(prior ?? { complete: true }), fullerCopy: 'the full build report saved for this workspace' },
    dropped,
  );
  return {
    truncation,
    schema: report.schema,
    // P0 — the identity fields MUST ride with the embedded copy too, else the export can't verify a
    // report loaded from the conversation record belongs to the active build.
    buildId: report.buildId,
    promptHash: report.promptHash,
    sessionId: report.sessionId,
    workspaceId: report.workspaceId,
    framework: report.framework,
    model: report.model,
    prompt: cap(report.prompt, 2000),
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    ok: report.ok,
    summary: cap(report.summary, 4000),
    rootCause: cap(report.rootCause, 2000),
    counts: report.counts,
    issues,
    // RECOMPUTE from the trimmed issues so `problems` can never reference an entry that fell out.
    problems: capProblems(issues.filter((i) => i.severity !== 'info')),
    previewErrors: lastN(report.previewErrors, 10),
    providerDelivery: report.providerDelivery,
    review: cap(report.review, 4000),
    // Heavy forensic channels deliberately omitted — they stay in workspace_diagnostics_v3 (retrievable
    // by workspaceId) for the deep bundle; the record only needs the always-available essential report.
    commands: undefined,
    llmCalls: undefined,
    errors: undefined,
    generatedFiles: undefined,
  };
}

/** Persist a workspace's final diagnostics report. Never blocks a build; never loses silently. */
/**
 * GA-1 — delete a workspace's diagnostics: the latest-report doc AND its `history` subcollection, so a
 * deleted project leaves no orphaned diagnostics docs. (The per-USER `user_diagnostics_v3` "latest" doc
 * is intentionally NOT touched — it is a single per-user pointer, not per-workspace data.) Best-effort;
 * never throws; no-op under VITEST.
 */
export async function deleteDiagnostics(workspaceId: string): Promise<void> {
  if (!workspaceId || process.env.VITEST) return;
  try {
    const db = getDb();
    if (!db) return;
    const root = db.collection(COLLECTION).doc(workspaceId);
    const hist = root.collection('history');
    for (let guard = 0; guard < 10000; guard++) {
      const snap = await hist.limit(300).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < 300) break;
    }
    await root.delete();
  } catch { /* best-effort — a store hiccup must never break the caller */ }
}

export async function saveDiagnostics(workspaceId: string, report: BuildDiagnosticsReport): Promise<void> {
  if (!workspaceId || !report) return;
  if (process.env.VITEST) return; // unit-test contract: no Firestore, no stash (see DiagnosticsStore.test.ts)
  try {
    let stored = trimReportForStorage(report);
    // Final safety net: if it is still somehow over the limit, drop the heaviest channels entirely
    // rather than fail the write (an empty-channel report still beats no report at all).
    if (Buffer.byteLength(JSON.stringify(stored), 'utf8') > MAX_DOC_BYTES) {
      stored = dropHeavyChannelsForStorage(stored);
    }
    const db = getDb();
    if (!db) { reportSaveFailure('workspace', workspaceId, stored, new Error('Firestore unavailable (init failed)')); return; }
    const result = await persistWithRetry(async () => {
      await db.collection(COLLECTION).doc(workspaceId).set({ report: stored, savedAt: Date.now() }, { merge: false });
    });
    if (!result.ok) reportSaveFailure('workspace', workspaceId, stored, result.error);
  } catch (err) {
    // Unexpected (e.g. a pathological report shape): still never silent, never build-breaking.
    reportSaveFailure('workspace', workspaceId, report, err);
  }
}

/** Load a workspace's last persisted diagnostics report, or null when absent. Never throws.
 *  Falls back to the in-memory emergency cache when the durable read comes back empty — the
 *  other half of the never-lose-the-report guarantee. */
export async function loadDiagnostics(workspaceId: string): Promise<BuildDiagnosticsReport | null> {
  if (!workspaceId) return null;
  const db = getDb();
  if (db) {
    try {
      const doc = await db.collection(COLLECTION).doc(workspaceId).get();
      if (doc.exists) {
        const data = doc.data();
        const report = (data?.report as BuildDiagnosticsReport) ?? null;
        if (report) return report;
      }
    } catch { /* fall through to the emergency cache */ }
  }
  return emergencyRecall('workspace', workspaceId);
}

// ── Durable per-USER "latest report" (P-REPORT.5 — "the report vanishes on every message/reload") ──
//
// saveDiagnostics()/loadDiagnostics() key ONLY by workspaceId. The only per-USER fallback in the route
// was the IN-MEMORY `lastDiagnostics` map — which is wiped on every Cloud Run cold start (min-instances
// =0) AND is per-instance. Combined with "a fresh session mints a new workspaceId", the client would
// fetch a workspaceId that has no saved report and fall through to that empty in-memory map → the
// "No build report yet" the user saw right after a real build. This durable per-user doc is the fix:
// the user's LAST settled build report is always retrievable by userId alone, across cold starts,
// instance rotation, reloads and new sessions — until the next build overwrites it. Best-effort.
const USER_COLLECTION = 'user_diagnostics_v3';

/**
 * The per-user durable-report doc id, or null when there is NO real user identity.
 *
 * PRIVACY: this must NEVER collapse anonymous callers into a single shared `'anon'` doc. It used to
 * (`userId || 'anon'`), so every anonymous build overwrote one global doc and any other anonymous
 * caller reading the per-user fallback got the LAST anon build's full report — its generated SOURCE,
 * errors and command output. Anonymous sessions are still served their own report via the
 * unguessable workspace-keyed path (`agentv3-anon-{sessionId}`); the per-user durable fallback simply
 * does not apply to them. Pure + unit-testable.
 */
export function perUserDiagnosticsDocId(userId: string | null | undefined): string | null {
  const id = (userId ?? '').trim();
  return id ? id : null;
}

/** Persist the user's LATEST settled build report, retrievable by userId alone.
 *  Never blocks a build; never loses silently (retry + loud failure + emergency stash). */
export async function saveLatestForUser(userId: string | null, report: BuildDiagnosticsReport): Promise<void> {
  const uid = perUserDiagnosticsDocId(userId);
  if (!report || !uid) return; // no real user → no shared 'anon' bucket (privacy)
  if (process.env.VITEST) return; // unit-test contract: no Firestore, no stash (see DiagnosticsStore.test.ts)
  try {
    let stored = trimReportForStorage(report);
    if (Buffer.byteLength(JSON.stringify(stored), 'utf8') > MAX_DOC_BYTES) {
      stored = dropHeavyChannelsForStorage(stored);
    }
    const db = getDb();
    if (!db) { reportSaveFailure('user', uid, stored, new Error('Firestore unavailable (init failed)')); return; }
    const result = await persistWithRetry(async () => {
      await db.collection(USER_COLLECTION).doc(uid).set({ report: stored, savedAt: Date.now() }, { merge: false });
    });
    if (!result.ok) reportSaveFailure('user', uid, stored, result.error);
  } catch (err) {
    reportSaveFailure('user', uid, report, err);
  }
}

/** Load the user's LATEST settled build report (durable, cold-start-proof), or null. Never throws.
 *  Falls back to the in-memory emergency cache when the durable read comes back empty. */
export async function loadLatestForUser(userId: string | null): Promise<BuildDiagnosticsReport | null> {
  const uid = perUserDiagnosticsDocId(userId);
  if (!uid) return null; // no real user → never read the shared 'anon' bucket (would leak another anon's report)
  const db = getDb();
  if (db) {
    try {
      const doc = await db.collection(USER_COLLECTION).doc(uid).get();
      if (doc.exists) {
        const report = (doc.data()?.report as BuildDiagnosticsReport) ?? null;
        if (report) return report;
      }
    } catch { /* fall through to the emergency cache */ }
  }
  return emergencyRecall('user', uid);
}

// ── History (P-REPORT.4 — "the report disappears the moment the next build starts") ────────────
//
// saveDiagnostics()/loadDiagnostics() above keep only ONE doc per workspace: the LATEST settled
// build's report. As soon as the next message's build also settles — even a tiny one that produced
// almost nothing — it fully overwrites that doc, and the previous (possibly much richer) report is
// gone with no way back. This subcollection keeps a bounded history of every SETTLED build's report
// so a small/quick build never destroys access to a prior, more useful one.

const HISTORY_SUBCOLLECTION = 'history';
/** How many past builds' reports to keep visible in the history list. */
const MAX_HISTORY_ITEMS = 20;

/** Lightweight metadata for one history entry — no full payload, so listing stays cheap. */
export interface DiagnosticsHistoryEntry {
  id: string;
  startedAt: number;
  endedAt?: number;
  ok?: boolean;
  summary?: string;
  rootCause?: string;
  counts: BuildDiagnosticsReport['counts'];
  /** The build's own id (the history doc is keyed by `startedAt`, which is not the same thing). */
  buildId?: string;
  /**
   * How many data-loss events that build recorded.
   *
   * Carried so a SESSION summary can be built from the history we already read. The File Guardian
   * records every workspace wipe it repairs, but each report shows ONE TURN — so the admin watched a
   * workspace empty three times across a session and all three reports were silent about it, each
   * being a different turn. The number exists; only its scope was wrong.
   */
  dataLossCount?: number;
  /**
   * The user's OWN build request. Carried so the report picker can label each past build with what
   * the user asked for — the only field on this entry a non-admin is ever shown, because it is the
   * one field the user wrote themselves (`summary`/`rootCause` are our analysis, and admin-only).
   * Truncated here: a full build prompt can be thousands of characters and this list must stay cheap.
   */
  prompt?: string;
}

/** Enough to tell two edits apart in a list; far short of shipping the whole prompt in a listing. */
const HISTORY_PROMPT_MAX = 200;

/**
 * Persist a SETTLED build's report into the workspace's bounded history. No-op for a report that
 * hasn't actually finished yet (`endedAt` unset) — only a build that genuinely ended gets a history
 * entry, so an in-progress build never pollutes the list. Best-effort — never throws.
 */
export async function saveDiagnosticsHistory(workspaceId: string, report: BuildDiagnosticsReport): Promise<void> {
  if (!workspaceId || !report || report.endedAt === undefined) return;
  if (process.env.VITEST) return; // unit-test contract: no Firestore (see DiagnosticsStore.test.ts)
  try {
    let stored = trimReportForStorage(report);
    // Same final safety net as saveDiagnostics — a history entry that fails to write because it's
    // over budget is worse than a lighter one that succeeds.
    if (Buffer.byteLength(JSON.stringify(stored), 'utf8') > MAX_DOC_BYTES) {
      stored = dropHeavyChannelsForStorage(stored);
    }
    const db = getDb();
    // History gets retry + LOUD failure but no emergency stash: the same report is already held by
    // the workspace + per-user latest paths (both stash), so the user-facing report survives; only
    // this archive entry is at risk, and losing it silently is still forbidden — hence the log/audit.
    if (!db) {
      console.error(`[DIAGNOSTICS] HISTORY SAVE FAILED (workspace=${workspaceId}) — Firestore unavailable (init failed).`);
      try { audit('DIAGNOSTICS_SAVE_FAILED', { kind: 'history', key: workspaceId, error: 'Firestore unavailable (init failed)' }); } catch { /* never throws */ }
      return;
    }
    const result = await persistWithRetry(async () => {
      await db
        .collection(COLLECTION)
        .doc(workspaceId)
        .collection(HISTORY_SUBCOLLECTION)
        .doc(String(report.startedAt))
        .set({ report: stored, savedAt: Date.now() }, { merge: false });
    });
    if (!result.ok) {
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      console.error(`[DIAGNOSTICS] HISTORY SAVE FAILED (workspace=${workspaceId}) after retries: ${message}`);
      try { audit('DIAGNOSTICS_SAVE_FAILED', { kind: 'history', key: workspaceId, error: truncateForAudit(message) }); } catch { /* never throws */ }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DIAGNOSTICS] HISTORY SAVE FAILED (workspace=${workspaceId}) unexpectedly: ${message}`);
    try { audit('DIAGNOSTICS_SAVE_FAILED', { kind: 'history', key: workspaceId, error: truncateForAudit(message) }); } catch { /* never throws */ }
  }
}

/**
 * Upsert an IN-PROGRESS build's report into the workspace history, keyed by `startedAt` (the same key
 * `saveDiagnosticsHistory` uses), so a settle later OVERWRITES this same entry with the final version.
 *
 * ROOT CAUSE this closes (CrewHub 2026-07-20, admin: "puri build report save nahi ho rahi"): a multi-turn
 * build whose turns get INTERRUPTED — "Load failed", a sandbox recycle, a disconnect, a credit cut —
 * never reaches the settle path, and `saveDiagnosticsHistory` refuses any report with `endedAt` unset. So
 * every un-settled turn was missing from the history, and the whole-session download (`scope=session`,
 * which stitches the history) came back with only a fragment — often a single mid-build snapshot. This
 * captures each turn into history AS IT RUNS (throttled by the caller), so the full "0 → done" record
 * survives regardless of how any single turn ended. Best-effort — never throws, never blocks the build.
 */
export async function upsertDiagnosticsHistoryProgress(workspaceId: string, report: BuildDiagnosticsReport): Promise<void> {
  if (!workspaceId || !report || typeof report.startedAt !== 'number') return;
  if (process.env.VITEST) return; // unit-test contract: no Firestore (see DiagnosticsStore.test.ts)
  try {
    let stored = trimReportForStorage(report);
    if (Buffer.byteLength(JSON.stringify(stored), 'utf8') > MAX_DOC_BYTES) {
      stored = dropHeavyChannelsForStorage(stored);
    }
    const db = getDb();
    if (!db) return; // the latest-doc + per-user paths still hold this report; the archive entry is optional here
    await persistWithRetry(async () => {
      await db
        .collection(COLLECTION)
        .doc(workspaceId)
        .collection(HISTORY_SUBCOLLECTION)
        .doc(String(report.startedAt))
        .set({ report: stored, savedAt: Date.now(), inProgress: report.endedAt === undefined }, { merge: false });
    });
  } catch { /* best-effort — the settle-time saveDiagnosticsHistory still backstops a clean finish */ }
}

/**
 * The same listing, but it says whether the READ ITSELF worked.
 *
 * 🔒 THE DEFECT THIS EXISTS FOR (admin 2026-08-27, verbatim: "user ne 1,2,3…10 edit kiye aur 10th par
 * report kiya to shuru ke 9 gayab, only 10th report hi aati hai").
 *
 * `listDiagnosticsHistory` returned `[]` for BOTH "this workspace has no earlier builds" and "the read
 * failed" — a missing index, a permission error, an unavailable Firestore. The whole-session stitch
 * then found nothing, fell back to the single `latest` doc, and reported `count: 1, omittedBuilds: 0`.
 * That last part is the real damage: the report does not merely lose the other builds, it ASSERTS to
 * the admin that there was only ever one, and that omitted nothing. A silent failure that produces a
 * confident wrong number is worse than an error, because nobody goes looking.
 *
 * `ok: false` means we could not look. `ok: true` with an empty list means there is genuinely nothing —
 * and only then may a caller say "one build" and be believed. Same class as every other artifact-for-
 * evidence bug this codebase has been removing: an empty result standing in for a checked absence.
 *
 * Never throws.
 */
export async function listDiagnosticsHistoryResult(
  workspaceId: string,
  limit = MAX_HISTORY_ITEMS,
): Promise<{ entries: DiagnosticsHistoryEntry[]; ok: boolean }> {
  const db = getDb();
  // No workspace id is a caller error, not a read failure — there is nothing to look up, honestly.
  if (!workspaceId) return { entries: [], ok: true };
  if (!db) {
    console.error(`[DIAGNOSTICS] HISTORY READ FAILED (workspace=${workspaceId}) — Firestore unavailable (init failed).`);
    return { entries: [], ok: false };
  }
  try {
    return { entries: await listDiagnosticsHistoryInner(db, workspaceId, limit), ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DIAGNOSTICS] HISTORY READ FAILED (workspace=${workspaceId}): ${message}`);
    try { audit('DIAGNOSTICS_READ_FAILED', { kind: 'history', key: workspaceId, error: truncateForAudit(message) }); } catch { /* never throws */ }
    return { entries: [], ok: false };
  }
}

/**
 * List a workspace's past builds, most-recent-first, metadata only (cheap for a picker/list UI).
 * Ordered by document id (the stringified `startedAt` epoch-ms — lexicographic order matches numeric
 * order for same-length epoch-ms strings) so no composite index on a nested field is ever needed.
 * Never throws — returns [] on any failure or when nothing has been recorded yet.
 *
 * ⚠️ THIS SHAPE CANNOT TELL YOU WHICH OF THOSE TWO HAPPENED. For anything that reports a COUNT to a
 * human, use `listDiagnosticsHistoryResult` instead — see the note there. Kept for the picker UIs,
 * where an empty list and a failed read both correctly render as "no past builds to choose from".
 */
export async function listDiagnosticsHistory(workspaceId: string, limit = MAX_HISTORY_ITEMS): Promise<DiagnosticsHistoryEntry[]> {
  return (await listDiagnosticsHistoryResult(workspaceId, limit)).entries;
}

async function listDiagnosticsHistoryInner(
  db: NonNullable<ReturnType<typeof getDb>>,
  workspaceId: string,
  limit: number,
): Promise<DiagnosticsHistoryEntry[]> {
  {
    const snap = await db
      .collection(COLLECTION)
      .doc(workspaceId)
      .collection(HISTORY_SUBCOLLECTION)
      .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
      .limit(Math.max(0, limit))
      .get();
    return snap.docs.map((d) => {
      const r = d.data().report as BuildDiagnosticsReport;
      return {
        id: d.id, buildId: r.buildId, startedAt: r.startedAt, endedAt: r.endedAt, ok: r.ok,
        summary: r.summary, rootCause: r.rootCause, counts: r.counts,
        // Carried so a SESSION summary can be built from the history we already read (admin 2026-08-06):
        // the guardian records every workspace wipe, but each report shows one TURN, so three wipes
        // across a session were invisible in all three of them.
        dataLossCount: Array.isArray(r.dataLossEvents) ? r.dataLossEvents.length : 0,
        prompt: typeof r.prompt === 'string' ? r.prompt.slice(0, HISTORY_PROMPT_MAX) : undefined,
      };
    });
  }
}

/**
 * The owner uid encoded in a v5 workspace id (`agentv3-<uid>-<session>`). Pure. Null for the anon
 * prefix or an unrecognized shape — the caller shows the raw workspaceId instead of guessing.
 */
export function workspaceOwnerUid(workspaceId: string | null | undefined): string | null {
  const m = /^agentv3-([A-Za-z0-9_-]{1,64})-/.exec(workspaceId ?? '');
  if (!m || m[1] === 'anon') return null;
  return m[1];
}

/** One row of the ADMIN all-builds browser: a workspace's latest report, metadata only. */
export interface AllDiagnosticsEntry extends DiagnosticsHistoryEntry {
  workspaceId: string;
  savedAt: number;
  ownerUid: string | null;
  /**
   * The money and tier facts, lifted out of the report the query ALREADY read (admin 2026-09-14:
   * the All-builds list must carry the same information the user-submitted inbox does — sender,
   * email, time, user type, charge, status — so one is not poorer than the other).
   *
   * 🔑 These cost NOTHING. `listAllDiagnostics` reads the whole document to project `ok`/`summary`
   * anyway, so the billing block is already in memory; the alternative — opening each full report
   * from the panel — would be one round trip per row on a list of up to 500.
   *
   * All optional: a legacy row, an unsettled build, or a report written before billing was recorded
   * carries none of them, and the panel must show "not recorded" rather than a zero. A ₹0 charge and
   * an unknown charge are different facts, and `zeroBillReason` is what distinguishes them.
   */
  userTier?: string | null;
  billedInr?: number | null;
  billedUsd?: number | null;
  zeroBillReason?: string | null;
  /**
   * THE MODEL-PERFORMANCE PROJECTION (2026-09-16) — what this build's models actually did.
   *
   * 🔑 IT COSTS NO EXTRA I/O, WHICH IS WHY IT BELONGS HERE. The query already reads each whole
   * document to project `ok`/`summary`, so `llmCalls` and the failure ledger are ALREADY in memory;
   * summarising them is a walk over at most `MAX_LLM_CALLS` (300) records per row. The alternative —
   * opening each full report from an analysis script — is one network round trip per build on a list
   * of up to 500, which is the reason this comparison had never been made.
   *
   * ⚠️ COMPACT BY DESIGN: one row per (provider, model), never the individual calls. A build with 300
   * calls contributes two or three rows, so the response grows with the number of MODELS used, not
   * with the amount of work done.
   *
   * Absent only if summarising threw; a legacy report yields a summary with empty arrays rather than
   * nothing, so "no models recorded" and "this field was never computed" stay distinguishable.
   */
  modelPerformance?: ModelPerformanceSummary | null;
  /**
   * THE BUILD'S OWN `OUTCOME_*` CODE — the machine fact it recorded about how it ended.
   *
   * 🔴 WHY IT IS PROJECTED (admin 2026-09-17, the 40.8% failure panel). Every failure reason on that
   * panel read "Other (not yet in the known pattern list)" — 92 of 107 in its biggest row. The panel
   * classified failures by READING THE PROSE of `rootCause` and looking for compiler words, and v5
   * does not fail with compiler words: it fails with sentences we wrote ourselves ("After one creation
   * pass, 3 local module(s) are STILL missing"). Six real outcome messages were run through that
   * classifier and ALL SIX came back `other`.
   *
   * `BuildRetrospectiveEngine.ts` had already root-caused this class on 2026-09-12, in writing:
   * *"The diagnostic CODE is a machine fact recorded by the build itself. Reading it is not pattern
   * matching, it is just looking."* The code was sitting in `r.issues` the whole time — this query
   * reads the WHOLE document already — and was being dropped on the floor.
   *
   * 🔑 IT COSTS NO EXTRA I/O, the same argument `modelPerformance` above makes: the report is already
   * in memory, and this is one reverse scan of its issue list.
   */
  outcomeCode?: string | null;
  /**
   * The severity that outcome was recorded at — REQUIRED, not decoration.
   *
   * ⚠️ One code can mean opposite things: `OUTCOME_STOPPED` at `warning` is the 2-minute advisory cap
   * on an app that WAS built, and at `error` it is a build that never converged (see
   * `advisoryCapOutcome.ts`). Classifying on the code alone would file every perfectly good build of
   * the first kind as "incomplete" — trading one wrong answer for another.
   */
  outcomeSeverity?: string | null;
  /**
   * True when the app was opened in a real browser and seen rendering, or a preview URL was really
   * served. A build marked FAILED that carries this is a candidate WRONG VERDICT, not a failure —
   * see `appWasSeenRunning`.
   */
  appSeenRunning?: boolean | null;
  /**
   * Did the USER stop this build? Read off the timeline with the same `stoppedByUser` the release
   * gate and `deriveRootCause` use, so the failure panel can move a person's own Stop out of the
   * failure tally without inventing a rule — and so a LEGACY record (written before the abort
   * funnel recorded `OUTCOME_USER_STOPPED`, but carrying `USER_STOPPED_BUILD` or
   * `CANCELLED_BUILD_CHARGED`) is recognised too. `null` when the report has no timeline to read.
   */
  userStopped?: boolean | null;
}

/**
 * ADMIN-ONLY (2026-08-06, admin: "koi bhi user kuch bhi app banaye — admin puri 0→100% build report
 * download kar sake, user ke send kiye bina"): list EVERY workspace's latest build report across ALL
 * users, most recently active first. Every build already lands here durably (the latest doc is
 * written per message and the per-build history rides a subcollection) — this is just the missing
 * global index over it. Ordered by the top-level `savedAt` (auto single-field index at collection
 * scope — no composite, no collection-group index, so it can never FAILED_PRECONDITION). Metadata
 * only; the full payloads stay behind the per-workspace loaders. Never throws.
 */
export async function listAllDiagnostics(limit = 100, sinceMs?: number | null): Promise<AllDiagnosticsEntry[]> {
  const db = getDb();
  if (!db) return [];
  try {
    // A date bound belongs in the QUERY, not in a later .filter(). Applied afterwards, a "last 30
    // days" view would really mean "the newest 500 rows, of which some are within 30 days" — and it
    // would say nothing about the older ones it never looked at. `savedAt` is already the sort key,
    // so this range stays on the same single-field index and can never FAILED_PRECONDITION.
    let q = db.collection(COLLECTION).orderBy('savedAt', 'desc') as FirebaseFirestore.Query;
    if (typeof sinceMs === 'number' && sinceMs > 0) q = q.where('savedAt', '>=', sinceMs);
    const snap = await q.limit(Math.max(1, Math.min(500, limit))).get();
    return snap.docs.map((d) => {
      const r = (d.data()?.report ?? {}) as BuildDiagnosticsReport;
      return {
        workspaceId: d.id,
        savedAt: (d.data()?.savedAt as number) ?? 0,
        ownerUid: workspaceOwnerUid(d.id),
        id: String(r.startedAt ?? ''),
        buildId: r.buildId,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        ok: r.ok,
        summary: r.summary,
        rootCause: r.rootCause,
        // The machine fact behind the prose — see the field's own note. Free: `r` is already read.
        outcomeCode: outcomeCodeOf(r.issues) || null,
        outcomeSeverity: severityOfOutcome(r.issues),
        // Was this app ever SEEN running? The only way to tell a real failure from a wrong verdict.
        appSeenRunning: appWasSeenRunning(r.issues),
        userStopped: Array.isArray(r.issues) ? stoppedByUser(r.issues) : null,
        counts: r.counts,
        prompt: typeof r.prompt === 'string' ? r.prompt.slice(0, HISTORY_PROMPT_MAX) : undefined,
        // Read defensively: `billing` is absent on a legacy or unsettled report, and a number that is
        // not a number must stay NULL rather than become 0 — "we did not record a charge" and "we
        // charged nothing" are different things to tell an admin looking at a failed build.
        ...(() => {
          const bill = (r as { billing?: Record<string, unknown> }).billing;
          const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
          const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
          return {
            userTier: str(bill?.userTier),
            billedInr: num(bill?.billedInr),
            billedUsd: num(bill?.billedUsd),
            zeroBillReason: str(bill?.zeroBillReason),
          };
        })(),
        // Read-only aggregation over data this query already has in memory. Wrapped because an
        // admin listing must never fail over an observability field: a summary that throws yields
        // `null` ("not computed") and the row still carries everything it carried before.
        modelPerformance: (() => {
          try { return summarizeModelPerformance(r); } catch { return null; }
        })(),
      };
    });
  } catch {
    return [];
  }
}

/** The facts a measurement needs about a past build: what was ASKED, what was WRITTEN, and when. */
export interface BuildFacts {
  workspaceId: string;
  prompt?: string;
  paths: string[];
  /** Epoch ms the build's own work started / finished. Absent on an unsettled or legacy report. */
  startedAt?: number;
  endedAt?: number;
}

/**
 * The fields the measurements need, and nothing else: what the user ASKED for, what the build actually
 * WROTE, and the window it ran in.
 *
 * ADMIN 2026-08-12. Before changing how the builder chooses an architecture, we need to know whether
 * the change is worth making: how many past apps were given a Node server they never needed? That is
 * one number, and it decides whether a large plan proceeds — so it is measured from real builds rather
 * than estimated. See serverNecessity.ts.
 *
 * ONE reader, not one per question (renamed from `listPromptsAndPaths` when Phase 0 of the in-browser
 * preview plan needed the build WINDOW too). A second near-identical projection over the same documents
 * is how two measurements quietly start disagreeing about the same builds — so the window was added
 * here rather than in a third function beside it. See sandboxHandover.ts.
 *
 * Reads the SAME documents `listAllDiagnostics` already reads; the manifest's file hashes carry the
 * paths, so no extra query and no file contents are needed. Never throws — [] on any failure.
 */
export async function listBuildFacts(limit = 200): Promise<BuildFacts[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db
      .collection(COLLECTION)
      .orderBy('savedAt', 'desc')
      .limit(Math.max(1, Math.min(500, limit)))
      .get();
    return snap.docs.map((d) => {
      const r = (d.data()?.report ?? {}) as BuildDiagnosticsReport;
      return {
        workspaceId: d.id,
        prompt: typeof r.prompt === 'string' ? r.prompt : undefined,
        paths: Object.keys((r.manifest as { fileHashes?: Record<string, string> } | undefined)?.fileHashes ?? {}),
        startedAt: typeof r.startedAt === 'number' ? r.startedAt : undefined,
        endedAt: typeof r.endedAt === 'number' ? r.endedAt : undefined,
      };
    });
  } catch {
    return [];
  }
}

/** One workspace's latest FULL stored report, for a reader that needs more than the metadata projection. */
export interface StoredFullReport {
  workspaceId: string;
  savedAt: number;
  ownerUid: string | null;
  report: BuildDiagnosticsReport;
}

/**
 * ADMIN-ONLY (2026-09-14, the cost card): the newest N workspaces' FULL latest reports, most recent
 * first. `listAllDiagnostics` deliberately projects metadata only; the cost card needs the billing
 * record, the call log, the manifest's file list and the counts of each build, so it reads the same
 * documents whole. Bounded to 60 because each document can be several hundred KB and the card is a
 * "last 30 builds" view, not a browser. Never throws — [] on any failure.
 */
export async function listRecentFullReports(limit = 30): Promise<StoredFullReport[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db
      .collection(COLLECTION)
      .orderBy('savedAt', 'desc')
      .limit(Math.max(1, Math.min(60, limit)))
      .get();
    return snap.docs.flatMap((d) => {
      const report = d.data()?.report as BuildDiagnosticsReport | undefined;
      if (!report || typeof report !== 'object') return [];
      return [{
        workspaceId: d.id,
        savedAt: (d.data()?.savedAt as number) ?? 0,
        ownerUid: workspaceOwnerUid(d.id),
        report,
      }];
    });
  } catch {
    return [];
  }
}

/** Load ONE specific historical report by id (an entry's `id` from listDiagnosticsHistory). Null on any failure/absence. */
export async function getDiagnosticsHistoryItem(workspaceId: string, id: string): Promise<BuildDiagnosticsReport | null> {
  const db = getDb();
  if (!db || !workspaceId || !id) return null;
  try {
    const doc = await db.collection(COLLECTION).doc(workspaceId).collection(HISTORY_SUBCOLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return (doc.data()?.report as BuildDiagnosticsReport) ?? null;
  } catch {
    return null;
  }
}

/**
 * 🔴 THE LAST N **BUILDS**, NOT THE LAST N **WORKSPACES** (admin 2026-09-18).
 *
 * Admin, on the Build-costs card: *"yeh report fix hai, har build ke bad update nahi ho rahi. hame
 * pata hi nahi lag raha ki ham progress kar rahe ya nahi!!"*
 *
 * `listRecentFullReports` reads the PARENT documents of this collection, and there is exactly ONE per
 * WORKSPACE holding that workspace's LATEST report — `saveDiagnostics` overwrites it on every build.
 * So "last 30 builds" was really "the latest build of each of the 30 most recently active
 * workspaces", and the two differ by exactly the thing the admin was trying to see: **iterating in
 * one workspace — which is what testing the engine IS — produces one row, not twenty.** Twenty builds
 * later the card still read "30 builds read", because the document count had not moved.
 *
 * The per-build record already existed and nothing was reading it: `saveDiagnosticsHistory` writes
 * every settled build to `<workspace>/history/<startedAt>`. This reads THAT.
 *
 * 🔒 WHY SCANNING THE TOP `limit` WORKSPACES IS EXACT, not a heuristic: parents are ordered by their
 * latest save. For a workspace at position `limit + 1` to hold one of the newest `limit` builds,
 * every one of the `limit` workspaces above it would have to hold only builds OLDER than that one —
 * impossible, since each of them holds at least one build saved more recently still.
 *
 * ⚠️ It orders by `documentId()`, exactly as `listDiagnosticsHistory` does, so it needs NO Firestore
 * index — an ordered collectionGroup query would have needed a collection-group index that nothing in
 * this repo creates, and its absence is a runtime error, not a compile one.
 *
 * Never throws. If the history sweep comes back with nothing at all (a fresh deployment, or reads
 * failing), it falls back to the old per-workspace view and SAYS which one it returned — the card
 * prints that, because a window that quietly means something else is the bug being fixed.
 */
export interface RecentBuildReports {
  builds: StoredFullReport[];
  /** 'history' = one entry per BUILD. 'latest-per-workspace' = the fallback, one per workspace. */
  source: 'history' | 'latest-per-workspace';
  /** How many workspaces' histories were swept (0 on the fallback path). */
  workspacesScanned: number;
}

/** In-progress entries are overwritten at settle, so at most one per workspace can be in the way. */
const IN_PROGRESS_HEADROOM = 10;

export async function listRecentBuildReports(limit = 30): Promise<RecentBuildReports> {
  const want = Math.max(1, Math.min(60, limit));
  const db = getDb();
  if (!db) return { builds: [], source: 'history', workspacesScanned: 0 };
  try {
    // `.select()` with no fields returns document REFERENCES only — the cheapest read Firestore has.
    // Both sweeps below are projections; only the winning builds are fetched whole.
    const parents = await db.collection(COLLECTION).orderBy('savedAt', 'desc').limit(want).select().get();
    const candidates = (await Promise.all(parents.docs.map(async (p) => {
      try {
        const snap = await p.ref
          .collection(HISTORY_SUBCOLLECTION)
          .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
          .limit(want)
          .select()
          .get();
        return snap.docs.map((d) => ({ workspaceId: p.id, startedAt: Number(d.id) || 0, ref: d.ref }));
      } catch {
        return []; // one unreadable workspace must not empty the whole card
      }
    }))).flat();

    if (candidates.length === 0) {
      const fallback = await listRecentFullReports(want);
      return { builds: fallback, source: 'latest-per-workspace', workspacesScanned: parents.size };
    }

    candidates.sort((a, b) => b.startedAt - a.startedAt);
    const picked = candidates.slice(0, want + IN_PROGRESS_HEADROOM);
    const docs = await db.getAll(...picked.map((c) => c.ref));
    const builds = docs.flatMap((d, i) => {
      const report = d.data()?.report as BuildDiagnosticsReport | undefined;
      if (!report || typeof report !== 'object') return [];
      // A build still running has no settled billing record, so counting it would drag every average
      // toward "not measured". It reappears here the moment it settles, under the same document id.
      if (report.endedAt === undefined) return [];
      return [{
        workspaceId: picked[i].workspaceId,
        savedAt: (d.data()?.savedAt as number) ?? picked[i].startedAt,
        ownerUid: workspaceOwnerUid(picked[i].workspaceId),
        report,
      }];
    }).slice(0, want);

    return { builds, source: 'history', workspacesScanned: parents.size };
  } catch {
    return { builds: [], source: 'history', workspacesScanned: 0 };
  }
}
