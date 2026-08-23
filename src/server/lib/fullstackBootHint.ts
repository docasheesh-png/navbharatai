// FULLSTACK BOOT HINT — tell the builder, up front and deterministically, HOW to boot a full-stack
// (client + Express/Node server) app and WHICH port to preview, so it stops hand-probing ports.
//
// THE BUG THIS PREVENTS (admin report, the 2026-08-15 35.8-minute / 17m47s builds). A full-stack app
// (a Vite/React client + an Express server, e.g. the "rest-express" Replit-style layout) is misread as
// a plain `vite-react` scaffold. The server comes up correctly on its own port (mitrify: 5000), but the
// builder — told by the framework hint that the port is 5173 — spends its last ten minutes trying to
// MOVE the working server onto 5173, or hand-probes ports with `tsx server/index.ts & sleep 8; curl …`
// loops. All of the platform's deterministic port machinery (pin, drift re-probe, sweep, watchdog) is
// downstream compensation that only runs AFTER the model has already flailed.
//
// THE FIX IS UPSTREAM (prevention, the 50/50 law). Before the build touches the preview, hand it the
// two facts it was left to guess: (1) this is ONE `npm run dev` that boots everything — do not start the
// server by hand or hand-probe ports; (2) exactly which service's port is the preview — the SERVER's
// port for a single-port app (the server serves the client), the CLIENT's port for a two-port app (the
// Vite dev server renders the UI and proxies /api). Naming the SERVICE, not just a number, is what kills
// the "move the server to 5173" failure: for a single-port app the preview IS the server's port.
//
// Deterministic + best-effort. Returns a short instruction to prepend to the build prompt, or null when
// the app is not clearly full-stack (a plain client or a plain API is already covered by the framework
// hint — emitting anything there would be false noise). Never throws.

import { resolveDevRunCommand, devScriptPort } from '../AgentV3/sandbox/EngineerAI/actuators/DevServerRecovery';

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const IGNORE = /^(node_modules|\.git|dist|build|out|coverage|\.next|\.turbo|\.vercel)\//;

/** An Express app is created here AND it actually listens — i.e. this file is a server, not a router. */
const EXPRESS_RE = /\b(?:express\s*\(\s*\)|require\s*\(\s*['"]express['"]\s*\))/;
const LISTEN_RE = /\.listen\s*\(/;

/**
 * The server serves the client itself (single-port): the "rest-express" Vite-middleware bridge
 * (`setupVite`/`serveStatic`/`vite.middlewares`) OR a plain `express.static(...)`. Same signal
 * SpaFallbackAnalysis uses to know the client is already served.
 */
const SERVES_CLIENT_RE = /\b(?:setupVite|serveStatic|createViteServer)\b|vite\.middlewares|middlewareMode|express\.static\s*\(/;

/** The dev script boots more than one process together — the two-port shape. */
const CONCURRENT_RE = /\b(?:concurrently|npm-run-all|run-p|run-s)\b|&\s*(?:npm|node|tsx|vite)\b/;
/** A client bundler invoked inside a script. */
const CLIENT_BUNDLER_IN_SCRIPT = /\bvite\b|\bnext\b/;
/** A node server runner invoked inside a script. */
const SERVER_RUNNER_IN_SCRIPT = /\b(?:tsx|ts-node|nodemon|node)\b/;

export interface FullstackBootFinding {
  mode: 'single-port' | 'two-port';
  devCommand: string;
  /** The port to call update_preview with — the SERVER's port (single) or the CLIENT's port (two). */
  previewPort: number;
  serverPort: number;
  clientPort?: number;
  serverFile: string;
}

/** Read a server's listen port from its source — the shapes people actually write. Null if none found. */
/**
 * The port a server's own CODE binds — the truth when the start script does not name one.
 *
 * 🔒 EXPORTED 2026-08-23 because it was private here while the PREVIEW path needed it and had no
 * equivalent. That path asked only `devScriptPort` (which reads `--port N` from the start script) and
 * fell back to a framework guess of 3000. An Express app's script is just `node server.js` — its port
 * lives in the code, as `app.listen(process.env.PORT || 5000)` — so the guess said 3000, the app bound
 * 5000, and the user got "Closed Port Error: no service running on port 3000" for an app that was
 * running perfectly. Same class as the 2026-07-04 `--port 5173` incident, in the one place that fix
 * did not reach. One implementation, both call sites.
 */
export function serverListenPort(src: string): number | null {
  for (const re of [
    /process\.env\.PORT\s*\)?\s*\|\|\s*(\d{2,5})/, // process.env.PORT || 5000  /  Number(process.env.PORT) || 5000
    /\bPORT\s*[:=]\s*(\d{2,5})/,                    // const PORT = 5000  /  PORT: 5000
    /\.listen\s*\(\s*(\d{2,5})/,                    // app.listen(5000, …)
  ]) {
    const m = re.exec(src);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0 && n < 65_536) return n;
    }
  }
  return null;
}

/**
 * Where a Node server's entry file usually lives, most specific first.
 *
 * 🔒 ORDER IS DELIBERATE. `server.*` is checked before `index.*` because a project containing both
 * almost always means `server.js` is the API and `index.js` is the frontend entry — reading the
 * frontend's port and waiting on it is the exact failure this is fixing, in a new costume.
 */
const SERVER_ENTRY_CANDIDATES = [
  'server.js', 'server.ts', 'server.mjs',
  'src/server.js', 'src/server.ts',
  'app.js', 'app.ts', 'src/app.js', 'src/app.ts',
  'index.js', 'index.ts', 'src/index.js', 'src/index.ts',
];

/**
 * The port this project's server binds, read from whichever entry file actually declares one.
 *
 * Returns null when no candidate declares a port — the caller then keeps its own fallback, so this can
 * only ever ADD knowledge, never replace a better answer with a worse one.
 */
export function serverPortFromFiles(files: Record<string, string>): number | null {
  if (!files || typeof files !== 'object') return null;
  for (const path of SERVER_ENTRY_CANDIDATES) {
    const src = files[path];
    if (typeof src !== 'string' || !src) continue;
    const port = serverListenPort(src);
    if (port !== null) return port;
  }
  return null;
}

/** A Vite client's port from its config (`server.port`) or a `--port` flag. Null if not declared. */
function clientVitePort(files: Array<[string, string]>): number | null {
  for (const [p, src] of files) {
    if (!/vite\.config\.[cm]?[jt]s$/i.test(p)) continue;
    const m = /server\s*:\s*\{[^}]*?\bport\s*:\s*(\d{2,5})/s.exec(src);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0 && n < 65_536) return n;
    }
  }
  return null;
}

/**
 * The subset of workspace paths worth reading to classify the boot shape: package.json, any Vite config,
 * and the likely server entry files. Keeps the route's file reads to a handful. PURE.
 */
export function fullstackBootProbeFiles(paths: readonly string[]): string[] {
  if (!Array.isArray(paths)) return [];
  const out: string[] = [];
  for (const p of paths) {
    if (typeof p !== 'string' || IGNORE.test(p)) continue;
    const base = p.split('/').pop() ?? '';
    if (base === 'package.json') out.push(p);
    else if (/^vite\.config\.[cm]?[jt]s$/i.test(base)) out.push(p);
    // Server entries: server/index.ts, server/app.js, src/server/*, backend/*, or a ROOT index/server file.
    // A server is `.ts/.js/.mjs/.cjs` (never `.tsx`), and a root server file has no directory prefix — so
    // a React `client/src/App.tsx` (dir prefix + .tsx) is correctly excluded.
    else if (/(?:^|\/)(?:server|backend)\/(?:index|app|main|server)\.[cm]?[jt]s$/i.test(p)
          || /^(?:index|server|app|main)\.[cm]?[jt]s$/i.test(p)) out.push(p);
  }
  // Cap: a handful is plenty; never read a whole tree here.
  return out.slice(0, 10);
}

/**
 * Classify a full-stack app's boot shape from a small map of file contents (as produced by reading the
 * paths that `fullstackBootProbeFiles` selected). Returns null unless the app is confidently full-stack
 * AND the shape can be classified — no guessing, no false noise. PURE.
 */
export function analyzeFullstackBoot(files: Record<string, string>): FullstackBootFinding | null {
  const entries = Object.entries(files ?? {}).filter(
    ([p, c]) => typeof p === 'string' && typeof c === 'string' && !IGNORE.test(p),
  );
  if (entries.length === 0) return null;

  const pkgEntry = entries.find(([p]) => p === 'package.json' || p.endsWith('/package.json'));
  if (!pkgEntry) return null;
  const pkgRaw = pkgEntry[1];
  let devScript = '';
  try {
    const scripts = (JSON.parse(pkgRaw) as { scripts?: Record<string, unknown> }).scripts ?? {};
    devScript = ['dev', 'start', 'serve'].map((s) => scripts[s]).find((v): v is string => typeof v === 'string') ?? '';
  } catch {
    return null; // unreadable package.json — say nothing rather than guess
  }
  if (!devScript) return null;

  // Find the server entry: a file that creates Express and listens.
  const codeEntries = entries.filter(([p]) => CODE_RE.test(p));
  const serverEntry = codeEntries.find(([, src]) => EXPRESS_RE.test(src) && LISTEN_RE.test(src));
  if (!serverEntry) return null; // no server → a plain client app, already covered by the framework hint
  const [serverFile, serverSrc] = serverEntry;

  const devCommand = resolveDevRunCommand(pkgRaw);
  const serverPort = serverListenPort(serverSrc) ?? devScriptPort(pkgRaw) ?? 5000;

  // SINGLE-PORT: the server serves the client itself (Vite bridge or express.static). The preview is the
  // server's port — this is the exact case the "move to 5173" failure got wrong.
  if (SERVES_CLIENT_RE.test(serverSrc)) {
    return { mode: 'single-port', devCommand, previewPort: serverPort, serverPort, serverFile };
  }

  // TWO-PORT: one dev script boots BOTH a client bundler and the server together (concurrently / a shared
  // "dev" that runs vite + a node server). The preview is the CLIENT (Vite) port; it proxies /api.
  const runsBoth = CONCURRENT_RE.test(devScript) && CLIENT_BUNDLER_IN_SCRIPT.test(devScript) && SERVER_RUNNER_IN_SCRIPT.test(devScript);
  const hasViteConfig = entries.some(([p]) => /(?:^|\/)vite\.config\.[cm]?[jt]s$/i.test(p));
  if (runsBoth && hasViteConfig) {
    const clientPort = clientVitePort(entries) ?? 5173;
    return { mode: 'two-port', devCommand, previewPort: clientPort, serverPort, clientPort, serverFile };
  }

  // A server exists but nothing tells us it serves a client, and the dev script does not boot both — this
  // is likely a plain API (already covered) or an unclassifiable shape. Say nothing rather than misdirect.
  return null;
}

/**
 * The build-prompt instruction, or null when the app is not a classifiable full-stack shape. Give it the
 * `tree` (paths) and a reader for file contents; it probes only the handful of relevant files.
 */
export async function fullstackBootHint(
  paths: readonly string[],
  readFile: (p: string) => Promise<string>,
): Promise<string | null> {
  try {
    const probe = fullstackBootProbeFiles(paths);
    if (probe.length === 0) return null;
    const contents: Record<string, string> = {};
    for (const p of probe) {
      contents[p] = await readFile(p).catch(() => '');
    }
    const finding = analyzeFullstackBoot(contents);
    if (!finding) return null;
    return renderBootHint(finding);
  } catch {
    return null; // best-effort — never blocks a build
  }
}

/** The instruction text for a classified finding. PURE + exported for testing. */
export function renderBootHint(f: FullstackBootFinding): string {
  if (f.mode === 'single-port') {
    return (
      `FULLSTACK BOOT: this is a full-stack app — ONE server (\`${f.serverFile}\`) serves BOTH the API ` +
      `and the built client on a single port. Start the whole app with \`${f.devCommand}\` — do NOT run ` +
      `the server file by hand (e.g. \`tsx ${f.serverFile}\`) and do NOT start a separate client dev ` +
      `server. Wait until it logs that it is listening, then call update_preview with the port that ` +
      `server bound (usually ${f.previewPort}) — the server's port IS the preview, because that one ` +
      `server renders the UI. Do NOT hand-probe ports with curl/sleep loops, and never move the server ` +
      `to a different port to match a framework default.`
    );
  }
  return (
    `FULLSTACK BOOT: this is a full-stack app — \`${f.devCommand}\` starts BOTH the API server ` +
    `(\`${f.serverFile}\`, port ${f.serverPort}) and the Vite client dev server (port ${f.clientPort}) ` +
    `together. Preview the CLIENT: call update_preview(${f.previewPort}) — that is what renders the UI, ` +
    `and it proxies /api calls to the server. Run \`${f.devCommand}\` once; do NOT start the pieces ` +
    `separately or hand-probe ports with curl/sleep loops.`
  );
}
