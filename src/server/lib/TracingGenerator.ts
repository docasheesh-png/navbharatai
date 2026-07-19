// T2.8 (roadmap 2026-07-19) — Distributed tracing generator (Tier-2, observability).
//
// The audit's DevOps ❌ included "Tracing" (no OpenTelemetry). With generate_observability (logging) and
// generate_metrics (metrics), this completes the observability trio: an OpenTelemetry NodeSDK with
// auto-instrumentation for HTTP/Express/DB and an OTLP exporter, so a request becomes a distributed trace
// across services in Jaeger/Tempo/Honeycomb/any OTLP backend. Bring-Your-Own collector endpoint via env.
// PURE builder → the caller writes the file. Real, complete code — no stubs (the real-features rule).

export interface TracingResult {
  files: Record<string, string>;
  envKeys: string[];
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

const TRACING = `// IMPORTANT: import this as the VERY FIRST line of your server entry (before express/http/db), so the
// auto-instrumentations can patch those modules:  import './tracing';
// Set OTEL_SERVICE_NAME and OTEL_EXPORTER_OTLP_ENDPOINT (your collector, e.g. http://localhost:4318/v1/traces).
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// The exporter reads OTEL_EXPORTER_OTLP_ENDPOINT; the service name comes from OTEL_SERVICE_NAME. When the
// endpoint is unset the SDK simply produces no spans — tracing never breaks the app.
const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Flush spans on shutdown so the last requests aren't lost.
process.once('SIGTERM', () => { void sdk.shutdown().finally(() => process.exit(0)); });

export default sdk;
`;

/** Generate an OpenTelemetry tracing setup. Pure — returns the files. Never throws. */
export function generateTracing(): TracingResult {
  return {
    files: {
      'server/tracing.ts': TRACING,
      [ENV_EXAMPLE]: 'OTEL_SERVICE_NAME=\nOTEL_EXPORTER_OTLP_ENDPOINT=\n',
    },
    envKeys: ['OTEL_SERVICE_NAME', 'OTEL_EXPORTER_OTLP_ENDPOINT'],
    dependencies: [
      { name: '@opentelemetry/sdk-node', version: '^0.52' },
      { name: '@opentelemetry/auto-instrumentations-node', version: '^0.48' },
      { name: '@opentelemetry/exporter-trace-otlp-http', version: '^0.52' },
    ],
    instructions:
      'Wired OpenTelemetry distributed tracing. Import it FIRST in your server entry (import "./tracing"; at the ' +
      'very top, before express/http — the auto-instrumentation must patch those modules). In .env set OTEL_SERVICE_NAME ' +
      'and OTEL_EXPORTER_OTLP_ENDPOINT (your OTLP collector, e.g. Jaeger/Tempo/Honeycomb) — NavBharatAI never ' +
      'stores it. HTTP/Express/DB calls then appear as distributed traces; with no endpoint set it is a no-op, ' +
      'so it never breaks the app. Never overwrites an existing .env.example.',
  };
}
