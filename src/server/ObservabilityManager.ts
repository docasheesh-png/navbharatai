export class ObservabilityManager {
  private metrics: Record<string, any> = {};

  trackLatency(provider: string, ms: number) {
    this.metrics[`latency_${provider}`] = ms;
  }

  logCrash(error: string) {
    if (!this.metrics.crashes) this.metrics.crashes = [];
    this.metrics.crashes.push({ error, timestamp: new Date() });
  }

  getMetrics() {
    return this.metrics;
  }
}
