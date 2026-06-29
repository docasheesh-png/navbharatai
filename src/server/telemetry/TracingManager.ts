// P-BRE.1 — Distributed tracing (dependency-free).
//
// A real per-build trace spanning the pipeline's stages, WITHOUT pulling in @opentelemetry/* (our
// dependency-free policy). It generates W3C trace context (traceparent), records a span per stage
// with timing + attributes, and — when an OTLP/HTTP endpoint is configured (OTEL_EXPORTER_OTLP_ENDPOINT,
// e.g. the Cloud Run OTLP collector) — exports the spans as OTLP JSON via fetch. With no endpoint it
// is an honest no-op (the trace + traceId are still attached to diagnostics for log↔trace correlation).
//
// Pure helpers (id/traceparent generation+parse, OTLP serialization, duration) are unit-tested.
// Uses node's built-in `crypto` — no new dependency.

import { randomBytes } from 'crypto';

export interface SpanRecord {
  name: string;
  spanId: string;
  parentSpanId?: string;
  startMs: number;
  endMs: number;
  attributes: Record<string, string | number | boolean>;
}

/** 16-byte (32 hex) trace id. */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** 8-byte (16 hex) span id. */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/** W3C traceparent: `00-<trace32>-<span16>-01` (sampled). Pure. */
export function formatTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}

/** Parse a W3C traceparent header → { traceId, spanId } or null if malformed. Pure. */
export function parseTraceparent(header: string | null | undefined): { traceId: string; spanId: string } | null {
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(String(header || '').trim());
  if (!m) return null;
  // All-zero ids are invalid per spec.
  if (/^0+$/.test(m[1]) || /^0+$/.test(m[2])) return null;
  return { traceId: m[1], spanId: m[2] };
}

/** Whether OTLP export is configured (and thus active). */
export function otlpEndpoint(): string | null {
  const ep = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  return ep && ep.trim() ? ep.trim().replace(/\/$/, '') : null;
}

/** Convert a finished trace to the OTLP/HTTP JSON shape (resourceSpans). Pure. */
export function toOtlpSpans(traceId: string, serviceName: string, spans: SpanRecord[]): unknown {
  const toNano = (ms: number) => String(Math.round(ms) * 1_000_000);
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
        scopeSpans: [
          {
            scope: { name: 'navbharatai-tracing' },
            spans: spans.map((s) => ({
              traceId,
              spanId: s.spanId,
              ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
              name: s.name,
              kind: 1, // INTERNAL
              startTimeUnixNano: toNano(s.startMs),
              endTimeUnixNano: toNano(s.endMs),
              attributes: Object.entries(s.attributes).map(([k, v]) => ({
                key: k,
                value:
                  typeof v === 'number'
                    ? { intValue: String(Math.round(v)) }
                    : typeof v === 'boolean'
                      ? { boolValue: v }
                      : { stringValue: String(v) },
              })),
            })),
          },
        ],
      },
    ],
  };
}

/** A live trace for one build. Records spans; exports (best-effort) on end. */
export class BuildTrace {
  readonly traceId: string;
  readonly rootSpanId: string;
  readonly traceparent: string;
  private spans: SpanRecord[] = [];

  constructor(
    private readonly name: string,
    private readonly serviceName: string,
    rootAttributes: Record<string, string | number | boolean> = {},
    parentTraceId?: string,
  ) {
    this.traceId = parentTraceId || generateTraceId();
    this.rootSpanId = generateSpanId();
    this.traceparent = formatTraceparent(this.traceId, this.rootSpanId);
    this._rootAttributes = rootAttributes;
    this._rootStart = -1;
  }

  private _rootAttributes: Record<string, string | number | boolean>;
  private _rootStart: number;

  /** Mark the root span's start (call once, at build start). */
  begin(nowMs: number): void {
    this._rootStart = nowMs;
  }

  /** Record a completed child span. */
  addSpan(name: string, startMs: number, endMs: number, attributes: Record<string, string | number | boolean> = {}): void {
    this.spans.push({ name, spanId: generateSpanId(), parentSpanId: this.rootSpanId, startMs, endMs: Math.max(startMs, endMs), attributes });
  }

  /** Finalize the root span + return all spans (root first). */
  finish(nowMs: number): SpanRecord[] {
    const root: SpanRecord = {
      name: this.name,
      spanId: this.rootSpanId,
      startMs: this._rootStart >= 0 ? this._rootStart : nowMs,
      endMs: nowMs,
      attributes: this._rootAttributes,
    };
    return [root, ...this.spans];
  }

  /**
   * Finalize + export to the OTLP endpoint if configured (best-effort; never throws). Returns the
   * finished span list (so diagnostics can record traceId + stage timings regardless of export).
   */
  async end(nowMs: number): Promise<SpanRecord[]> {
    const all = this.finish(nowMs);
    const ep = otlpEndpoint();
    if (ep && typeof fetch === 'function') {
      try {
        await fetch(`${ep}/v1/traces`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toOtlpSpans(this.traceId, this.serviceName, all)),
        });
      } catch { /* export is best-effort — never affect the build */ }
    }
    return all;
  }
}

/** Start a build trace, optionally continuing an inbound traceparent. */
export function startBuildTrace(
  name: string,
  attributes: Record<string, string | number | boolean> = {},
  inboundTraceparent?: string,
): BuildTrace {
  const parent = parseTraceparent(inboundTraceparent);
  return new BuildTrace(name, 'navbharatai', attributes, parent?.traceId);
}
