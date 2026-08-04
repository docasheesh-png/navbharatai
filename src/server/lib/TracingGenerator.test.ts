import { describe, it, expect } from 'vitest';
import { generateTracing } from './TracingGenerator';

describe('generateTracing', () => {
  it('emits a tracing entry + a blank .env.example, and declares the otel deps + env keys', () => {
    const out = generateTracing();
    expect(Object.keys(out.files).sort()).toEqual(['.env.example', 'server/tracing.ts']);
    expect(out.envKeys).toEqual(['OTEL_SERVICE_NAME', 'OTEL_EXPORTER_OTLP_ENDPOINT']);
    expect(out.dependencies.map((d) => d.name).sort()).toEqual([
      '@opentelemetry/auto-instrumentations-node',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/sdk-node',
    ]);
  });

  it('uses the NodeSDK with auto-instrumentation + OTLP exporter and flushes on shutdown', () => {
    const t = generateTracing().files['server/tracing.ts'];
    expect(t).toContain('new NodeSDK(');
    expect(t).toContain('getNodeAutoInstrumentations()');
    expect(t).toContain('new OTLPTraceExporter()');
    expect(t).toContain('sdk.start()');
    expect(t).toContain('sdk.shutdown()'); // graceful flush
  });

  it('the .env.example is blank (never leaks a value)', () => {
    const env = generateTracing().files['.env.example'];
    expect(env).toContain('OTEL_EXPORTER_OTLP_ENDPOINT=\n');
    expect(env).not.toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT=.+/);
  });
});
