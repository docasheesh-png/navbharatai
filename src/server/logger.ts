// P-BRE.3 — Structured logging with build correlation IDs.
//
// A dependency-free structured `Logger` that emits one Cloud Logging-compatible JSON line
// per log: `{ severity, message, timestamp, traceId?, ...context, ...meta }`. On Cloud Run
// these are parsed natively — you can filter "all logs for jobId X" or jump from a log to
// its trace. Level-filtered by `LOG_LEVEL` (debug < info < warn < error). Build/request
// correlation fields (jobId, userId, …) propagate across async boundaries via
// AsyncLocalStorage — wrap a build in `withLogContext({ jobId }, fn)` and every `log.*`
// call inside inherits it. The `traceId` is pulled from the P2.1 tracer's active span, so
// logs and traces correlate automatically. Every method is best-effort and never throws.

import { AsyncLocalStorage } from 'async_hooks';
import { tracer } from './observability/Tracer';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SEVERITY: Record<LogLevel, string> = { debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR' };

/** Resolve the configured minimum level from env (default: info in prod, debug otherwise). */
export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const raw = (env.LOG_LEVEL || '').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return env.NODE_ENV === 'production' ? 'info' : 'debug';
}

/** Pure (unit-tested): should a message at `level` be emitted given the configured `min`? */
export function shouldLog(level: LogLevel, min: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[min];
}

export type LogContext = Record<string, string | number | boolean>;

/** Pure (unit-tested): build the structured log record. */
export function buildLogRecord(
  level: LogLevel,
  message: string,
  context: LogContext,
  meta: Record<string, unknown> | undefined,
  traceId: string | undefined,
  timestamp: string,
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    severity: SEVERITY[level],
    message,
    timestamp,
    ...context,
    ...(meta || {}),
  };
  if (traceId) record.traceId = traceId;
  return record;
}

class Logger {
  private readonly als = new AsyncLocalStorage<LogContext>();

  /** Run `fn` with extra correlation fields merged into every log emitted inside it. */
  withContext<T>(context: LogContext, fn: () => T): T {
    const parent = this.als.getStore() || {};
    return this.als.run({ ...parent, ...context }, fn);
  }

  /** The correlation context active in the current async scope (read-only). */
  context(): LogContext {
    return { ...(this.als.getStore() || {}) };
  }

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    try {
      if (!shouldLog(level, resolveLogLevel())) return;
      const traceId = tracer.active()?.traceId;
      const record = buildLogRecord(level, message, this.als.getStore() || {}, meta, traceId, new Date().toISOString());
      const line = JSON.stringify(record);
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    } catch {
      /* logging must never break the caller */
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void { this.emit('debug', message, meta); }
  info(message: string, meta?: Record<string, unknown>): void { this.emit('info', message, meta); }
  warn(message: string, meta?: Record<string, unknown>): void { this.emit('warn', message, meta); }
  error(message: string, meta?: Record<string, unknown>): void { this.emit('error', message, meta); }
}

/** Process-wide structured logger. */
export const log = new Logger();

/** Convenience: run a build/request with a correlation context (jobId, userId, …). */
export function withLogContext<T>(context: LogContext, fn: () => T): T {
  return log.withContext(context, fn);
}
