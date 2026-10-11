// IS THERE A SERVER HERE THAT NO FRAMEWORK LIST WOULD EVER NAME? (Q-707.)
//
// Every server detector in this codebase recognised a server by its FRAMEWORK — `express`, `fastify`,
// `koa`, NestJS, Hapi, Apollo. An app whose server is plain `node:http` matches none of them, so it
// was not a server to any of them. That is not a cosmetic gap; it has two different silent harms:
//
//   • `deployPlan.ts` → `shape: 'unknown'` → `staticHostingSufficient: true` → the app is published
//     as a STATIC SITE. Its API never runs, and the user is told the publish succeeded. (Q-707's own
//     proof: the real `planDeployment()` on the hosting probe returned exactly that.)
//   • `BackendPresence.ts` → `hasBackend: false` → the in-browser preview shows a frontend whose API
//     calls all fail, WITHOUT the honest "this app needs a live server" banner that exists precisely
//     for this case. Its endpoint fallback cannot help: `extractEndpoints` matches `app.get('/x')`
//     and decorators, and a bare http server routes on `req.url` instead.
//
// So the fix is ONE detector both of them call, not a second framework list in each — the class rule
// (four drifted copies of `safeRelPath` is why that rule exists).
//
// 🔒 THE PRECISION THAT MATTERS: A CLIENT ALSO IMPORTS `http`. `http.get(...)` / `https.request(...)`
// in a frontend or a script is an ordinary HTTP CLIENT, and calling that a server would REFUSE a
// working static publish — the 2026-08-25 harm (a dev dependency read as a server) in a new costume.
// So the import alone is never enough: the file must also CREATE a server. `createServer(` is the
// precise signal, because no client ever calls it, and it is required rather than merely corroborated.
//
// PURE: files in, an answer out. No I/O.

/** Node's own server-capable modules, with and without the `node:` prefix. */
const CORE_HTTP_MODULES = ['http', 'node:http', 'https', 'node:https', 'http2', 'node:http2'];

const CODE_FILE = /\.(js|jsx|ts|tsx|mjs|cjs)$/i;

/** `createServer(` and http2/tls's `createSecureServer(` — the calls only a server makes. */
const SERVER_FACTORY = /\bcreate(?:Secure)?Server\s*\(/;

/** `import … from 'http'` / `import 'node:http'` / `require('https')`, for one exact module name. */
function importsModule(content: string, mod: string): boolean {
  const escaped = mod.replace(/[/@.:-]/g, '\\$&');
  return new RegExp(`(^|\\n)\\s*import[^\\n]*['"\`]${escaped}['"\`]`).test(content)
    || new RegExp(`require\\(\\s*['"\`]${escaped}['"\`]\\s*\\)`).test(content);
}

export interface CoreHttpServerHit {
  /** The file that creates the server — named so a message can point at it. */
  path: string;
  /** The core module it came from, e.g. `node:http`. */
  module: string;
}

/**
 * Does the app's OWN source create a Node core HTTP server?
 *
 * Returns the first file that both imports a core HTTP module AND calls `createServer(`. Both
 * conditions are required: the import alone is what an HTTP client does too.
 */
export function findCoreHttpServer(files: Record<string, string>): CoreHttpServerHit | null {
  if (!files || typeof files !== 'object') return null;
  for (const [path, content] of Object.entries(files)) {
    if (!CODE_FILE.test(path) || typeof content !== 'string') continue;
    // The server signal — no client ever calls it. `createSecureServer` is http2's/tls's spelling and
    // is NOT a substring of `createServer`, which this module's own census caught on its first run.
    if (!SERVER_FACTORY.test(content)) continue;
    const mod = CORE_HTTP_MODULES.find((m) => importsModule(content, m));
    if (mod) return { path, module: mod };
  }
  return null;
}

/** True when the app's own source creates a Node core HTTP server. */
export function createsCoreHttpServer(files: Record<string, string>): boolean {
  return findCoreHttpServer(files) !== null;
}
