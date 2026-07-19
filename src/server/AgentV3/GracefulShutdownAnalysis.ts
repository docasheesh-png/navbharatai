// AgentV3 — Graceful-shutdown analysis (additive evaluate dimension).
//
// A real, deterministic PROJECT-LEVEL scan over the backend the agent actually wrote, for the one defect
// that silently drops user requests on every redeploy: a long-lived Node HTTP server that binds a port but
// never handles SIGTERM/SIGINT to close its server (and drain in-flight requests) before the process exits.
//
// Why this matters for a shipped app: every modern host — Cloud Run (this very platform), Kubernetes, ECS,
// Fly, Render, Heroku — stops a container by sending SIGTERM and then hard-killing it after a grace window.
// A server with no SIGTERM handler is torn down mid-request on EVERY deploy/scale-down: open HTTP requests
// error out, in-flight DB writes can be abandoned, and websockets are cut. A `server.close()` (or an
// equivalent library / framework hook) inside a SIGTERM handler lets the process stop accepting new
// connections and finish the ones in flight — zero dropped requests on redeploy.
//
// Read-only and conservative (high precision): a finding is only raised when a genuine long-lived HTTP
// server is present (an `app.listen(port)` / `http.createServer(...).listen(...)` style bind). Serverless
// function handlers (Vercel/Netlify/Lambda export a handler — the platform owns the lifecycle) and
// framework-managed servers (Next.js `next start`, Nest with `enableShutdownHooks()`, Fastify's built-in
// `close`/`onClose`) are NOT flagged. No server ⇒ zero findings (a static SPA is correctly clean). The
// `evaluate` tool surfaces the summary so the agent can add the handler — never a synthetic "looks fine".

export type ShutdownSeverity = 'high' | 'medium' | 'low';

export interface ShutdownIssue {
  file: string;
  kind: 'missing-graceful-shutdown';
  severity: ShutdownSeverity;
  detail: string;
}

/** Server-side source we scan. Front-end markup and configs carry no process-lifecycle semantics. */
const BACKEND_EXT = /\.(ts|js|mjs|cjs)$/i;
/** Paths we never scan — generated, vendored, test, or clearly front-end-only trees. */
const SKIP_PATH =
  /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git|public|assets)([\\/]|$)|\.d\.ts$|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)/i;

/**
 * A genuine long-lived HTTP server bind. We require a `.listen(` that takes a real port (a number or
 * `process.env.PORT`) — that is the process that must survive a SIGTERM. A framework's own dev server or a
 * serverless handler export never matches this.
 */
const SERVER_LISTEN = /\.listen\s*\(\s*(?:process\.env\.PORT|process\.env\.\w*PORT\w*|\d|\{[^}]*port)/i;
/** Node's raw http/https/http2 server creation — the low-level server object that owns `.close()`. */
const RAW_HTTP_SERVER = /\b(?:http2?|https)\.createServer\s*\(|\bnet\.createServer\s*\(/;

/** A SIGTERM/SIGINT signal handler — the entry point of any graceful shutdown. */
const SIGNAL_HANDLER =
  /process\.(?:on|once)\s*\(\s*['"`]SIG(?:TERM|INT)['"`]|process\.(?:on|once)\s*\(\s*['"`]beforeExit['"`]/;
/** An explicit server drain — closing the HTTP server so in-flight requests finish. */
const SERVER_CLOSE = /\bserver\s*\.\s*close\s*\(|\bhttpServer\s*\.\s*close\s*\(|\.\s*close\s*\(\s*\)\s*;?\s*(?:\/\/|$)/;
/**
 * A library or framework hook that manages graceful shutdown for us — any one is proof the app handles it.
 * (http-terminator / stoppable / lightship / terminus / @godaddy/terminus / Nest shutdown hooks / Fastify
 * onClose+close / graceful-shutdown packages.)
 */
const SHUTDOWN_LIBRARY =
  /http-terminator|createHttpTerminator|\bstoppable\b|\blightship\b|@godaddy\/terminus|@nestjs\/.*|enableShutdownHooks\s*\(|onApplicationShutdown|\.addHook\s*\(\s*['"`]onClose|@fastify\/|createTerminus|graceful-shutdown|http-graceful-shutdown|@moebius\/http-graceful-shutdown/i;
/**
 * Serverless / framework-managed entrypoints whose lifecycle we do NOT own — flagging them would be a false
 * positive. A file that only exports a handler (no `.listen`) is already excluded by SERVER_LISTEN, but a
 * Next.js custom server or an explicit serverless adapter can also `.listen` in dev; treat these as managed.
 */
const MANAGED_RUNTIME =
  /\bnext\s*\(\s*\{|from\s+['"`]next['"`]|exports\.handler\s*=|export\s+const\s+handler|serverless-http|aws-lambda|@vercel\/node|@netlify\/functions/i;

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
 * Scan a whole project's files for a long-lived HTTP server that lacks graceful-shutdown handling.
 * Aggregated at the project level: the server-entry file(s) are located, then graceful-shutdown evidence
 * (a SIGTERM handler with a close, or a shutdown library, or a framework hook) is checked across ALL backend
 * files. Returns [] when there is no long-lived server, or when the runtime is serverless/framework-managed.
 */
export function scanGracefulShutdown(files: Record<string, string>): ShutdownIssue[] {
  const backend = scannableBackendFiles(files);
  if (backend.length === 0) return [];

  const serverFiles = backend.filter((f) => SERVER_LISTEN.test(f.content) || RAW_HTTP_SERVER.test(f.content));
  if (serverFiles.length === 0) return []; // no long-lived HTTP server → nothing to shut down gracefully.

  const allText = backend.map((f) => f.content).join('\n');

  // Serverless / framework-managed runtime → the platform owns process lifecycle; do not false-flag.
  if (MANAGED_RUNTIME.test(allText)) return [];

  // Graceful shutdown is present if EITHER a shutdown library/framework hook is used, OR a signal handler
  // coexists with an explicit server close (the hand-rolled pattern).
  const hasLibrary = SHUTDOWN_LIBRARY.test(allText);
  const hasHandRolled = SIGNAL_HANDLER.test(allText) && SERVER_CLOSE.test(allText);
  if (hasLibrary || hasHandRolled) return [];

  const entry = serverFiles[0].path;
  return [
    {
      file: entry,
      kind: 'missing-graceful-shutdown',
      severity: 'medium',
      detail:
        'HTTP server binds a port but never handles SIGTERM/SIGINT to close it — on a redeploy/scale-down (Cloud Run, k8s, …) the container is killed mid-request, dropping in-flight requests. Add a `process.on("SIGTERM", () => server.close(...))` handler (or a library like http-terminator / stoppable).',
    },
  ];
}

/** A concise, honest graceful-shutdown report for the agent. */
export function gracefulShutdownSummary(issues: ShutdownIssue[]): string {
  if (issues.length === 0) return 'Graceful-shutdown scan: ✓ No graceful-shutdown gaps detected.';
  const body = issues.map((x) => `  - [${x.severity}] ${x.file} — ${x.kind}: ${x.detail}`);
  return [`Graceful-shutdown scan: ${issues.length} gap(s) — ${issues.length} medium.`, ...body].join('\n');
}
