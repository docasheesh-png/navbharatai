import { SCOPE_FAILURE_REASONS, type ScopeFailureDiagnostic } from '../AgentV3/scopeFailureDiagnostic';
import { getServerDb } from './serverDb';
import { FieldPath } from 'firebase-admin/firestore';
import { FailedReportsInputError, validReportId } from './failedBuildReports';
import type { LlmCallRecord } from '../AgentV3/BuildDiagnostics';

export const SCOPE_FAILURE_EVENT = 'AGENTV3_SCOPE_UNAVAILABLE';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Allowlisted pre-coding evidence only. Never export arbitrary audit metadata or messages. */
export function scopeFailureAudit(traceId: string, workspaceId: string, failure: Readonly<ScopeFailureDiagnostic>) {
  return { traceId, workspaceId, stage: failure.stage, reason: failure.reason,
    message: `Scope unavailable before coding; stage=${failure.stage}; reason=${failure.reason}; request=${traceId}. Supplier expense is not determined by this diagnostic.` };
}
/** Explicit projection: a full call record can contain private prompt, response and error text. */
export function scopeCallAudit(traceId: string, workspaceId: string,
  row: Pick<LlmCallRecord, 'ok' | 'model' | 'latencyMs' | 'inputTokens' | 'outputTokens'>) {
  return { traceId, workspaceId,
    message: `Scope call ${row.ok ? 'returned' : 'failed'}; request=${traceId}; latencyMs=${row.latencyMs}. Classification is recorded separately.`,
    ok: row.ok, model: row.model, latencyMs: row.latencyMs, inputTokens: row.inputTokens, outputTokens: row.outputTokens };
}
/** Keep the chat handler's control-flow budget unchanged; no report/billing side effects. */
export function recordScopeFailure(traceId: string, workspaceId: string,
  admission: { failure?: Readonly<ScopeFailureDiagnostic> } | null,
  log: (event: string, meta: Record<string, unknown>, level: 'warn') => void): void {
  if (admission?.failure) log(SCOPE_FAILURE_EVENT, scopeFailureAudit(traceId, workspaceId, admission.failure), 'warn');
}
export function projectScopeFailure(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (row.event !== SCOPE_FAILURE_EVENT || typeof row.traceId !== 'string' || !UUID.test(row.traceId)
    || !validReportId(row.workspaceId) || typeof row.ts !== 'number' || !Number.isSafeInteger(row.ts) || row.ts <= 0) return null;
  const meta = row.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta.stage !== 'string' || !Object.hasOwn(SCOPE_FAILURE_REASONS, meta.stage)) return null;
  const reasons: readonly unknown[] = SCOPE_FAILURE_REASONS[meta.stage as keyof typeof SCOPE_FAILURE_REASONS];
  if (!reasons.includes(meta.reason)) return null;
  return { requestId: row.traceId, workspaceId: row.workspaceId, observedAt: row.ts,
    stage: meta.stage, reason: meta.reason as string, codingStarted: false as const };
}
/** Existing report-only access can read only this bounded projection, never the server-log store. */
export async function readScopeFailures(args: Record<string, unknown>) {
  if (Object.keys(args).some(k => !['workspaceId', 'since', 'limit', 'cursor'].includes(k)) || !validReportId(args.workspaceId)
    || (args.cursor !== undefined && !validReportId(args.cursor))) {
    throw new FailedReportsInputError('A valid workspaceId is required; only since, limit and cursor are optional.');
  }
  const since = args.since ?? 0, limit = args.limit ?? 20;
  if (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0
    || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new FailedReportsInputError('since must be an epoch millisecond integer and limit must be between 1 and 50.');
  }
  const db = getServerDb();
  if (!db) throw new Error('Scope diagnostic storage unavailable.');
  let query = db.collection('server_logs').where('event', '==', SCOPE_FAILURE_EVENT)
    .where('workspaceId', '==', args.workspaceId).orderBy(FieldPath.documentId());
  if (args.cursor) query = query.startAfter(args.cursor);
  const snapshot = await query.limit(limit + 1).get();
  const docs = snapshot.docs.slice(0, limit);
  const rows = docs.map(doc => doc.data());
  const projected = rows.map(projectScopeFailure).filter(r => r !== null);
  const matching = projected.filter(r => r.observedAt >= since);
  return { failures: matching, observedAt: Date.now(), scanned: rows.length,
    malformed: rows.length - projected.length, nextCursor: snapshot.docs.length > limit ? docs.at(-1)!.id : null,
    ordering: 'document-id',
    scope: 'retained-pre-coding-scope-failures',
    limitation: 'Best-effort audit retention; absence does not prove success. No historical failure stages are reconstructed. Supplier expense requires receipt evidence.' };
}
