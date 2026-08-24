// AgentV3 — WHAT PORT DOES THIS APP SAY IT SERVES ON?
//
// THE GAP THIS FILLS (admin, live, 2026-08-24). Two modules already deal with ports and neither can
// answer this question. `PortDiscovery` asks the sandbox OS which ports are LISTENING — a fact, and
// exactly the right answer when something is running. `PortBindingAnalysis` finds a hardcoded port and
// reports it as a DEFECT. Nothing reads the port an app DECLARES, and that is the only one available
// when the app is not running yet.
//
// WHAT IT COST, from the admin's own build report: an imported Express app whose `server/index.ts`
// serves on 5000. The preview never came up during the build, so no proven-port recipe was ever
// stored. Later the user opened Preview, the door had nothing to go on, fell through to the common
// list, and landed on 3000 — producing "no service running on port 3000" for an app that was never
// going to be on 3000. The engine had even READ the port and written "serves on port 5000" into its
// own reply; it simply never captured it anywhere a machine could use.
//
// THE RANKING IS THE DESIGN. A declared port is evidence of different strengths depending on where it
// came from, and saying so is what stops a weak signal outranking a strong one:
//   1. an explicit `--port N` in the app's own dev script — the app author's instruction to the tool
//   2. `PORT=N` in a committed env example — the author documenting their own default
//   3. a literal fallback in `listen(process.env.PORT || N)` — the author's default when nothing is set
//   4. a framework config's `server.port`
// Every one of these is weaker than a port we have SEEN serving, so the caller must always rank a
// proven port above whatever this returns.
//
// PURE — files in, answer out. No I/O, no clock, never throws.

export interface DeclaredPort {
  port: number;
  /** Where it came from, in the user's terms — surfaced in diagnostics so the choice is checkable. */
  source: string;
  /** 1 = strongest. Callers order candidates by this; a PROVEN port always outranks all of them. */
  rank: number;
}

/** Ports that are never an app's own dev server, so a stray match cannot send the door somewhere silly. */
function usable(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port > 1023 && port < 65536;
}

function fromScripts(pkg: Record<string, unknown>): DeclaredPort | null {
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  for (const name of ['dev', 'start', 'serve']) {
    const s = typeof scripts[name] === 'string' ? scripts[name] : '';
    if (!s) continue;
    // `--port 5000`, `--port=5000`, `-p 5000`
    const flag = /(?:--port[= ]|(?:^|\s)-p\s+)(\d{2,5})\b/.exec(s);
    if (flag && usable(Number(flag[1]))) return { port: Number(flag[1]), source: `the "${name}" script's --port`, rank: 1 };
    // `PORT=5000 node server.js`
    const env = /\bPORT=(\d{2,5})\b/.exec(s);
    if (env && usable(Number(env[1]))) return { port: Number(env[1]), source: `PORT= in the "${name}" script`, rank: 1 };
  }
  return null;
}

function fromEnvExample(text: string): DeclaredPort | null {
  const m = /^\s*(?:export\s+)?PORT\s*=\s*["']?(\d{2,5})["']?\s*$/m.exec(text);
  return m && usable(Number(m[1])) ? { port: Number(m[1]), source: 'PORT in the committed env example', rank: 2 } : null;
}

function fromListen(text: string): DeclaredPort | null {
  // `process.env.PORT || 5000`, `process.env.PORT ?? 5000`, `Number(process.env.PORT) || 5000`
  const withEnv = /process\.env\.PORT[^\n;]{0,40}?(?:\|\||\?\?)\s*["']?(\d{2,5})["']?/.exec(text);
  if (withEnv && usable(Number(withEnv[1]))) return { port: Number(withEnv[1]), source: 'the fallback in process.env.PORT || …', rank: 3 };
  // A bare `listen(5000` — the author's only statement of intent.
  const bare = /\.listen\(\s*(\d{2,5})\b/.exec(text);
  if (bare && usable(Number(bare[1]))) return { port: Number(bare[1]), source: 'a literal listen() port', rank: 3 };
  return null;
}

function fromViteConfig(text: string): DeclaredPort | null {
  const m = /server\s*:\s*\{[^}]*?\bport\s*:\s*(\d{2,5})/s.exec(text);
  return m && usable(Number(m[1])) ? { port: Number(m[1]), source: "the dev server config's port", rank: 4 } : null;
}

/** Files worth looking in, in the order they are most likely to hold the answer. Bounded on purpose. */
export const DECLARED_PORT_FILES: readonly string[] = [
  'package.json',
  '.env.example', '.env.sample',
  'server/index.ts', 'server/index.js', 'server/server.ts',
  'src/server/index.ts', 'src/index.ts', 'index.ts', 'index.js', 'app.js', 'server.js',
  'vite.config.ts', 'vite.config.js',
];

/**
 * The port this app says it serves on, or null when it does not say.
 *
 * Returns the STRONGEST signal found, never the first — a literal in some source file must not beat an
 * explicit `--port` in the app's own dev script. Null is a real answer and the caller must treat it as
 * "we do not know", never as a default.
 */
export function declaredPortFrom(files: Record<string, string | undefined>): DeclaredPort | null {
  const found: DeclaredPort[] = [];
  try {
    const pkgRaw = files['package.json'];
    if (pkgRaw) {
      try {
        const hit = fromScripts(JSON.parse(pkgRaw) as Record<string, unknown>);
        if (hit) found.push(hit);
      } catch { /* an unparseable package.json simply yields nothing */ }
    }
    for (const [path, text] of Object.entries(files)) {
      if (!text || path === 'package.json') continue;
      if (/\.env(\.|$)/.test(path)) { const h = fromEnvExample(text); if (h) found.push(h); continue; }
      if (/vite\.config\./.test(path)) { const h = fromViteConfig(text); if (h) found.push(h); continue; }
      const h = fromListen(text);
      if (h) found.push(h);
    }
  } catch {
    return null; // a port hint must never be able to throw on the path that only wants a hint
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.rank - b.rank);
  return found[0];
}
