// WHICH PORT DOES THIS APP ACTUALLY RUN ON? — one answer, from every place an app can say it.
//
// 🔴 THE REPORT (admin 2026-09-04): *"jab github se koi repo import karta hai, to kis port par run
// karna hai yeh confuse ho jata hai."*
//
// ROOT CAUSE — not a missing check, but a SCATTERED one. Three separate readers already existed, each
// looking at a different narrow slice, and each caller picked its own subset:
//
//   • `devScriptPort`      — package.json scripts only (`--port`, `-p`, `PORT=` inside the script)
//   • `serverPortFromFiles`— a fixed list of server entry paths (server.js, app.js, index.js, src/*)
//   • `clientVitePort`     — vite.config `server.port`, but MODULE-PRIVATE, so the preview path that
//                            most needed it could not call it at all
//
// An app WE scaffold declares its port in a script, so the narrow readers were enough and the gap
// never showed. An IMPORTED repo is the opposite: it overwhelmingly declares its port in
// `vite.config.*`, in a `.env`, or in a server entry outside that fixed list — none of which the
// preview path consulted. So discovery fell through to the framework guess, waited on the wrong port,
// and reported "no service running" about an app that was running perfectly. That is the confusion.
//
// THE FIX IS THE CLASS, NOT THE INSTANCE: one resolver that reads EVERY declaration site, with a
// documented precedence, so a fourth caller cannot invent a fourth subset. Same pattern this codebase
// already used for `safeRelPath` (4 drifted copies → one shared module) and retired model ids.
//
// PURE — no I/O, no framework. The caller supplies the files it already loaded.

import { serverListenPort } from './fullstackBootHint';

/** Where the answer came from. Carried so a diagnostic can say WHY, not just WHAT. */
export type PortSource = 'script' | 'vite-config' | 'env-file' | 'server-entry';

export interface DeclaredPort {
  port: number;
  source: PortSource;
  /** The file (or `package.json` script) the number was read from — for honest reporting. */
  evidence: string;
}

const valid = (n: number): boolean => Number.isInteger(n) && n > 0 && n < 65_536;

/** Ports that belong to infrastructure, never to the app being previewed. */
const INFRA = new Set([22, 53, 5432, 3306, 27017, 6379, 9229]);

/**
 * A port explicitly passed on the dev/start/serve command line.
 *
 * STRONGEST evidence by design: a flag is a deliberate override of whatever any config or code
 * defaults to, so it must beat both. Mirrors `devScriptPort`'s pattern — kept here too so this
 * resolver is complete on its own and a caller never has to remember to combine two functions.
 */
export function portFromPackageScripts(packageJsonRaw: string | null | undefined): DeclaredPort | null {
  if (!packageJsonRaw) return null;
  let scripts: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(String(packageJsonRaw)) as { scripts?: Record<string, unknown> };
    if (pkg && typeof pkg.scripts === 'object' && pkg.scripts) scripts = pkg.scripts;
  } catch {
    return null;
  }
  for (const name of ['dev', 'start', 'serve']) {
    const script = scripts[name];
    if (typeof script !== 'string' || !script.trim()) continue;
    const m = script.match(/(?:--port[=\s]+|(?:^|\s)-p\s+|(?:^|\s)PORT=)(\d{2,5})/);
    if (!m) continue;
    const n = Number(m[1]);
    if (valid(n)) return { port: n, source: 'script', evidence: `package.json → scripts.${name}` };
  }
  return null;
}

/**
 * A bundler/dev-server config's declared port.
 *
 * Covers Vite (and everything built on it — SvelteKit, Nuxt 3, Astro, Qwik, modern Vue/React
 * templates), which is the single most common way an imported frontend repo pins its port. `webpack`
 * dev-server and Angular are included because they are the other two an imported repo realistically
 * uses, and the same `port:` shape reads correctly for both.
 */
export function portFromDevServerConfig(files: Record<string, string>): DeclaredPort | null {
  const isConfig = (p: string): boolean =>
    /(?:^|\/)vite\.config\.[cm]?[jt]s$/i.test(p)
    || /(?:^|\/)webpack\.config\.[cm]?[jt]s$/i.test(p)
    || /(?:^|\/)angular\.json$/i.test(p);
  for (const [path, src] of Object.entries(files ?? {})) {
    if (typeof src !== 'string' || !src || !isConfig(path)) continue;
    // `server: { … port: N }` (Vite), `devServer: { … port: N }` (webpack), `"port": N` (angular.json).
    // Bounded to the block it opens so an unrelated `port` elsewhere in a large config is not read.
    const m = /(?:server|devServer|options)\s*[:=]\s*\{[\s\S]{0,400}?\bport\s*[:=]\s*(\d{2,5})/.exec(src)
      ?? /"port"\s*:\s*(\d{2,5})/.exec(src);
    if (!m) continue;
    const n = Number(m[1]);
    if (valid(n)) return { port: n, source: 'vite-config', evidence: path };
  }
  return null;
}

/**
 * A `PORT` (or `VITE_PORT`) pinned in the project's own `.env`.
 *
 * 🔒 THE ONE AN IMPORTED EXPRESS REPO ALMOST ALWAYS USES, and the one nothing read. Its code says
 * `app.listen(process.env.PORT)` — with NO literal fallback, so `serverListenPort` finds nothing —
 * and the actual number lives in `.env`. Before this, that app booted on 8080 while the preview waited
 * on 3000 and then told the user their app was not running.
 *
 * A commented-out line is not a declaration and is ignored.
 */
export function portFromEnvFiles(files: Record<string, string>): DeclaredPort | null {
  // Most specific first: a `.env.development` beats a generic `.env` for a dev server.
  const order = ['.env.development.local', '.env.development', '.env.local', '.env'];
  const entries = Object.entries(files ?? {});
  for (const wanted of order) {
    for (const [path, src] of entries) {
      if (typeof src !== 'string' || !src) continue;
      const base = path.split('/').pop() ?? '';
      if (base !== wanted) continue;
      for (const line of src.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const m = /^(?:export\s+)?(?:VITE_)?PORT\s*=\s*"?'?(\d{2,5})"?'?\s*$/.exec(trimmed);
        if (!m) continue;
        const n = Number(m[1]);
        if (valid(n)) return { port: n, source: 'env-file', evidence: path };
      }
    }
  }
  return null;
}

/**
 * A port bound in the app's own server code.
 *
 * WIDER than the old fixed candidate list, which missed exactly the layouts an imported repo uses
 * (`backend/server.js`, `api/index.js`, `src/main.ts`). Ordered so a genuine SERVER entry is read
 * before a generic `index` — a project with both almost always means `server.js` is the API and
 * `index.js` is the frontend entry, and reading the frontend's port here is the original failure in a
 * new costume.
 */
export function portFromServerEntry(files: Record<string, string>): DeclaredPort | null {
  const paths = Object.keys(files ?? {}).filter((p) => /\.[cm]?[jt]s$/i.test(p) && !/node_modules|\.test\.|\.spec\./i.test(p));
  const rank = (p: string): number => {
    const base = (p.split('/').pop() ?? '').replace(/\.[cm]?[jt]s$/i, '');
    const depth = p.split('/').length;
    if (base === 'server') return 0 + depth * 0.01;
    if (base === 'app') return 1 + depth * 0.01;
    if (base === 'main') return 2 + depth * 0.01;
    if (base === 'index') return 3 + depth * 0.01;
    return 9;
  };
  for (const path of paths.filter((p) => rank(p) < 9).sort((a, b) => rank(a) - rank(b))) {
    const src = files[path];
    if (typeof src !== 'string' || !src) continue;
    const n = serverListenPort(src);
    if (n !== null && valid(n)) return { port: n, source: 'server-entry', evidence: path };
  }
  return null;
}

/**
 * THE app's declared port, from whichever place actually declares one.
 *
 * PRECEDENCE, strongest first — each step is a deliberate statement by the app, and a later step may
 * only fill a silence, never overrule a stronger one:
 *   1. an explicit `--port` on the dev/start script (a deliberate override of everything below)
 *   2. the dev-server config (`vite.config` and friends) — how a frontend repo pins its port
 *   3. a `.env` `PORT=` — how a backend repo pins its port
 *   4. a literal port in the server's own `listen(…)`
 *
 * Returns null when the app declares nothing anywhere — and null MUST stay a real answer: the caller
 * then keeps its existing evidence-first discovery (the listening-port sweep), which is strictly
 * better than any guess this function could invent. An infrastructure port (a database) is never
 * returned as the app's.
 */
export function declaredAppPort(
  files: Record<string, string>,
  packageJsonRaw?: string | null,
): DeclaredPort | null {
  const pkg = packageJsonRaw ?? files?.['package.json'] ?? null;
  const found = portFromPackageScripts(pkg)
    ?? portFromDevServerConfig(files)
    ?? portFromEnvFiles(files)
    ?? portFromServerEntry(files);
  if (!found || INFRA.has(found.port)) return null;
  return found;
}
