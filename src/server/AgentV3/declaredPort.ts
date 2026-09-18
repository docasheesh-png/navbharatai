// AgentV3 — WHAT PORT(S) DOES THIS APP SAY IT SERVES ON?
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
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 🔴 AN APP HAS AS MANY PORTS AS IT HAS SERVICES, AND THIS FILE USED TO RETURN EXACTLY ONE
//    (admin build report `1a7f4a58`, 2026-09-18 — a full-stack classifieds app, "Qiikr").
//
// The app was a Vite frontend on **5173** and an Express API on **3001**. Both are the app's own.
// `declaredPortFrom` can name only the STRONGEST one, and `previewSupersede`'s veto — "never kill the
// port the app itself declares" — was built on that single answer. So the veto could protect one
// port and, by construction, leave the other one killable.
//
// It left the wrong one killable. Reproduced against the report's real `package.json`:
//
//     package.json alone        → null
//     + .env.example (PORT=3001)→ 3001   ("PORT in the committed env example", rank 2)
//     ⇒ decideSupersede(newPort: 3001, recipe: 5173) → staleports [5173], retireRecipe true
//
// The platform killed the user's FRONTEND to bless its own API, and retired the recipe that pointed
// at it. The preview then served `Cannot GET /` — the Express app only serves static files under
// `NODE_ENV=production` — and the agent spent minutes 18–31 of a 36-minute build chasing a preview
// the platform had aimed at the wrong process. The build ran out of budget one tool call short of
// fixing it.
//
// 🔑 AND THE STRONGEST SIGNAL WAS ONE DEREFERENCE AWAY. The app's `--port 5173` is real and explicit;
// it lives in `dev:client`, and the entry script is:
//
//     "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\""
//
// `fromScripts` read the text of `dev` and stopped. **A script that delegates hides every port the app
// declares** — and delegation via `concurrently` / `npm-run-all` is the NORMAL way to write a
// full-stack dev script, not an exotic one. So the fix has two halves and needs both:
//
//   1. FOLLOW THE INDIRECTION. `npm run X`, `pnpm run X`, `yarn run X`, `npm-run-all a b` are resolved
//      against the package's own scripts, bounded in depth and cycle-safe.
//   2. RETURN THE SET, NOT THE WINNER. `declaredPortsFrom` gives every port the app declares, so the
//      veto can be "never kill ANY port this app claims" — which is the rule the singular version was
//      always trying to express.
//
// ⚠️ Refusing to kill is the safe direction in both cases, which is what makes a WIDER veto safe to
// ship: the worst case of a port we decline to free is a leftover that survives (today's status quo
// whenever the app declares nothing), while the worst case of one we free wrongly is the report above.
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

/** The scripts an app is actually started by. Everything else is reached only by delegation. */
const ENTRY_SCRIPTS = ['dev', 'start', 'serve'] as const;

/**
 * How deep a `npm run` chain is followed. Three covers every real shape seen
 * (`dev` → `dev:client` → a tool) and bounds a pathological package.json by construction.
 */
const MAX_SCRIPT_DEPTH = 3;

/** Every `--port N` / `-p N` / `PORT=N` in ONE command string, in the order they appear. */
function portsInCommand(command: string): number[] {
  const out: number[] = [];
  const flag = /(?:--port[= ]|(?:^|\s)-p\s+)(\d{2,5})\b/g;
  const env = /\bPORT=(\d{2,5})\b/g;
  for (const re of [flag, env]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(command)) !== null) {
      const n = Number(m[1]);
      if (usable(n)) out.push(n);
    }
  }
  return out;
}

/**
 * Script names this command delegates to.
 *
 * Deliberately only the `run`-prefixed forms plus `npm-run-all`: a bare `yarn <word>` would read
 * `yarn add express` as a script called "add", and inventing a delegation is how a port reader starts
 * answering about something that is not the app.
 */
function delegatesTo(command: string): string[] {
  const names: string[] = [];
  const run = /\b(?:npm|pnpm|yarn|bun)\s+run\s+([\w:.@/-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = run.exec(command)) !== null) names.push(m[1]);
  // `npm-run-all -p dev:client dev:server` / `run-p a b` — the names are bare positional arguments.
  const all = /\b(?:npm-run-all|run-p|run-s)\b([^&|;"']*)/g;
  while ((m = all.exec(command)) !== null) {
    for (const word of String(m[1] ?? '').split(/\s+/)) {
      if (word && !word.startsWith('-')) names.push(word);
    }
  }
  return names;
}

/**
 * Ports declared by the package's own scripts — following `npm run` delegation.
 *
 * Returns EVERY port found, because a full-stack dev script starts more than one process and both
 * ports belong to the app. `rank` stays 1: an explicit flag is an explicit flag however many hops away
 * it was written, and the hop is the author's own indirection, not our inference.
 */
function fromScripts(pkg: Record<string, unknown>): DeclaredPort[] {
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const found: DeclaredPort[] = [];
  const seen = new Set<string>();

  const walk = (name: string, depth: number): void => {
    if (depth > MAX_SCRIPT_DEPTH || seen.has(name)) return;
    seen.add(name);
    const command = typeof scripts[name] === 'string' ? scripts[name] : '';
    if (!command) return;
    for (const port of portsInCommand(command)) {
      found.push({ port, source: `the "${name}" script's port flag`, rank: 1 });
    }
    for (const next of delegatesTo(command)) walk(next, depth + 1);
  };

  for (const entry of ENTRY_SCRIPTS) walk(entry, 0);
  return found;
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

/**
 * Files worth looking in, in the order they are most likely to hold the answer. Bounded on purpose.
 *
 * ⚠️ `server/src/index.ts` is here because report `1a7f4a58`'s Express entry point was at exactly that
 * path and the list held `server/index.ts` and `src/server/index.ts` but not the combination — so the
 * one file that states the API's own port was never read.
 */
export const DECLARED_PORT_FILES: readonly string[] = [
  'package.json',
  '.env.example', '.env.sample',
  'server/index.ts', 'server/index.js', 'server/server.ts',
  'server/src/index.ts', 'server/src/index.js',
  'src/server/index.ts', 'src/index.ts', 'index.ts', 'index.js', 'app.js', 'server.js',
  'vite.config.ts', 'vite.config.js',
];

/** Every declared port, strongest first, de-duplicated by port. Empty when the app says nothing. */
export function declaredPortsFrom(files: Record<string, string | undefined>): DeclaredPort[] {
  const found: DeclaredPort[] = [];
  try {
    const pkgRaw = files['package.json'];
    if (pkgRaw) {
      try {
        found.push(...fromScripts(JSON.parse(pkgRaw) as Record<string, unknown>));
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
    return []; // a port hint must never be able to throw on the path that only wants a hint
  }
  found.sort((a, b) => a.rank - b.rank);
  const byPort = new Map<number, DeclaredPort>();
  for (const hit of found) if (!byPort.has(hit.port)) byPort.set(hit.port, hit);
  return [...byPort.values()];
}

/**
 * The single strongest port this app says it serves on, or null when it does not say.
 *
 * Returns the STRONGEST signal found, never the first — a literal in some source file must not beat an
 * explicit `--port` in the app's own dev script. Null is a real answer and the caller must treat it as
 * "we do not know", never as a default.
 *
 * ⚠️ A caller deciding what NOT to touch wants `declaredPortsFrom` instead: an app with a frontend and
 * an API declares two ports, and picking the winner of the two is what killed the other one.
 */
export function declaredPortFrom(files: Record<string, string | undefined>): DeclaredPort | null {
  return declaredPortsFrom(files)[0] ?? null;
}
