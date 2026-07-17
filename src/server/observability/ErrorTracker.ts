// P2.2 — External Error Tracking (UPGRADE v5.0).
//
// Real, dependency-free error tracking. Every captured error is emitted as a Cloud
// Error Reporting-compatible structured log line (the documented `@type:
// ...ReportedErrorEvent` payload). On Cloud Run those lines are automatically ingested
// by **Cloud Error Reporting** — grouped, counted, alertable — with no SDK and no extra
// credentials. Errors are also kept in a bounded in-memory ring buffer (for the admin
// endpoint) and correlated with the active distributed trace (P2.1) so each error links
// to the request that produced it. Every capture is best-effort and never throws.
//
// Frontend errors flow in via POST /api/logs/error → captureError, so client-side and
// server-side errors land in the same place.

import { tracer } from './Tracer';

export type ErrorSource = 'server' | 'client' | 'uncaughtException' | 'unhandledRejection' | 'middleware';

export interface ErrorContext {
  source?: ErrorSource;
  /** HTTP request details, when the error happened serving a request. */
  httpMethod?: string;
  httpUrl?: string;
  httpStatus?: number;
  userId?: string;
  /** Free-form extra fields (never include secrets). */
  meta?: Record<string, unknown>;
}

export interface CapturedError {
  id: string;
  ts: number;
  source: ErrorSource;
  message: string;
  stack?: string;
  traceId?: string;
  context: ErrorContext;
}

const SERVICE = (process.env.K_SERVICE || process.env.SERVICE_NAME || 'navbharatai').trim();
const VERSION = (process.env.K_REVISION || process.env.SERVICE_VERSION || process.env.GAE_VERSION || 'unknown').trim();
const PROJECT = (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT_ID || '').trim();

class ErrorTracker {
  private readonly buffer: CapturedError[] = [];
  private readonly maxErrors = 500;
  private seq = 0;

  /**
   * Capture an error. Emits a Cloud Error Reporting log, records it in the ring buffer,
   * and links it to the active trace. Returns the captured record. Never throws.
   */
  capture(error: unknown, context: ErrorContext = {}): CapturedError {
    let rec: CapturedError;
    try {
      const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : safeStringify(error));
      const active = tracer.active();
      rec = {
        id: `err-${Date.now()}-${(this.seq++).toString(36)}`,
        ts: Date.now(),
        source: context.source || 'server',
        message: err.message.slice(0, 1000),
        stack: err.stack?.slice(0, 4000),
        traceId: active?.traceId,
        context,
      };
      this.buffer.push(rec);
      if (this.buffer.length > this.maxErrors) this.buffer.splice(0, this.buffer.length - this.maxErrors);
      this.emitCloudErrorReport(rec, err);
    } catch {
      // Absolute last resort — tracking must never break the caller.
      rec = { id: `err-fallback`, ts: Date.now(), source: 'server', message: 'error capture failed', context: {} };
    }
    return rec;
  }

  /**
   * Cloud Error Reporting structured log. The `@type` + `message` (full stack) +
   * `serviceContext` shape is what Error Reporting parses from logs on Cloud Run.
   */
  private emitCloudErrorReport(rec: CapturedError, err: Error): void {
    try {
      const entry: Record<string, unknown> = {
        '@type': 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
        severity: 'ERROR',
        // Error Reporting groups on the stack trace in `message`.
        message: err.stack || `${err.name}: ${err.message}`,
        serviceContext: { service: SERVICE, version: VERSION },
        context: {
          httpRequest: rec.context.httpUrl
            ? { method: rec.context.httpMethod, url: rec.context.httpUrl, responseStatusCode: rec.context.httpStatus }
            : undefined,
          user: rec.context.userId,
          reportLocation: undefined,
        },
        source: rec.source,
        errorId: rec.id,
      };
      if (PROJECT && rec.traceId) entry['logging.googleapis.com/trace'] = `projects/${PROJECT}/traces/${rec.traceId}`;
      else if (rec.traceId) entry['traceId'] = rec.traceId;
      if (!process.env.VITEST && process.env.NODE_ENV !== 'test') console.error(JSON.stringify(entry));
    } catch { /* logging must never break anything */ }
  }

  /** Recent captured errors, newest first — for the admin endpoint. */
  recent(limit = 100): CapturedError[] {
    return this.buffer.slice(-limit).reverse();
  }

  /** Aggregate by message (group, count, lastSeen) — a lightweight Error-Reporting view. */
  summary(): Array<{ message: string; count: number; lastTs: number; sources: string[] }> {
    const groups = new Map<string, { count: number; lastTs: number; sources: Set<string> }>();
    for (const e of this.buffer) {
      const key = e.message;
      const g = groups.get(key) || { count: 0, lastTs: 0, sources: new Set<string>() };
      g.count += 1;
      g.lastTs = Math.max(g.lastTs, e.ts);
      g.sources.add(e.source);
      groups.set(key, g);
    }
    return [...groups.entries()]
      .map(([message, g]) => ({ message, count: g.count, lastTs: g.lastTs, sources: [...g.sources] }))
      .sort((a, b) => b.lastTs - a.lastTs);
  }

  /** Test helper. */
  clear(): void { this.buffer.length = 0; }
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

export const errorTracker = new ErrorTracker();

/**
 * Install process-level handlers so NOTHING goes unreported. For a long-lived web
 * server we report-and-continue on uncaughtException/unhandledRejection rather than
 * exiting — the platform's "app must never break" rule wins; an instance crash would
 * disrupt in-flight requests. Idempotent.
 */
let installed = false;
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;
  process.on('uncaughtException', (err) => {
    errorTracker.capture(err, { source: 'uncaughtException' });
  });
  process.on('unhandledRejection', (reason) => {
    errorTracker.capture(reason, { source: 'unhandledRejection' });
  });
}
