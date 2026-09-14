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
  logStore.append(persistedAuditEntry(event, meta, level));
}

/** The durable level for a severity string the mirror above would emit. */
function levelFor(severity: string): 'info' | 'warn' | 'error' {
  if (severity === 'ERROR' || severity === 'CRITICAL') return 'error';
  if (severity === 'WARNING' || severity === 'NOTICE') return 'warn';
  return 'info';
}

/** Meta keys that carry the "what happened" of an event, in the order a reader wants them. */
const MESSAGE_KEYS = ['message', 'error', 'reason', 'detail', 'path', 'kind', 'key', 'ip'] as const;

/**
 * What the admin log panel gets, derived ONCE from what stdout gets. PURE and exported.
 *
 * 🔴 ROOT CAUSE (admin Monitor capture, 2026-09-14). The Cloud Logging mirror three lines up computes
 * the real severity — `inferSeverity('DIAGNOSTICS_READ_FAILED')` is WARNING, `BLOCKED_SCAN` is WARNING
 * — and the durable store was then handed `level: 'info'`, hardcoded. So the panel the admin actually
 * reads showed INFO on every line, failures included, while the correct answer sat one statement
 * above it. And `message: meta.message` was `undefined` for every caller in the codebase — they pass
 * `error`, `path`, `kind`, `key` — so every row rendered as `EVENT — ` with nothing after the dash.
 * Nine `DIAGNOSTICS_READ_FAILED` rows, each carrying the failure text in `meta.error`, each shown as
 * an INFO line that said nothing.
 *
 * Two derivations, one source: the level is the mirror's severity mapped down, and the message is
 * the first meta field that says what happened. The full meta still travels for a reader that wants
 * all of it.
 */
export function persistedAuditEntry(
  event: string,
  meta: Record<string, any> = {},
  level?: keyof typeof SEVERITY,
): { level: 'info' | 'warn' | 'error'; event: string; traceId?: string; workspaceId?: string; message?: string; meta: Record<string, unknown> } {
  const severity = level ? SEVERITY[level] : inferSeverity(event);
  let message: string | undefined;
  for (const k of MESSAGE_KEYS) {
    const v = meta[k];
    if (typeof v === 'string' && v.trim()) { message = k === 'message' ? v : `${k}: ${v.slice(0, 300)}`; break; }
  }
  return {
    level: levelFor(severity),
    event,
    traceId: meta.traceId,
    workspaceId: meta.workspaceId || meta.sessionId,
    message,
    meta: Object.fromEntries(
      Object.entries(meta).filter(([k]) => !['traceId', 'workspaceId', 'sessionId', 'message'].includes(k))
    ),
  };
}
