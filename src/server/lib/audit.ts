/**
 * Lightweight structured audit logger. Extracted from the server.ts monolith
 * (Phase 1) so route modules can share it without closing over server scope.
 *
 * G2: also persists entries to Firestore `server_logs` collection (best-effort)
 * so the audit trail survives Cloud Run restarts and is queryable via admin API.
 */
import { logStore } from './logStore';

/** Map a log level to a Cloud Logging severity (auto-promoted from a structured line). */
const SEVERITY: Record<string, string> = { info: 'INFO', notice: 'NOTICE', warn: 'WARNING', error: 'ERROR', critical: 'CRITICAL' };

/** Heuristic severity from the event name when not given (FAIL/BLOCK/BREACH → WARNING/ERROR). */
function inferSeverity(event: string): string {
  const e = event.toUpperCase();
  if (/BREACH|LEAK|COMPROMISE|CRITICAL/.test(e)) return 'CRITICAL';
  if (/FAIL|DENIED|BLOCKED|ERROR|ABUSE|VIOLATION|UNAUTHORIZED|FORBIDDEN/.test(e)) return 'WARNING';
  return 'INFO';
}

export function audit(event: string, meta: Record<string, any> = {}, level?: keyof typeof SEVERITY): void {
  const ts = new Date().toISOString();
  const entry = { ts, event, ...meta };
  // Human-readable line (kept first — tooling/tests rely on the [AUDIT] prefix).
  console.log(`[AUDIT] ${JSON.stringify(entry)}`);
  // P-SEC.7 (SIEM): emit a PURE-JSON structured line so Cloud Run → Cloud Logging
  // ingests it as `jsonPayload` (searchable/alertable security events). `severity`
  // is a Cloud Logging special field and is auto-promoted to the entry severity.
  try {
    console.log(JSON.stringify({
      severity: level ? SEVERITY[level] : inferSeverity(event),
      component: 'nbai-audit',
      event,
      time: ts,
      ...meta,
    }));
  } catch { /* circular/oversized meta — skip the structured mirror, never throw */ }
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
