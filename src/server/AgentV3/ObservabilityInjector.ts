// AgentV3 — Observability auto-injection (Cap-4, injection half).
//
// The advisory half (ObservabilityAnalysis, #1548) flags a backend missing a /health route, an error
// handler, or a request logger. This is the deterministic INJECTION half for the three dependency-free,
// safe-to-add gaps:
//   • a `/health` route on an Express server that lacks one,
//   • a 4-arg error-handling middleware on an Express server that lacks one, and
//   • a request logger on an Express server that lacks one.
// The /health route and error handler are placed immediately before `.listen(` — so the health route is
// registered before the server starts, and the error handler is registered AFTER every route (Express
// requires the error handler to be the last middleware). The request logger instead goes immediately AFTER
// the app declaration, BEFORE any route, because Express middleware only runs for routes registered after it.
// The logger is DEPENDENCY-FREE by design: a tiny inline middleware that logs method/url/status/duration via
// console (never headers or body, so secrets never leak) — no morgan/pino, so it adds nothing to
// package.json and can never break the install (the same philosophy as the other two injections). A user who
// wants structured logging still has the pino-based `generate_logging` recipe.
//
// This module is PURE and deterministic (no I/O): given the project files it returns the single edited file,
// or null when it cannot inject with high confidence. Conservative by construction — it only acts on the
// clear, common case (an Express app declared AND `.listen(`-ed in the same file) and returns null on
// anything ambiguous, so it can never produce broken or misplaced code. The caller (ToolDispatcher) writes
// the result through the durable write path and only when the gate is enabled.

/** Server-side source we consider. */
const BACKEND_EXT = /\.(ts|js|mjs|cjs)$/i;
/** Paths we never touch — generated, vendored, or test trees. */
const SKIP_PATH =
  /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git|public|assets)([\\/]|$)|\.d\.ts$|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)/i;

/** An existing health route anywhere in the file — if present we never inject a duplicate. */
const HEALTH_ROUTE = /['"`]\/(?:health(?:z|check)?|_health|ready|livez|readyz|ping|status)\b/i;
/** An existing Express error-handling middleware (4-arg (err, req, res, next) callback, or app.use(errorHandler)). */
const ERROR_HANDLER =
  /\(\s*err(?:or)?\s*(?::[^,)]+)?\s*,\s*\w+\s*(?::[^,)]+)?\s*,\s*\w+\s*(?::[^,)]+)?\s*,\s*\w+\s*(?::[^,)]+)?\s*\)\s*=>|\.use\s*\(\s*\w*[eE]rror\w*\s*\)/;
/**
 * An existing request logger — a known logging library (morgan / pino-http / express-winston / express-pino),
 * a `.use(...)` of a logger-named middleware, or a hand-rolled middleware that logs on the response's `finish`
 * event. If any is present we never inject a duplicate.
 */
const REQUEST_LOGGER =
  /\b(?:morgan|pino-http|express-pino-logger|express-winston)\b|\.use\s*\(\s*(?:morgan|pino|logger|requestLogger|reqLogger|httpLogger)\b|res\.on\s*\(\s*['"`]finish['"`]/;
/**
 * An Express app declaration: `const app = express()` / `let api = express();` /
 * `const app = require('express')()`. Captures the app variable name so the injected code uses it.
 */
const EXPRESS_APP_DECL =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:express\s*\(\s*\)|require\(\s*['"`]express['"`]\s*\)\s*\(\s*\))/;

export interface HealthInjectionResult {
  /** The file that was edited. */
  path: string;
  /** The full new content of that file, with the code added before the listen call. */
  newContent: string;
  /** The Express app variable the code was registered on (for an honest report line). */
  appVar: string;
}

/** The single unambiguous Express server entry, plus the line index of its `.listen(` call and app decl. */
interface ExpressEntry {
  path: string;
  content: string;
  appVar: string;
  lines: string[];
  listenIdx: number;
  indent: string;
  /** Line index of the `const app = express()` declaration (for middleware that must precede routes). */
  appDeclIdx: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Locate the ONE unambiguous Express entry: exactly one backend file declares an Express app, and that app
 * is `.listen(`-ed in the same file. Returns null on any ambiguity (no app, multiple apps, or listen missing/
 * in another file) so a caller never guesses.
 */
function findExpressEntry(files: Record<string, string>): ExpressEntry | null {
  const candidates: Array<{ path: string; content: string; appVar: string }> = [];
  for (const [path, content] of Object.entries(files)) {
    if (!BACKEND_EXT.test(path) || SKIP_PATH.test(path)) continue;
    if (typeof content !== 'string' || !content) continue;
    const m = EXPRESS_APP_DECL.exec(content);
    if (m) candidates.push({ path, content, appVar: m[1] });
  }
  if (candidates.length !== 1) return null; // zero or many → do not guess.

  const { path, content, appVar } = candidates[0];
  const lines = content.split('\n');
  // Matches both `app.listen(` and `const server = app.listen(` (the line contains `app.listen(` either way).
  const listenRe = new RegExp(`\\b${escapeRegExp(appVar)}\\s*\\.\\s*listen\\s*\\(`);
  const listenIdx = lines.findIndex((l) => listenRe.test(l));
  if (listenIdx < 0) return null;
  const appDeclIdx = lines.findIndex((l) => EXPRESS_APP_DECL.test(l));
  if (appDeclIdx < 0) return null;
  const indent = (lines[listenIdx].match(/^\s*/)?.[0]) ?? '';
  return { path, content, appVar, lines, listenIdx, indent, appDeclIdx };
}

/** Build the result of inserting one line immediately before the entry's `.listen(` line. */
function insertBeforeListen(entry: ExpressEntry, code: string): HealthInjectionResult {
  const newLines = [...entry.lines.slice(0, entry.listenIdx), code, ...entry.lines.slice(entry.listenIdx)];
  return { path: entry.path, newContent: newLines.join('\n'), appVar: entry.appVar };
}

/** Build the result of inserting one line immediately AFTER the entry's app-declaration line. */
function insertAfterAppDecl(entry: ExpressEntry, code: string): HealthInjectionResult {
  const at = entry.appDeclIdx + 1;
  const newLines = [...entry.lines.slice(0, at), code, ...entry.lines.slice(at)];
  return { path: entry.path, newContent: newLines.join('\n'), appVar: entry.appVar };
}

/**
 * Deterministically inject a `/health` route into an Express server entry that lacks one. Returns null when
 * it cannot inject with high confidence (no single Express entry, a health route already present, or the app
 * is not `.listen(`-ed in the same file). The route is registered on the real app variable immediately before
 * the `.listen(` call, preserving that line's indentation.
 */
export function injectHealthEndpoint(files: Record<string, string>): HealthInjectionResult | null {
  const entry = findExpressEntry(files);
  if (!entry) return null;
  if (HEALTH_ROUTE.test(entry.content)) return null; // already observable
  const route = `${entry.indent}${entry.appVar}.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));`;
  return insertBeforeListen(entry, route);
}

/**
 * Deterministically inject a 4-arg error-handling middleware into an Express server entry that lacks one.
 * Returns null when it cannot inject with high confidence (no single Express entry, an error handler already
 * present, or the app is not `.listen(`-ed in the same file). Placed immediately before `.listen(`, i.e. AFTER
 * every route — which is exactly where Express requires the error handler to sit.
 */
export function injectErrorHandler(files: Record<string, string>): HealthInjectionResult | null {
  const entry = findExpressEntry(files);
  if (!entry) return null;
  if (ERROR_HANDLER.test(entry.content)) return null; // already handled
  const handler =
    `${entry.indent}${entry.appVar}.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Internal Server Error' }); });`;
  return insertBeforeListen(entry, handler);
}

/**
 * Deterministically inject a DEPENDENCY-FREE request logger into an Express server entry that lacks one.
 * Returns null when it cannot inject with high confidence (no single Express entry, a logger already present,
 * or the app is not `.listen(`-ed in the same file). The middleware is registered immediately AFTER the app
 * declaration — before any route — because Express middleware only runs for routes registered after it. It
 * logs method/url/status/duration on the response's `finish` event via console; it never logs headers or the
 * body, so request secrets never leak.
 */
export function injectRequestLogger(files: Record<string, string>): HealthInjectionResult | null {
  const entry = findExpressEntry(files);
  if (!entry) return null;
  if (REQUEST_LOGGER.test(entry.content)) return null; // already logging
  const declIndent = (entry.lines[entry.appDeclIdx].match(/^\s*/)?.[0]) ?? '';
  const logger =
    `${declIndent}${entry.appVar}.use((req, res, next) => { const startedAt = Date.now(); ` +
    `res.on('finish', () => console.log(\`\${req.method} \${req.originalUrl || req.url} \${res.statusCode} \${Date.now() - startedAt}ms\`)); next(); });`;
  return insertAfterAppDecl(entry, logger);
}

export interface ObservabilityInjectionResult {
  /** The file that was edited. */
  path: string;
  /** The full new content of that file, with all applicable fixes added before the listen call. */
  newContent: string;
  /** The Express app variable the code was registered on. */
  appVar: string;
  /** Which fixes were added, in application order. */
  added: Array<'request-logger' | 'health' | 'error-handler'>;
}

/**
 * Apply every safe, dependency-free observability injection to the one unambiguous Express entry, in a single
 * pass: the request logger first (it must precede routes, so it is inserted right after the app declaration),
 * then the `/health` route, then the error handler (both before `.listen(`). Each stage is recomputed against
 * the previous stage's content so the line indices stay correct as code is inserted. Returns null when there
 * is no Express entry or nothing to add (all already present).
 */
export function injectObservabilityFixes(files: Record<string, string>): ObservabilityInjectionResult | null {
  const entry = findExpressEntry(files);
  if (!entry) return null;

  let current = entry.content;
  const added: Array<'request-logger' | 'health' | 'error-handler'> = [];

  const logger = injectRequestLogger({ [entry.path]: current });
  if (logger) {
    current = logger.newContent;
    added.push('request-logger');
  }
  const health = injectHealthEndpoint({ [entry.path]: current });
  if (health) {
    current = health.newContent;
    added.push('health');
  }
  const errorHandler = injectErrorHandler({ [entry.path]: current });
  if (errorHandler) {
    current = errorHandler.newContent;
    added.push('error-handler');
  }

  if (added.length === 0) return null;
  return { path: entry.path, newContent: current, appVar: entry.appVar, added };
}
