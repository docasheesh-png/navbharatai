// P2.1 — Distributed Tracing (UPGRADE v3.0).
//
// A real, dependency-free distributed tracer. It produces W3C-style trace/span ids,
// builds parent→child span trees (HTTP request → AI provider → …), keeps the recent
// traces in a bounded in-memory ring buffer (for the observability endpoint), and emits
// each completed span as a Cloud Logging structured line carrying the
// `logging.googleapis.com/trace` + `spanId` fields. On Cloud Run those fields are
// automatically correlated by Cloud Logging into **Cloud Trace** — i.e. this is real
// trace export with zero extra SDK, zero extra credentials, and no way to break a
// request (every tracing call is best-effort and never throws).
//
// Context propagates across async boundaries via AsyncLocalStorage, so code deep in the
// router (e.g. the AI provider call) can attach a child span to the active request trace
// without threading a context object through every function signature.

import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

export type SpanStatus = 'unset' | 'ok' | 'error';
export type AttrValue = string | number | boolean;

export interface SpanData {
  traceId: string;          // 32 lowercase hex chars (W3C trace-id)
  spanId: string;           // 16 lowercase hex chars (W3C span-id)
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  attributes: Record<string, AttrValue>;
  status: SpanStatus;
  error?: string;
}

function hex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/** New W3C trace-id (16 bytes → 32 hex). */
export function newTraceId(): string { return hex(16); }
/** New W3C span-id (8 bytes → 16 hex). */
export function newSpanId(): string { return hex(8); }

/**
 * Parse GCP's `X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=1` header (set by the Cloud
 * Run / GFE front end) so our spans join the SAME trace the platform already started.
 * Returns null when absent/malformed. TRACE_ID is already 32 hex; SPAN_ID is decimal.
 */
export function parseCloudTraceContext(header: string | undefined): { traceId: string; parentSpanId?: string } | null {
  if (!header) return null;
  const m = /^([0-9a-fA-F]{32})(?:\/(\d+))?/.exec(header.trim());
  if (!m) return null;
  const traceId = m[1].toLowerCase();
  let parentSpanId: string | undefined;
  if (m[2]) {
    // decimal span id → 16-hex, zero-padded
    try { parentSpanId = BigInt(m[2]).toString(16).padStart(16, '0').slice(-16); } catch { /* ignore */ }
  }
  return { traceId, parentSpanId };
}

export interface SpanStartOptions {
  traceId?: string;
  parentSpanId?: string;
  attributes?: Record<string, AttrValue>;
}

/** A live span. Call end() exactly once; all mutators are no-ops after end(). */
export class Span {
  readonly data: SpanData;
  private ended = false;
  private readonly onEnd: (s: SpanData) => void;

  constructor(data: SpanData, onEnd: (s: SpanData) => void) {
    this.data = data;
    this.onEnd = onEnd;
  }

  setAttribute(key: string, value: AttrValue): this {
    if (!this.ended) this.data.attributes[key] = value;
    return this;
  }

  setStatus(status: SpanStatus, error?: string): this {
    if (!this.ended) { this.data.status = status; if (error) this.data.error = error.slice(0, 500); }
    return this;
  }

  end(nowMs: number = Date.now()): void {
    if (this.ended) return;
    this.ended = true;
    this.data.endMs = nowMs;
    this.data.durationMs = Math.max(0, nowMs - this.data.startMs);
    if (this.data.status === 'unset') this.data.status = 'ok';
    try { this.onEnd(this.data); } catch { /* never break the caller */ }
  }
}

interface RuntimeContext {
  traceId: string;
  spanId: string; // current active span id (becomes parent of children started under it)
}

export class Tracer {
  private readonly als = new AsyncLocalStorage<RuntimeContext>();
  private readonly buffer: SpanData[] = [];
  private readonly maxSpans: number;
  /** GCP project id for the Cloud Trace log field — auto-detected, optional. */
  private readonly projectId: string;

  constructor(maxSpans = 1000) {
    this.maxSpans = maxSpans;
    this.projectId = (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT_ID || '').trim();
  }

  /** The active trace context for the current async scope, if any. */
  active(): { traceId: string; spanId: string } | undefined {
    return this.als.getStore();
  }

  /**
   * Start a span. When no traceId/parent is given it inherits the active context (so a
   * child span auto-attaches to the running request trace); otherwise it begins a new trace.
   */
  startSpan(name: string, opts: SpanStartOptions = {}, nowMs: number = Date.now()): Span {
    const ctx = this.als.getStore();
    const traceId = opts.traceId || ctx?.traceId || newTraceId();
    const parentSpanId = opts.parentSpanId ?? (opts.traceId ? undefined : ctx?.spanId);
    const data: SpanData = {
      traceId,
      spanId: newSpanId(),
      parentSpanId,
      name,
      startMs: nowMs,
      attributes: { ...(opts.attributes || {}) },
      status: 'unset',
    };
    return new Span(data, (s) => this.record(s));
  }

  /**
   * Run `fn` as the ROOT span of a request and keep its context active for everything
   * awaited inside — so deeper code (the AI provider call) can attach child spans.
   */
  runInSpan<T>(span: Span, fn: () => T): T {
    return this.als.run({ traceId: span.data.traceId, spanId: span.data.spanId }, fn);
  }

  /** Convenience: time an async fn as a child span, recording error status on throw. */
  async withSpan<T>(name: string, fn: (span: Span) => Promise<T>, opts: SpanStartOptions = {}): Promise<T> {
    const span = this.startSpan(name, opts);
    try {
      const result = await fn(span);
      span.setStatus('ok');
      return result;
    } catch (err) {
      span.setStatus('error', err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * Emit a completed child span from already-measured timing (used at single chokepoints
   * like recordProviderLatency, where wrapping the call site would be invasive). No-op
   * outside an active trace — never starts a stray trace.
   */
  recordChildSpan(name: string, durationMs: number, status: SpanStatus, attributes: Record<string, AttrValue> = {}, error?: string): void {
    const ctx = this.als.getStore();
    if (!ctx) return;
    const end = Date.now();
    const data: SpanData = {
      traceId: ctx.traceId,
      spanId: newSpanId(),
      parentSpanId: ctx.spanId,
      name,
      startMs: end - Math.max(0, durationMs),
      endMs: end,
      durationMs: Math.max(0, durationMs),
      attributes,
      status: status === 'unset' ? 'ok' : status,
      ...(error ? { error: error.slice(0, 500) } : {}),
    };
    this.record(data);
  }

  private record(span: SpanData): void {
    this.buffer.push(span);
    if (this.buffer.length > this.maxSpans) this.buffer.splice(0, this.buffer.length - this.maxSpans);
    this.emitStructuredLog(span);
  }

  /** Cloud Logging structured line → auto-correlated into Cloud Trace on Cloud Run. */
  private emitStructuredLog(span: SpanData): void {
    try {
      const entry: Record<string, unknown> = {
        severity: span.status === 'error' ? 'ERROR' : 'INFO',
        message: `[SPAN] ${span.name} ${span.durationMs}ms ${span.status}`,
        span: { name: span.name, durationMs: span.durationMs, status: span.status, attributes: span.attributes, error: span.error },
        'logging.googleapis.com/spanId': span.spanId,
      };
      if (this.projectId) entry['logging.googleapis.com/trace'] = `projects/${this.projectId}/traces/${span.traceId}`;
      else entry['traceId'] = span.traceId;
      // Suppress noisy span logs under tests.
      if (!process.env.VITEST && process.env.NODE_ENV !== 'test') console.log(JSON.stringify(entry));
    } catch { /* logging must never break anything */ }
  }

  /** Recent traces, grouped by traceId, newest first — for the observability endpoint. */
  recentTraces(limit = 50): Array<{ traceId: string; spans: SpanData[]; startMs: number; durationMs: number; rootName: string; hasError: boolean }> {
    const byTrace = new Map<string, SpanData[]>();
    for (const s of this.buffer) {
      const arr = byTrace.get(s.traceId) || [];
      arr.push(s);
      byTrace.set(s.traceId, arr);
    }
    const traces = [...byTrace.entries()].map(([traceId, spans]) => {
      const sorted = [...spans].sort((a, b) => a.startMs - b.startMs);
      const root = sorted.find(s => !s.parentSpanId) || sorted[0];
      const startMs = Math.min(...sorted.map(s => s.startMs));
      const endMs = Math.max(...sorted.map(s => s.endMs ?? s.startMs));
      return {
        traceId,
        spans: sorted,
        startMs,
        durationMs: endMs - startMs,
        rootName: root?.name ?? 'unknown',
        hasError: sorted.some(s => s.status === 'error'),
      };
    });
    traces.sort((a, b) => b.startMs - a.startMs);
    return traces.slice(0, limit);
  }

  /** Aggregate span stats by name (count, error count, avg/p95 latency) for metrics. */
  spanStats(): Record<string, { count: number; errors: number; avgMs: number; p95Ms: number }> {
    const byName = new Map<string, number[]>();
    const errByName = new Map<string, number>();
    for (const s of this.buffer) {
      const arr = byName.get(s.name) || [];
      if (typeof s.durationMs === 'number') arr.push(s.durationMs);
      byName.set(s.name, arr);
      if (s.status === 'error') errByName.set(s.name, (errByName.get(s.name) || 0) + 1);
    }
    const out: Record<string, { count: number; errors: number; avgMs: number; p95Ms: number }> = {};
    for (const [name, durations] of byName) {
      const sorted = [...durations].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
      out[name] = {
        count: sorted.length,
        errors: errByName.get(name) || 0,
        avgMs: sorted.length ? Math.round(sum / sorted.length) : 0,
        p95Ms: p95,
      };
    }
    return out;
  }

  /** Test/diagnostic helper — clear the buffer. */
  clear(): void { this.buffer.length = 0; }
}

/** Process-wide tracer singleton. */
export const tracer = new Tracer();
