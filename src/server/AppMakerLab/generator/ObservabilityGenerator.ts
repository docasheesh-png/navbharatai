// P-CGE.11 — Observability Instrumentation Generator.
//
// Generated apps shipped as black boxes: no request logging, no client error capture, no health
// probe. This produces real, runnable, DEPENDENCY-FREE instrumentation files for a generated app:
//   • a client-side error handler (window error + unhandledrejection → structured logs)
//   • an Express request logger middleware (method/path/status/duration)
//   • a GET /health endpoint (200 + uptime)
//
// Dependency-free by design: the generated code uses only the platform/Express the app already has —
// it never forces a new install (no `morgan`), so it can't break the user's build. The logger is a
// console-structured baseline the developer can point at Sentry/Datadog later. Pure → unit-tested.

export type ObservabilityTarget = 'frontend' | 'backend' | 'both';

export interface ObservabilityFile {
  path: string;
  content: string;
  /** A one-line note on how to wire this file into the app. */
  wiring: string;
}

export interface ObservabilityResult {
  files: ObservabilityFile[];
  summary: string;
}

/** Client-side uncaught-error + unhandled-rejection capture. Import once from the app entry. */
function frontendErrorHandler(): string {
  return [
    "// Client-side error capture — logs uncaught errors and unhandled promise rejections with",
    "// context. Import ONCE from your app entry (e.g. main.tsx): import './observability';",
    "// Swap the console call for your error-tracking SDK (Sentry, etc.) when you add one.",
    '',
    'interface ErrorRecord {',
    '  message: string;',
    '  source?: string;',
    '  line?: number;',
    '  col?: number;',
    '  stack?: string;',
    '  at: string;',
    '}',
    '',
    'function report(rec: ErrorRecord): void {',
    "  console.error('[app-error]', JSON.stringify(rec));",
    '}',
    '',
    "if (typeof window !== 'undefined') {",
    "  window.addEventListener('error', (e: ErrorEvent) => {",
    '    report({',
    '      message: String(e.message || (e.error && e.error.message) || e.error || ""),',
    '      source: e.filename,',
    '      line: e.lineno,',
    '      col: e.colno,',
    '      stack: e.error && e.error.stack,',
    '      at: new Date().toISOString(),',
    '    });',
    '  });',
    "  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {",
    '    const r: any = e.reason;',
    '    report({',
    '      message: r && r.message ? String(r.message) : String(r),',
    '      stack: r && r.stack,',
    '      at: new Date().toISOString(),',
    '    });',
    '  });',
    '}',
    '',
    'export {};',
    '',
  ].join('\n');
}

/** Express request logger middleware — method, path, status, duration. Dependency-free. */
function requestLogger(): string {
  return [
    '// Express request logger (dependency-free) — logs method, path, status and duration as',
    '// structured JSON. Use: app.use(requestLogger);  (mount before your routes).',
    "import type { Request, Response, NextFunction } from 'express';",
    '',
    'export function requestLogger(req: Request, res: Response, next: NextFunction): void {',
    '  const start = Date.now();',
    "  res.on('finish', () => {",
    '    console.log(',
    '      JSON.stringify({',
    "        level: 'info',",
    '        method: req.method,',
    '        path: req.originalUrl || req.url,',
    '        status: res.statusCode,',
    '        durationMs: Date.now() - start,',
    '        at: new Date().toISOString(),',
    '      }),',
    '    );',
    '  });',
    '  next();',
    '}',
    '',
  ].join('\n');
}

/** Health-check route — GET /health → 200 with uptime. Dependency-free (Express Router). */
function healthEndpoint(): string {
  return [
    '// Health-check route — mount with: app.use(healthRouter);  (responds GET /health -> 200).',
    "import { Router, type Request, type Response } from 'express';",
    '',
    'export const healthRouter = Router();',
    '',
    "healthRouter.get('/health', (_req: Request, res: Response) => {",
    "  res.status(200).json({ status: 'ok', uptime: process.uptime(), at: new Date().toISOString() });",
    '});',
    '',
  ].join('\n');
}

/**
 * Generate observability instrumentation files for a generated app. Pure: returns the files +
 * their wiring notes; the caller writes them. `target` selects frontend, backend, or both.
 */
export function generateObservability(
  input: { target?: ObservabilityTarget } = {},
): ObservabilityResult {
  const target: ObservabilityTarget = input.target === 'frontend' || input.target === 'backend' ? input.target : 'both';
  const files: ObservabilityFile[] = [];

  if (target === 'frontend' || target === 'both') {
    files.push({
      path: 'src/observability.ts',
      content: frontendErrorHandler(),
      wiring: "Add `import './observability';` at the top of your app entry (e.g. src/main.tsx).",
    });
  }
  if (target === 'backend' || target === 'both') {
    files.push({
      path: 'src/server/requestLogger.ts',
      content: requestLogger(),
      wiring: "Mount with `app.use(requestLogger);` before your routes.",
    });
    files.push({
      path: 'src/server/health.ts',
      content: healthEndpoint(),
      wiring: "Mount with `app.use(healthRouter);` so GET /health returns 200.",
    });
  }

  const summary = `Generated ${files.length} observability file(s) for ${target}: ${files.map((f) => f.path).join(', ')}.`;
  return { files, summary };
}
