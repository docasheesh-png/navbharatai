/**
 * Lightweight structured audit logger. Extracted from the server.ts monolith
 * (Phase 1) so route modules can share it without closing over server scope.
 *
 * G2: also persists entries to Firestore `server_logs` collection (best-effort)
 * so the audit trail survives Cloud Run restarts and is queryable via admin API.
 */
import { logStore } from './logStore';

export function audit(event: string, meta: Record<string, any> = {}): void {
  const entry = { ts: new Date().toISOString(), event, ...meta };
  console.log(`[AUDIT] ${JSON.stringify(entry)}`);
  // G2: persist alongside stdout (fire-and-forget, never throws)
  logStore.append({
    level: 'info',
    event,
    traceId: meta.traceId,
    workspaceId: meta.workspaceId || meta.sessionId,
    message: meta.message,
    meta: Object.fromEntries(
      Object.entries(meta).filter(([k]) => !['traceId', 'workspaceId', 'sessionId', 'message'].includes(k))
    ),
  });
}
