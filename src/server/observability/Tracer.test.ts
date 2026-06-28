import { describe, it, expect, beforeEach } from 'vitest';
import { Tracer, parseCloudTraceContext, newTraceId, newSpanId } from './Tracer';

describe('Tracer (P2.1 distributed tracing)', () => {
  let t: Tracer;
  beforeEach(() => { t = new Tracer(100); });

  describe('id generation', () => {
    it('newTraceId is 32 lowercase hex', () => {
      expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    });
    it('newSpanId is 16 lowercase hex', () => {
      expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
    });
    it('ids are unique', () => {
      expect(newTraceId()).not.toBe(newTraceId());
      expect(newSpanId()).not.toBe(newSpanId());
    });
  });

  describe('parseCloudTraceContext', () => {
    it('parses TRACE_ID/SPAN_ID;o=1', () => {
      const r = parseCloudTraceContext('105445aa7843bc8bf206b12000100000/1234;o=1');
      expect(r?.traceId).toBe('105445aa7843bc8bf206b12000100000');
      expect(r?.parentSpanId).toBe(BigInt(1234).toString(16).padStart(16, '0'));
    });
    it('parses a trace id with no span', () => {
      const r = parseCloudTraceContext('105445aa7843bc8bf206b12000100000');
      expect(r?.traceId).toBe('105445aa7843bc8bf206b12000100000');
      expect(r?.parentSpanId).toBeUndefined();
    });
    it('returns null for missing/garbage header', () => {
      expect(parseCloudTraceContext(undefined)).toBeNull();
      expect(parseCloudTraceContext('not-a-trace')).toBeNull();
    });
  });

  describe('span lifecycle', () => {
    it('records a completed span with duration and ok status', () => {
      const s = t.startSpan('op', {}, 1000);
      s.end(1150);
      const traces = t.recentTraces();
      expect(traces).toHaveLength(1);
      const span = traces[0].spans[0];
      expect(span.name).toBe('op');
      expect(span.durationMs).toBe(150);
      expect(span.status).toBe('ok');
    });

    it('end() is idempotent — a span is recorded once', () => {
      const s = t.startSpan('op', {}, 1000);
      s.end(1100);
      s.end(1200);
      expect(t.recentTraces()[0].spans).toHaveLength(1);
    });

    it('setStatus(error) is reflected and marks the trace as having an error', () => {
      const s = t.startSpan('boom');
      s.setStatus('error', 'kaboom');
      s.end();
      const tr = t.recentTraces()[0];
      expect(tr.hasError).toBe(true);
      expect(tr.spans[0].error).toBe('kaboom');
    });

    it('mutators are no-ops after end()', () => {
      const s = t.startSpan('op', {}, 1000);
      s.end(1100);
      s.setAttribute('late', 'value');
      s.setStatus('error');
      const span = t.recentTraces()[0].spans[0];
      expect(span.attributes.late).toBeUndefined();
      expect(span.status).toBe('ok');
    });
  });

  describe('context propagation (runInSpan + child spans)', () => {
    it('a child span started inside runInSpan inherits the parent trace + parent id', () => {
      const root = t.startSpan('request');
      t.runInSpan(root, () => {
        const child = t.startSpan('child');
        child.end();
      });
      root.end();
      const traces = t.recentTraces();
      expect(traces).toHaveLength(1); // both spans share ONE trace
      const trace = traces[0];
      expect(trace.spans).toHaveLength(2);
      const child = trace.spans.find(s => s.name === 'child')!;
      expect(child.traceId).toBe(root.data.traceId);
      expect(child.parentSpanId).toBe(root.data.spanId);
    });

    it('recordChildSpan attaches to the active trace and is a no-op outside one', () => {
      // Outside any active context → no span recorded.
      t.recordChildSpan('ai.provider.GROK', 50, 'ok');
      expect(t.recentTraces()).toHaveLength(0);

      // Inside an active request context → recorded as a child.
      const root = t.startSpan('request');
      t.runInSpan(root, () => {
        t.recordChildSpan('ai.provider.GROK', 50, 'ok', { provider: 'GROK' });
      });
      root.end();
      const spans = t.recentTraces()[0].spans;
      const provider = spans.find(s => s.name === 'ai.provider.GROK')!;
      expect(provider).toBeTruthy();
      expect(provider.parentSpanId).toBe(root.data.spanId);
      expect(provider.attributes.provider).toBe('GROK');
    });
  });

  describe('withSpan', () => {
    it('records ok on success', async () => {
      const r = await t.withSpan('work', async () => 42);
      expect(r).toBe(42);
      expect(t.recentTraces()[0].spans[0].status).toBe('ok');
    });
    it('records error status and rethrows on failure', async () => {
      await expect(t.withSpan('work', async () => { throw new Error('nope'); })).rejects.toThrow('nope');
      const span = t.recentTraces()[0].spans[0];
      expect(span.status).toBe('error');
      expect(span.error).toBe('nope');
    });
  });

  describe('aggregation', () => {
    it('spanStats groups by name with count/errors/avg/p95', () => {
      for (let i = 0; i < 10; i++) { const s = t.startSpan('op', {}, 0); s.end(((i + 1) * 10)); }
      const s = t.startSpan('op'); s.setStatus('error'); s.end();
      const stats = t.spanStats();
      expect(stats.op.count).toBe(11);
      expect(stats.op.errors).toBe(1);
      expect(stats.op.avgMs).toBeGreaterThan(0);
      expect(stats.op.p95Ms).toBeGreaterThanOrEqual(stats.op.avgMs);
    });

    it('recentTraces is newest-first and bounded by the ring buffer', () => {
      const small = new Tracer(3);
      for (let i = 0; i < 5; i++) { const s = small.startSpan(`op${i}`, {}, i); s.end(i + 1); }
      const traces = small.recentTraces();
      expect(traces.length).toBeLessThanOrEqual(3);
      // newest first
      expect(traces[0].startMs).toBeGreaterThanOrEqual(traces[traces.length - 1].startMs);
    });
  });
});
