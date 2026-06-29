import { describe, it, expect } from 'vitest';
import {
  generateTraceId,
  generateSpanId,
  formatTraceparent,
  parseTraceparent,
  toOtlpSpans,
  startBuildTrace,
  type SpanRecord,
} from '../src/server/telemetry/TracingManager';

/** P-BRE.1 — dependency-free tracing (pure helpers + trace lifecycle). */

describe('TracingManager — ids + traceparent', () => {
  it('generates 32-hex trace ids and 16-hex span ids', () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/);
    expect(generateTraceId()).not.toBe(generateTraceId());
  });
  it('formats + parses a W3C traceparent round-trip', () => {
    const t = generateTraceId();
    const s = generateSpanId();
    const tp = formatTraceparent(t, s);
    expect(tp).toBe(`00-${t}-${s}-01`);
    expect(parseTraceparent(tp)).toEqual({ traceId: t, spanId: s });
  });
  it('rejects malformed / all-zero traceparents', () => {
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent('00-00000000000000000000000000000000-0000000000000000-01')).toBeNull();
    expect(parseTraceparent(null)).toBeNull();
  });
});

describe('TracingManager — OTLP serialization', () => {
  it('produces a valid resourceSpans shape with typed attributes', () => {
    const spans: SpanRecord[] = [
      { name: 'build', spanId: 'a'.repeat(16), startMs: 1000, endMs: 4000, attributes: { ok: true, files: 7, intent: 'new_build' } },
    ];
    const otlp = toOtlpSpans('b'.repeat(32), 'navbharatai', spans) as any;
    const span = otlp.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.traceId).toBe('b'.repeat(32));
    expect(span.name).toBe('build');
    expect(span.startTimeUnixNano).toBe(String(1000 * 1_000_000));
    const attrs = Object.fromEntries(span.attributes.map((a: any) => [a.key, a.value]));
    expect(attrs.ok).toEqual({ boolValue: true });
    expect(attrs.files).toEqual({ intValue: '7' });
    expect(attrs.intent).toEqual({ stringValue: 'new_build' });
  });
});

describe('TracingManager — BuildTrace lifecycle', () => {
  it('records child spans under the root and finishes root-first', () => {
    const tr = startBuildTrace('agentv3.build', { intent: 'new_build' });
    tr.begin(100);
    tr.addSpan('build.run', 110, 900, { tier: 'sonnet' });
    tr.addSpan('build.preview_verify', 910, 1200);
    const spans = tr.finish(1300);
    expect(spans[0].name).toBe('agentv3.build'); // root first
    expect(spans[0].startMs).toBe(100);
    expect(spans[0].endMs).toBe(1300);
    expect(spans).toHaveLength(3);
    // children link to the root span.
    expect(spans[1].parentSpanId).toBe(tr.rootSpanId);
    expect(spans[1].name).toBe('build.run');
  });
  it('continues an inbound traceparent', () => {
    const parentTrace = generateTraceId();
    const tr = startBuildTrace('child', {}, `00-${parentTrace}-${generateSpanId()}-01`);
    expect(tr.traceId).toBe(parentTrace);
  });
});
