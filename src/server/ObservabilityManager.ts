import { tracer } from './observability/Tracer';

/**
 * P2.1 — kept as a thin compatibility facade over the real distributed tracer.
 * `trackLatency` now also emits a tracing span (correlated into the active request
 * trace + Cloud Trace), so existing callers get real observability for free.
 */
export class ObservabilityManager {
  private metrics: Record<string, any> = {};

  trackLatency(provider: string, ms: number) {
    this.metrics[`latency_${provider}`] = ms;
    tracer.recordChildSpan(`latency.${provider}`, ms, 'ok', { provider });
  }

  logCrash(error: string) {
    if (!this.metrics.crashes) this.metrics.crashes = [];
    this.metrics.crashes.push({ error, timestamp: new Date() });
  }

  getMetrics() {
    return this.metrics;
  }

  /** Real span aggregates from the tracer (count / error rate / avg / p95 per span name). */
  getSpanStats() {
    return tracer.spanStats();
  }
}
