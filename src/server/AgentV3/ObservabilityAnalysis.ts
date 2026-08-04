// AgentV3 — Observability analysis (additive evaluate dimension).
//
// ROADMAP Cap-4 ("auto-inject observability"), advisory half. A real, deterministic PROJECT-LEVEL scan
// over the backend the agent actually wrote, for the three observability gaps that make a shipped app
// undebuggable and un-monitorable in production:
//   • no health endpoint  — a deploy/uptime probe (and our own runtime gate) has nothing to hit, so a
//                            dead backend looks "up"; every real platform (Cloud Run, k8s, load balancers)
//                            wants a /health (or /healthz/ready/ping) route.
//   • no error handler     — an Express app with routes but no error-handling middleware leaks stack
//                            traces / hangs the request on a thrown error instead of a clean 500.
//   • no request logging   — no morgan/pino/winston/console access log → zero visibility into what the
//                            server served when something breaks.
//
// Read-only and conservative (high precision): findings are computed from real content, aggregated at the
// PROJECT level (a backend is detected once, then the three gaps are checked across all its files), and a
// gap is only reported when a server is genuinely present. No server detected ⇒ zero findings (a static
// front-end SPA correctly reports clean). The `evaluate` tool surfaces the summary so the agent can fix
// concrete gaps — never a synthetic "looks observable". Auto-injection is a separate, later slice.

export type ObservabilitySeverity = 'high' | 'medium' | 'low';

export interface ObservabilityIssue {
  file: string;
  kind: 'missing-health-endpoint' | 'missing-error-handler' | 'missing-request-logging';
  severity: ObservabilitySeverity;
  detail: string;
}

/** Server-side source we scan. Front-end markup and configs carry no server observability semantics. */
const BACKEND_EXT = /\.(ts|js|mjs|cjs)$/i;
/** Paths we never scan — generated, vendored, test, or clearly front-end-only trees. */
const SKIP_PATH =
  /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git|public|assets)([\\/]|$)|\.d\.ts$|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)/i;

/** Signals that a file sets up an HTTP server (any one is enough to call the project "has a backend"). */
const SERVER_SIGNALS: RegExp[] = [
  /\bexpress\s*\(/, // express()
  /\bFastify\s*\(/i, // Fastify()
  /\bfastify\s*\(/, // fastify()
  /\bnew\s+Hono\s*\(/, // Hono
  /\bhttp\.createServer\s*\(/, // node http
  /\bcreateServer\s*\(/, // generic
  /@nestjs\/core/, // NestJS
  /\bKoa\s*\(|\bnew\s+Koa\s*\(/, // Koa
  /\.listen\s*\(\s*(?:process\.env\.PORT|\d)/, // app.listen(PORT | number)
];

/** A health route anywhere in the backend (Express/Fastify/Koa/Hono/Nest all register a path string). */
const HEALTH_ROUTE = /['"`]\/(?:health(?:z|check)?|_health|ready|livez|readyz|ping|status)\b/i;
/** NestJS health via Terminus — a decorator-based health controller counts as present. */
const NEST_HEALTH = /@nestjs\/terminus|HealthCheck\s*\(|@Get\s*\(\s*['"`]health/i;

/** An Express-style error-handling middleware: a 4-arg (err, req, res, next) callback, or app.use(errorHandler). */
const ERROR_HANDLER =
  /\(\s*err(?:or)?\s*(?::[^,)]+)?\s*,\s*\w+\s*(?::[^,)]+)?\s*,\s*\w+\s*(?::[^,)]+)?\s*,\s*\w+\s*(?::[^,)]+)?\s*\)\s*=>|\.use\s*\(\s*\w*[eE]rror\w*\s*\)|setErrorHandler\s*\(/;
/** Any request logger — a library, a hand-rolled `.use(...log...)` middleware, or a middleware that logs on
 *  the response's `finish` event (the dependency-free idiom the observability injector auto-adds; the two
 *  detectors must agree on what counts as a logger, so an injected app is never re-flagged as missing one). */
const REQUEST_LOGGER =
  /\bmorgan\s*\(|\bpino(?:-http|Http)?\s*\(|require\(['"`]morgan|from\s+['"`]morgan|\bwinston\b|express-winston|\brequestLogger\b|\.use\s*\(\s*[^)]*\blog|res\.on\s*\(\s*['"`]finish['"`]/i;
/** Frameworks whose error-handler / logging idioms differ enough that we only flag the health gap. */
const EXPRESS_LIKE = /\bexpress\s*\(|\bKoa\s*\(|\bnew\s+Koa\s*\(/;

function scannableBackendFiles(files: Record<string, string>): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  for (const [path, content] of Object.entries(files)) {
    if (!BACKEND_EXT.test(path) || SKIP_PATH.test(path)) continue;
    if (typeof content !== 'string' || !content) continue;
    out.push({ path, content });
  }
  return out;
}

/**
 * Scan a whole project's files for backend observability gaps. Aggregated at the project level: the backend
 * is detected once, then health / error-handler / logging are checked across ALL backend files (so a
 * /health route in a separate routes file still counts). Returns [] when there is no backend at all.
 */
export function scanObservability(files: Record<string, string>): ObservabilityIssue[] {
  const backend = scannableBackendFiles(files);
  if (backend.length === 0) return [];

  // Locate the server-entry file(s) — the one(s) that actually stand a server up.
  const serverFiles = backend.filter((f) => SERVER_SIGNALS.some((re) => re.test(f.content)));
  if (serverFiles.length === 0) return []; // no HTTP server → not a backend we can reason about.

  const allText = backend.map((f) => f.content).join('\n');
  const entry = serverFiles[0].path; // report against a real server-entry path.
  const issues: ObservabilityIssue[] = [];

  // 1) Health endpoint — highest signal, framework-agnostic.
  const hasHealth = HEALTH_ROUTE.test(allText) || NEST_HEALTH.test(allText);
  if (!hasHealth) {
    issues.push({
      file: entry,
      kind: 'missing-health-endpoint',
      severity: 'high',
      detail: 'no /health (or /healthz, /ready, /ping) route — deploy/uptime probes and the runtime gate have nothing to check.',
    });
  }

  // 2) & 3) Only for Express/Koa-style apps (Fastify/Nest/Hono have their own conventions we do not false-flag).
  const isExpressLike = backend.some((f) => EXPRESS_LIKE.test(f.content));
  if (isExpressLike) {
    if (!ERROR_HANDLER.test(allText)) {
      issues.push({
        file: entry,
        kind: 'missing-error-handler',
        severity: 'medium',
        detail: 'no error-handling middleware ((err, req, res, next) => …) — a thrown error leaks a stack trace or hangs the request instead of a clean 500.',
      });
    }
    if (!REQUEST_LOGGER.test(allText)) {
      issues.push({
        file: entry,
        kind: 'missing-request-logging',
        severity: 'low',
        detail: 'no request logger (morgan/pino/winston) — no visibility into what the server served when something breaks.',
      });
    }
  }

  return issues;
}

/** A concise, honest observability report for the agent. */
export function observabilitySummary(issues: ObservabilityIssue[]): string {
  if (issues.length === 0) return 'Observability scan: ✓ No backend observability gaps detected.';
  const order: Record<ObservabilitySeverity, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = issues.reduce(
    (acc, x) => ((acc[x.severity] = (acc[x.severity] || 0) + 1), acc),
    {} as Record<ObservabilitySeverity, number>,
  );
  const head =
    `Observability scan: ${issues.length} gap(s) — ` +
    (['high', 'medium', 'low'] as ObservabilitySeverity[])
      .filter((s) => counts[s])
      .map((s) => `${counts[s]} ${s}`)
      .join(', ') + '.';
  const body = sorted.map((x) => `  - [${x.severity}] ${x.file} — ${x.kind}: ${x.detail}`);
  return [head, ...body].join('\n');
}
