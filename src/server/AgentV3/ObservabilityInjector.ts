// AgentV3 — Observability auto-injection (Cap-4, injection half).
//
// The advisory half (ObservabilityAnalysis, #1548) flags a backend missing a /health route. This is the
// deterministic INJECTION half for the single highest-value, dependency-free, safe-to-add gap: a `/health`
// route on an Express server that lacks one. A health route needs no new dependency and is purely additive,
// so it can be injected precisely and safely — unlike a request logger (needs a dep) or an error handler
// (placement-sensitive), which stay advisory-only for now.
//
// This module is PURE and deterministic (no I/O): given the project files it returns the single edited file,
// or null when it cannot inject with high confidence. Conservative by construction — it only acts on the
// clear, common case (an Express app declared AND `.listen(`-ed in the same file, with no health route yet)
// and returns null on anything ambiguous, so it can never produce broken or misplaced code. The caller
// (ToolDispatcher) writes the result through the durable write path and only when the gate is enabled.

/** Server-side source we consider. */
const BACKEND_EXT = /\.(ts|js|mjs|cjs)$/i;
/** Paths we never touch — generated, vendored, or test trees. */
const SKIP_PATH =
  /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git|public|assets)([\\/]|$)|\.d\.ts$|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)/i;

/** An existing health route anywhere in the file — if present we never inject a duplicate. */
const HEALTH_ROUTE = /['"`]\/(?:health(?:z|check)?|_health|ready|livez|readyz|ping|status)\b/i;
/**
 * An Express app declaration: `const app = express()` / `let api = express();` /
 * `const app = require('express')()`. Captures the app variable name so the injected route uses it.
 */
const EXPRESS_APP_DECL =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:express\s*\(\s*\)|require\(\s*['"`]express['"`]\s*\)\s*\(\s*\))/;

export interface HealthInjectionResult {
  /** The file that was edited. */
  path: string;
  /** The full new content of that file, with the /health route added before the listen call. */
  newContent: string;
  /** The Express app variable the route was registered on (for an honest report line). */
  appVar: string;
}

/**
 * Deterministically inject a `/health` route into an Express server entry that lacks one. Returns null when
 * it cannot inject with high confidence:
 *   - no Express app declared in any single backend file, or
 *   - that file already has a health route, or
 *   - the app is never `.listen(`-ed in the SAME file (placement would be ambiguous), or
 *   - more than one backend file declares an Express app (ambiguous which is the entry).
 * The injected line is registered on the real app variable and placed immediately before the `.listen(` call,
 * preserving that line's indentation.
 */
export function injectHealthEndpoint(files: Record<string, string>): HealthInjectionResult | null {
  // Find every backend file that declares an Express app.
  const candidates: Array<{ path: string; content: string; appVar: string }> = [];
  for (const [path, content] of Object.entries(files)) {
    if (!BACKEND_EXT.test(path) || SKIP_PATH.test(path)) continue;
    if (typeof content !== 'string' || !content) continue;
    const m = EXPRESS_APP_DECL.exec(content);
    if (m) candidates.push({ path, content, appVar: m[1] });
  }

  // Exactly one Express entry → unambiguous. Zero or many → do not guess.
  if (candidates.length !== 1) return null;
  const { path, content, appVar } = candidates[0];

  // Already observable → nothing to inject.
  if (HEALTH_ROUTE.test(content)) return null;

  // The route must be registered before the server starts listening, in this same file. Matches both
  // `app.listen(` and `const server = app.listen(` (the line contains `app.listen(` either way).
  const lines = content.split('\n');
  const listenRe = new RegExp(`\\b${escapeRegExp(appVar)}\\s*\\.\\s*listen\\s*\\(`);
  const listenIdx = lines.findIndex((l) => listenRe.test(l));
  if (listenIdx < 0) return null;

  const indent = (lines[listenIdx].match(/^\s*/)?.[0]) ?? '';
  const route = `${indent}${appVar}.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));`;
  const newLines = [...lines.slice(0, listenIdx), route, ...lines.slice(listenIdx)];
  return { path, newContent: newLines.join('\n'), appVar };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
