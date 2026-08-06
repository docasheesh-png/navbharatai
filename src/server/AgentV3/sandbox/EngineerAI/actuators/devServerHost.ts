/**
 * Force a dev server to listen on 0.0.0.0 so it is reachable through the E2B
 * sandbox's external preview URL (e.g. `{port}-{id}.e2b.app`). A localhost-only
 * bind (the Vite/Next default when a config does not set host:true) passes a local
 * `nc -z localhost` health check but returns 502/blank on the PUBLIC preview — the
 * #1 cause of "files built but the preview is blank".
 *
 * This is the v5.0-local copy of the helper (the legacy EngineerAI engine has its
 * own); kept self-contained so the v5.0 actuator never depends on the retired
 * legacy module. PURE + dependency-free so it is unit-testable without the E2B SDK.
 *
 * If the command already binds a host we leave it untouched.
 */
/**
 * Stop the dev server from trying to auto-open a browser inside the HEADLESS E2B sandbox.
 * A Vite/CRA config with `server.open: true` (or an `--open` flag) spawns the OS opener
 * (`xdg-open` on Linux), which does NOT exist in the sandbox → `spawn xdg-open ENOENT`. That
 * unhandled spawn error can CRASH the dev server right after it prints "ready", taking the
 * preview port down with it — so `update_preview` then finds the port dead, returns a warning,
 * and never publishes the URL ("No live preview yet" even though the app built fine). Both Vite
 * and CRA honour `BROWSER=none` (their openBrowser maps it to a no-op, skipping the spawn
 * entirely), so prepend it as an inline env assignment. Idempotent + pure.
 */
export function disableDevServerAutoOpen(command: string): string {
  if (!command || /(?:^|\s)BROWSER=/.test(command)) return command;
  return `BROWSER=none ${command}`;
}

/**
 * The in-sandbox log file a backgrounded dev server's output is redirected to. Reading THIS file
 * (instead of the live command stream) is what lets the dev server survive the actuator disconnecting.
 */
export const DEV_SERVER_LOG_PATH = '/tmp/nbai-devserver.log';

/**
 * Redirect a dev server's stdout+stderr to a FILE inside the sandbox (in a subshell so any internal
 * pipes/env-prefixes are captured whole).
 *
 * THE BUG this fixes (confirmed from a real build report: vite on 5173 kept dying while a plain
 * `node` http server on 3333 stayed alive — the textbook SIGPIPE signature):
 * the actuator launches the dev server with `background:true` and streams its stdout back through the
 * SDK connection. When it then calls `handle.disconnect()` (to return the moment the port is up), that
 * stream closes. Vite keeps writing to stdout (HMR pings, request logs) → a write to the now-closed
 * pipe raises SIGPIPE → vite is killed a second after "ready", the health-check restarts it, and the
 * loop burns the whole build budget. A server that stays SILENT after boot (the bare node one) never
 * writes again, so it never hits SIGPIPE and survives — exactly what the report showed.
 *
 * By sending the dev server's output to a file, its stdout is a regular file that never closes, so a
 * disconnect can no longer SIGPIPE it. Port/drift detection then reads the file (see the actuator)
 * instead of the live stream. PURE + unit-testable. Idempotent (never double-wraps).
 */
export function redirectDevServerOutput(command: string, logPath: string = DEV_SERVER_LOG_PATH): string {
  if (!command) return command;
  const c = command.trim();
  if (!c) return c;
  // Already redirected to this exact log → don't wrap again.
  if (c.includes(`> ${logPath}`)) return c;
  return `( ${c} ) > ${logPath} 2>&1`;
}

/**
 * The dev-server framework a concrete command string represents. Used to give the host/port
 * flag helpers the framework signal a bare `npm run dev` cannot reveal on its own — a Vite
 * scaffold and a Next/Astro/Nuxt/Angular scaffold both run `npm run dev`, but they need
 * DIFFERENT flags (Next uses `-H`/`-p`, and `--strictPort` is Vite-only and crashes the others).
 * `undefined` = unknown → callers keep the historical Vite-assumption behaviour.
 */
export type DevFramework = 'vite' | 'next' | 'astro' | 'nuxt' | 'angular' | 'cra' | undefined;

/**
 * True when a dev command LAUNCHES A NODE SERVER directly — `tsx`/`ts-node`/`nodemon`/`node` on a server
 * entry (server/app/index/main/backend/api), e.g. `tsx server/index.ts`. Such a command runs an
 * Express/Fastify/Koa server on a NODE port (3000), NOT Vite's 5173, and carries no framework keyword the
 * other detectors recognise — so the port/host helpers must treat it explicitly. Mirrors ProjectImport's
 * `devScriptRunsNodeServer` (one source of truth for "this is a node server"). A bundler invocation
 * (`vite`, `next`, …) is NOT matched (those are handled by the framework branches). PURE + unit-testable.
 *
 * ROOT CAUSE this enables the fix for (Mitrify import, 2026-07-24): `tsx server/index.ts` fell through
 * every framework check, so the preview assumed Vite's 5173, pinned nothing, forced no host — and the
 * health-check waited on 5173 while the Express server bound its own port → "did not come up on port 5173".
 */
/**
 * True when a command pipes or chains into ANOTHER command (`|`, `||`, `&&`, `;`). Appending a
 * `--host`/`--port` flag to such a command lands it on the WRONG program — the real bug from report
 * 7773b4b0: a model ran `npm run dev 2>&1 | head -50`, and the flag helpers appended
 * `-- --host 0.0.0.0 --port 3000 --strictPort` onto the END, so `head` received them and errored
 * ("head: cannot open '--host' for reading"), and the dev server never came up. The flag helpers skip
 * injection when this is true (the managed preview always launches a CLEAN, unpiped dev command, so only
 * a model's ad-hoc piped/chained invocation is skipped — correct, since that isn't the managed preview).
 * PURE + unit-testable. (`2>&1` alone is NOT a chain — it contains no `|`/`&&`/`;`.)
 */
export function pipesOrChainsToAnotherCommand(command: string): boolean {
  if (!command) return false;
  return /\||&&|;/.test(command);
}

export function isNodeServerCommand(command: string): boolean {
  if (!command) return false;
  // A real bundler/dev-CLI invocation is not a bare node server — let the framework branches own it.
  if (/\b(?:vite(?:\.js)?|next|astro|nux(?:t|i)|ng|react-scripts)\b/i.test(command)) return false;
  return /\b(?:tsx|ts-node|nodemon|node)\b[^;|&]*\b(?:server|app|index|main|backend|api)\b/i.test(command);
}

/** Identify the dev-server framework from a CONCRETE command string (e.g. a resolved package.json
 *  script body like `vite` or `astro dev`). Returns `undefined` for anything unrecognized so the
 *  flag helpers fall back to today's Vite assumption. PURE + unit-testable. */
export function detectDevFramework(command: string): DevFramework {
  if (!command) return undefined;
  if (/\bnext\b/.test(command)) return 'next';
  if (/\bvite(?:\.js)?\b/.test(command)) return 'vite';
  if (/\bastro\b/.test(command)) return 'astro';
  if (/\bnux(?:t|i)\b/.test(command)) return 'nuxt'; // `nuxt` (v2) or `nuxi` (v3 CLI)
  if (/\bng\s+serve\b/.test(command) || /@angular\b/.test(command)) return 'angular';
  if (/\breact-scripts\b/.test(command)) return 'cra';
  return undefined;
}

/**
 * Resolve a package-manager run command (`npm run dev`, `pnpm dev`, `yarn serve`, `bun run dev`,
 * `npm start`) to the CONCRETE underlying tool string from the project's `scripts` map, so the
 * flag/port helpers can see the real framework instead of assuming Vite. Any explicit args the
 * user passed after `--` (e.g. `npm run dev -- --port 8080`) are carried through so port detection
 * still sees them. Returns the command unchanged when it is not a pm-run form, the script is
 * absent, or no scripts were provided. PURE + unit-testable.
 */
export function resolvePmScript(command: string, scripts: Record<string, string> | null | undefined): string {
  if (!command || !scripts) return command;
  const m = command.trim().match(/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([a-zA-Z0-9:_-]+)(.*)$/);
  if (!m) return command;
  const body = scripts[m[1]];
  if (!body || typeof body !== 'string') return command;
  // Preserve args the user forwarded after `--` (npm) so an explicit --port isn't lost.
  const dd = (m[2] ?? '').match(/(?:^|\s)--\s+(.*)$/);
  const passthrough = dd ? ` ${dd[1].trim()}` : '';
  return `${body}${passthrough}`.trim();
}

/**
 * Force a dev server to listen on 0.0.0.0 so it is reachable through the E2B preview URL.
 * `framework` (resolved from package.json) disambiguates a bare `npm run dev`: Next.js needs
 * `-H` (it errors on the Vite-style `--host`), and CRA reads `HOST=` from the env rather than a
 * flag. When `framework` is undefined the historical Vite-style `--host` pass-through is kept, so
 * existing callers and the common Vite scaffold are byte-for-byte unchanged.
 */
export function ensureHostBinding(command: string, framework?: DevFramework): string {
  if (!command) return command;
  // Already binds a host (any interface / explicit flag) — leave untouched.
  if (/--host|-H\b|HOST=|0\.0\.0\.0/.test(command)) return command;
  // Piped/chained (`| head`, `&& …`) — appending a flag would land it on the WRONG program (report
  // 7773b4b0: `npm run dev | head` got `--host` appended onto `head`). Leave such a command untouched.
  if (pipesOrChainsToAnotherCommand(command)) return command;
  // A direct Node server (`tsx server/index.ts`, …) takes no --host flag; most Express/Fastify apps read
  // the bind host from `HOST` (or bind 0.0.0.0 already). Prefix `HOST=0.0.0.0` so a config-driven server
  // is reachable on the PUBLIC E2B preview instead of binding localhost-only (blank preview). A server
  // that ignores HOST is unchanged. (Mitrify node-express import fix, 2026-07-24.)
  if (isNodeServerCommand(command)) return `HOST=0.0.0.0 ${command}`;
  // Next.js dev server.
  if (/\bnext\b/.test(command)) return `${command} -H 0.0.0.0`;
  // Vite invoked directly.
  if (/\bvite\b/.test(command)) return `${command} --host 0.0.0.0`;
  // Package-manager script (npm/pnpm/yarn/bun run dev|serve): the underlying tool is only known via
  // `framework`. `start` is intentionally excluded — it is ambiguous with CRA, which needs HOST=.
  if (/\b(?:npm|pnpm|yarn|bun)\b.*\b(?:run\s+)?(?:dev|serve)\b/.test(command)) {
    // Next.js wants `-H`, not `--host` (an unknown `--host` flag makes `next dev` exit).
    if (framework === 'next') return `${command} -- -H 0.0.0.0`;
    // CRA (react-scripts) reads HOST= from the env, not a flag — don't inject a --host it ignores/rejects.
    if (framework === 'cra') return command;
    // vite / astro / nuxt / angular (and unknown, kept as the historical default) all accept --host.
    return `${command} -- --host 0.0.0.0`;
  }
  return command;
}

/**
 * True when a command starts a long-running dev server / watcher (never exits on its own),
 * so the actuator must run it with E2B `background:true` + a health-check poll instead of
 * waiting for it to finish. A non-background run of one of these blocks until the 5-minute
 * command timeout and returns `deadline_exceeded` — exactly what happened in a real build
 * report where `npx vite …` and `node node_modules/vite/bin/vite.js …` were NOT detected
 * (the old check only knew `npm run dev`/`next dev`/…), fell through to the foreground path,
 * and timed out at 300s.
 *
 * Detects: the `dev`/`serve`/`watch` keywords, `npm run dev|start|serve`, framework CLIs
 * (next/nuxt/astro/ng), python/uvicorn/gunicorn/flask servers, dev.sh wrappers, AND any Vite
 * invocation — bare `vite`, `npx vite`, `node …/vite/bin/vite.js`, `vite preview` — EXCEPT
 * `vite build` (which compiles and exits). One-shot fetches (curl/wget) are never long-running.
 * PURE + unit-testable.
 */
/** The one-shot process-inspection/management commands from the fix below — never a dev-server
 *  start ON THEIR OWN, even when they reference "vite" as a filter/pattern argument. */
const ONE_SHOT_PREFIX = /^\s*(?:pkill|pgrep|ps|kill|grep|netstat|lsof|fuser|ss|head|tail|wc|find|which|echo|cat)\b/i;

/** True when a single command segment (no `;`/`&&`/`||` chaining left in it) itself starts a
 *  dev/preview server. Extracted so isLongRunningCommand can apply it PER-SEGMENT of a compound
 *  command (see below) instead of only to the whole string. */
function isDevServerInvocation(segment: string): boolean {
  // Any Vite invocation is a dev/preview server EXCEPT `vite build` (compiles then exits).
  const isVite = /\bvite(?:\.js)?\b/i.test(segment) && !/\bvite(?:\.js)?\b[^\n]*\bbuild\b/i.test(segment);
  return (
    isVite ||
    /\b(?:dev|serve|watch|livereload)\b/i.test(segment) ||
    // `npm run preview` (and pnpm/yarn) runs `vite preview` — a long-running static server that serves
    // the built dist. Missing `preview` here made it run in the FOREGROUND and block for the full 5-min
    // command timeout (deadline_exceeded), wasting ~10 min per build when the agent tried it and the
    // live preview still never came up. `npm run build` stays excluded (compiles then exits).
    /(?:npm|pnpm|yarn)\s+run\s+(?:dev|start|serve|preview)\b/i.test(segment) ||
    /python.*http\.server|http-server|live-server/i.test(segment) ||
    /\buvicorn\b|\bgunicorn\b|\bflask\s+run\b/i.test(segment) ||
    // Shell scripts that wrap dev servers (Django, Flask, FastAPI dev.sh)
    /^\s*(?:bash|sh)\s+\S*dev\.sh\b/i.test(segment) ||
    // Framework-specific CLIs
    /\bng\s+serve\b/i.test(segment) ||            // Angular CLI
    /\bnext\s+dev\b/i.test(segment) ||             // Next.js direct
    /\bnuxt\s+dev\b/i.test(segment) ||             // Nuxt direct
    /\bastro\s+dev\b/i.test(segment)               // Astro direct
  );
}

export function isLongRunningCommand(command: string): boolean {
  if (!command) return false;
  if (/^\s*(?:curl|wget)\b/.test(command)) return false;
  // Judge EACH top-level chained segment (split on `;`/`&&`/`||`) on its own, not just the whole
  // string. A one-shot process-inspection/management segment (pkill/ps/grep/…) is NEVER itself a
  // dev-server start, even when it references "vite" as a filter/pattern — e.g. `pkill -f "vite"`,
  // `ps aux | grep vite` (matching "vite" as a bare substring previously caught these too, routing a
  // kill/inspect command into the background-dev-server-start path, which mangled it with --host/
  // --port flags pkill/ps/grep reject outright — see the regression this comment used to describe).
  // BUT a compound command like `pkill -f "vite"; sleep 1; npm run dev &` genuinely DOES start a dev
  // server in its LAST segment — excluding the whole command there (an actual regression this fix
  // introduced) skipped ensureHostBinding/stripDevServerBackgrounding for that real npm-run-dev
  // segment, so the agent's own self-backgrounded `&` was never stripped and the dev server got
  // orphaned + reaped exactly like the original "Killed right after ready" bug, just via a different
  // code path. So: a one-shot-prefixed segment's OWN text is never checked for a dev-server pattern,
  // but every OTHER segment still is — the whole command is long-running if ANY of those matches.
  const segments = command.split(/&&|\|\||;/);
  return segments.some((seg) => !ONE_SHOT_PREFIX.test(seg) && isDevServerInvocation(seg));
}

/**
 * Strip shell-level self-backgrounding from a dev-server command so it runs in the
 * FOREGROUND of E2B's `background:true` runner.
 *
 * THE BUG this fixes (the #1 "preview never comes up / build times out" cause):
 * the actuator already starts long-running commands with E2B `background:true`,
 * which keeps the process alive across calls ONLY as long as the command E2B
 * launched is itself the running process. When the agent writes its own
 * `npm run dev … &` (trailing `&`) or `nohup npm run dev … &`, the shell launches
 * vite in the background and then EXITS immediately — so E2B sees its command
 * finish and reaps the command's process group, killing the orphaned vite. The
 * server prints `ready in 200ms … Local: http://localhost:5173/` and then `Killed`
 * a second later, the health-check restarts it, and the loop burns the whole
 * wall-clock budget until BUILD_TIMEOUT. Removing the agent's own backgrounding
 * makes vite the foreground process E2B tracks, so it stays up.
 *
 * Only touches a command that ENDS in a single `&` (real backgrounding) — `a && b`
 * and normal foreground commands are left byte-for-byte unchanged. PURE +
 * unit-testable.
 */
export function stripDevServerBackgrounding(command: string): string {
  if (!command) return command;
  let c = command.trim();
  // `nohup` is pointless under E2B's background runner and only muddies process tracking.
  c = c.replace(/^nohup\s+/i, '');
  // Act ONLY when there is a real trailing backgrounding `&` (not `&&`).
  if (!/(^|[^&])&\s*$/.test(c)) return c;
  c = c.replace(/\s*&\s*$/, '');           // drop the trailing &
  // Drop the file redirect that typically precedes it (e.g. `&> /tmp/vite.log`,
  // `> x.log 2>&1`) so vite's own output flows back to the actuator's stream and the
  // bound port can be detected — strip repeatedly since there can be several tokens.
  let prev: string;
  do {
    prev = c;
    c = c.replace(/\s*(?:&>>?|>>?|2>&1|1>&2|2>>?)\s*(?:[^\s&|;<>]+)?\s*$/, '').trim();
  } while (c !== prev);
  return c;
}

/**
 * A backgrounded long-lived-server "smoke check": the agent starts a persistent server with a
 * MID-LINE `&` and then probes it, e.g. `npm run server 2>&1 & sleep 5; curl .../health`. The
 * backgrounded server never exits and HOLDS the E2B command pipe, so `commands.run` blocks for the
 * FULL command timeout (300s = deadline_exceeded) before returning — this alone burned ~10 min
 * (two 300s hangs) in deep-test App #7/#8/#9 and helped push a build past its wall-clock into
 * BUILD_FAILED. Its USEFUL work (boot + probe) finishes in seconds, so cap such a command's timeout
 * hard: the held server is killed early instead of hanging out the whole 300s, and the agent gets its
 * (failed-or-not) result ~270s sooner and moves on.
 *
 * Deliberately NARROW so it can never shorten a legitimate command:
 *  - requires a REAL backgrounding `&` (not `&&`) that is MID-LINE (more text after it) — a bare
 *    trailing-`&` dev server is already handled by the long-running background path, not here;
 *  - AND the command must start some kind of long-lived server (npm run server/start/dev/serve/
 *    preview/backend/api, or node/tsx/ts-node/nodemon on a server entry).
 * A plain `npm install`, `npm run build`, or a foreground dev server never matches. PURE +
 * unit-testable. Returns the cap (ms) when it applies, else null (→ caller keeps the normal timeout).
 */
export function backgroundedServerSmokeCheckMs(command: string, capMs = 45_000): number | null {
  if (!command) return null;
  // A real backgrounding `&` (not part of `&&`) with MORE command text after it (mid-line).
  const midBackground = /(?:^|[^&])&(?!&)\s*\S/.test(command);
  if (!midBackground) return null;
  const startsServer =
    /(?:npm|pnpm|yarn)\s+run\s+(?:server|start|dev|serve|preview|backend|api)\b/i.test(command) ||
    /\bnpm\s+start\b/i.test(command) ||
    /\b(?:tsx|ts-node|nodemon)\b[^\n&|;]*\bserver\b/i.test(command) ||
    /\bnode\b[^\n&|;]*\bserver(?:[/\\]index)?\.(?:ts|js|mjs|cjs)\b/i.test(command);
  return startsServer ? capMs : null;
}

/**
 * Shell test that prints `STALE` when dependencies need (re)installing — node_modules is
 * missing, or package.json has been edited since the last install (a newly-declared dep like
 * `tailwindcss` is not yet on disk). Used to gate `npm install` before a build AND before a dev
 * server starts, so the server never crashes with "Cannot find module 'tailwindcss'". Ends in
 * `true` so a clean tree exits 0. PURE string builder — unit-testable without E2B.
 */
export function buildDepsStaleCheckCommand(): string {
  // STALE (→ reinstall) when node_modules is absent, older than package.json, OR present-but-INCOMPLETE.
  // The last case is the real fix for a preview that "came up" but crashed on every transform with
  // "[plugin:vite:react-babel] Cannot find module 'caniuse-lite/dist/unpacker/agents'" (build report
  // 2026-07-06): the E2B base image ships a PRE-BAKED node_modules, so the mtime check reads "fresh" and
  // the install is skipped — yet that pruned tree can be missing a declared package, or (for the babel
  // React plugin) its browserslist→caniuse-lite DATA chain, which vite only needs at transform time. A
  // pure resolve probe over the app's own package.json catches an incomplete tree that mtime can't. Any
  // probe failure just triggers a reinstall (safe); a healthy tree passes instantly (no latency added).
  const integrity =
    `node -e "try{var p=require('./package.json');var d=Object.assign({},p.dependencies,p.devDependencies);` +
    `Object.keys(d).forEach(function(k){require.resolve(k+'/package.json')});` +
    `if(d['@vitejs/plugin-react']){require.resolve('caniuse-lite/dist/unpacker/agents')}}catch(e){process.exit(1)}"`;
  return `if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then echo STALE; elif ! ${integrity} 2>/dev/null; then echo STALE; fi; true`;
}

/**
 * The dependency-install command a BUILD runs before starting its dev server. A build that just
 * (re)wrote package.json MUST install its FULL dependency tree — trusting a pre-baked/partial
 * node_modules ("deps present", skip install) is exactly what left a transitive babel/browserslist
 * dependency (caniuse-lite/dist/unpacker/agents) missing and crashed the live preview at transform
 * time. `npm install` is idempotent + fast when the tree is already satisfied, so always reconciling
 * is correct and cheap; never skip on "node_modules exists". PURE (unit-testable string builder).
 */
export function buildBuildInstallCommand(): string {
  // EventHive-class defense-in-depth 2026-07-18: an ERESOLVE peer conflict (e.g. an incompatible
  // transitive major) makes a bare `npm install` exit non-zero, so the dev server never boots even
  // though the app is otherwise fine. The agent recovers by re-running with --legacy-peer-deps; the
  // automated fast-lane install must be just as forgiving. A shell `|| … --legacy-peer-deps` retries
  // ONLY when the strict install fails — no behaviour change on a clean install.
  return 'npm install --no-audit --no-fund || npm install --no-audit --no-fund --legacy-peer-deps';
}

/**
 * Free a TCP port BEFORE (re)starting a dev server.
 *
 * Why this matters: when a previous build attempt left a dev server alive on the
 * target port, a fresh `vite`/`next dev` finds the port busy and silently
 * auto-increments to the next free port (5173 → 5174). The PUBLIC E2B preview URL
 * is built from the EXPECTED port (5173), so it now points at a dead port → blank
 * preview — while a health check on 5173 still passes (the stale old server),
 * so no self-heal ever fires. Killing the port first guarantees the new server
 * binds the port we actually preview.
 *
 * RELIABILITY: a single tool is not enough — the E2B base image may ship without
 * `fuser` (psmisc), and the old `pkill -f "node.*:{port}"` pattern never matched a
 * real Vite process (its argv is `node .../vite`, with no ":5173" in it), so the
 * port was left occupied and Vite drifted to 5174 anyway. We therefore try every
 * common mechanism in turn — `fuser`, `lsof`, and `ss` (almost always present via
 * iproute2) — so whichever exists frees the port. Everything is error-guarded and
 * ends in `true`, so a missing tool or an already-free port never fails the step.
 * PURE string builder so it is unit-testable without E2B.
 */
export function buildPreKillPortCommand(port: number): string {
  return [
    `fuser -k ${port}/tcp 2>/dev/null`,
    // lsof: kill whatever PID owns the TCP port.
    `kill -9 $(lsof -ti tcp:${port} 2>/dev/null) 2>/dev/null`,
    // ss (iproute2): parse `users:(("node",pid=1234,...))` → kill that pid.
    `kill -9 $(ss -lptnH "sport = :${port}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2) 2>/dev/null`,
    `true`,
  ].join('; ');
}

/**
 * Pin a dev server to a FIXED port so it can never silently auto-increment
 * (5173 → 5174). Vite's default is `strictPort:false`: if the port is busy it
 * quietly moves to the next one, but the preview URL and health check still assume
 * the original port — so the preview connects to a dead port and the build loops
 * until the wall-clock cap ("build timed out"). Adding `--strictPort` makes Vite
 * bind exactly this port or fail LOUDLY (which the agent can see and recover from),
 * instead of drifting invisibly. Next.js `-p` is already strict.
 *
 * No-op when the command already pins a port (`--port` / `-p`), and only touches
 * Vite/Next commands — anything else is left for runtime port DETECTION. PURE +
 * unit-testable.
 */
export function pinDevServerPort(command: string, port: number, framework?: DevFramework, resolvedScript?: string): string {
  if (!command) return command;
  if (/--port[=\s]|[\s]-p[\s]/.test(command)) return command; // already pinned — respect it
  // Piped/chained (`| head`, `&& …`) — appending a `--port` would land it on the WRONG program (report
  // 7773b4b0: `npm run dev | head` got `--port 3000 --strictPort` appended onto `head`). Skip injection.
  if (pipesOrChainsToAnotherCommand(command)) return command;
  // A direct Node server (`tsx server/index.ts`, …) takes no `--port` flag; nearly every Express/Fastify
  // app reads its port from `process.env.PORT`. Inject `PORT=<port>` so the server binds the exact port
  // the health-check watches — the fix for the Mitrify "did not come up on port 5173" import (its
  // `tsx server/index.ts` had no framework signal, so the preview assumed Vite 5173 and pinned nothing).
  // If the server ignores PORT and binds its own, detectDevPort re-points the preview to the real port.
  //
  // LOOK THROUGH `npm run dev` (report 26a8e81c, 2026-08-06). The caller already resolves the package.json
  // script, but used to test THIS decision against the raw `npm run dev` — where no `tsx`/`node` appears —
  // so a Node server behind a pm script fell through to the Vite assumption and got `--port 3000
  // --strictPort`, flags `tsx server/index.ts` silently ignores. The app then bound its own 5000 while the
  // health check watched 3000, declared "did not start", and restarted twice — and the still-running first
  // server made the retry die with `EADDRINUSE: address already in use 0.0.0.0:5000`. That whole cascade
  // came from testing the wrong string. `PORT=` on the pm command propagates to the child process, so the
  // server binds the port we are actually watching.
  const nodeServer = isNodeServerCommand(command) || (!!resolvedScript && isNodeServerCommand(resolvedScript));
  if (nodeServer) {
    // RETURN, do not fall through. An already-pinned `PORT=8080 npm run dev` used to skip this branch
    // and land in the Vite one below, which appended `--port … --strictPort` — the very flags this
    // command ignores, and the bug being fixed. A Node server is done here either way.
    return /\bPORT=/.test(command) ? command : `PORT=${port} ${command}`;
  }
  if (/\bnext\b/.test(command) || framework === 'next') return `${command} -p ${port}`;
  const isPmDev = /\b(?:npm|pnpm|yarn|bun)\b.*\b(?:run\s+)?(?:dev|serve)\b/.test(command);
  // Vite (invoked directly, resolved from a script, or the unknown-framework default for a pm-run
  // script — the v5.0 scaffold's case): pin with the Vite-only `--strictPort` so it binds EXACTLY
  // this port or fails loudly instead of silently drifting 5173→5174.
  if (/\bvite\b/.test(command) || framework === 'vite') {
    return `${command} --port ${port} --strictPort`;
  }
  // A resolved NON-Vite framework (astro/nuxt/angular): pin the port but DROP `--strictPort`, which
  // those CLIs reject as an unknown flag — passing it crashed the dev server right after start, so
  // the preview never came up (blank). They accept a plain `--port`; if the port still drifts,
  // detectDevPort downstream re-points the preview at the REAL bound port.
  if (isPmDev && (framework === 'astro' || framework === 'nuxt' || framework === 'angular')) {
    return `${command} --port ${port}`;
  }
  // CRA (react-scripts) takes neither `--port` nor `--strictPort` (it reads PORT= from the env) —
  // leave its command untouched rather than append flags it ignores/rejects.
  if (framework === 'cra') return command;
  // Ambiguous pm-run dev/serve with no framework signal → keep the historical Vite assumption.
  if (isPmDev) return `${command} --port ${port} --strictPort`;
  return command;
}

/**
 * Detect the port a dev server ACTUALLY bound, from its stdout, instead of trusting
 * the assumed default. Vite prints `➜  Local:   http://localhost:5174/`, Next prints
 * `- Local:  http://localhost:3000`, others print `listening on :3000` or
 * `running on port 5174`. This is the source of truth the preview must use: if the
 * server drifted, we preview the REAL port, not the assumed one. Returns `fallback`
 * when nothing matches. PURE + unit-testable.
 */
export function detectDevPort(output: string, fallback: number): number {
  if (!output) return fallback;

  // ROOT CAUSE this rewrite kills (mitrify autopsy 2026-08-04, buildId ca5a4ca8). The old version ran
  // four regexes over the WHOLE log and returned the first hit anywhere. The app printed
  //   `[express] serving on port 5000`
  // and then, because no Postgres was provisioned, dumped a connection error containing
  //   `Error: connect ECONNREFUSED 127.0.0.1:5432` … `port: 5432`
  // The very first pattern (`localhost|127.0.0.1…:(\d+)`) matched the ERROR's REMOTE address, so the
  // health check probed 5432, found nothing, and declared "the dev server did not come up on port
  // 5432" — while the app was serving perfectly on 5000. A WORKING app was reported dead, and the
  // reported port was a database port the dev server never had anything to do with.
  //
  // Two independent defects, both fixed here:
  //   1. An error / stack-trace line was allowed to answer "which port is the server listening on?".
  //      A connection error's address is a DESTINATION the app failed to reach — the opposite of a
  //      listening announcement. Such lines are now excluded outright.
  //   2. `serving on port N` — Express's single most common phrasing — was not a recognised
  //      announcement (only `running on port N` was), so the correct answer was never even a
  //      candidate at strong-signal level.
  //
  // The scan is now line-based and TIERED: a real listening announcement always beats the loose
  // `port: N` fallback, no matter where each appears in the log.

  /** A line that reports a FAILURE, not a listening socket — its addresses must never be trusted. */
  const isErrorLine = (line: string): boolean =>
    /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND|ETIMEDOUT|ECONNABORTED/i.test(line)
    || /\bError\b\s*[:[]/.test(line)          // "Error: connect …", "AggregateError [ECONNREFUSED]:"
    || /^\s*at\s/.test(line)                   // stack frame
    || /\b(?:errno|syscall|address)\s*:/i.test(line) // the error object's own dump
    // ...and the dump's `port:` field, which is the port we FAILED to bind, not one we are serving on.
    // REPRODUCED (mitrify autopsy 2026-08-04): a log containing ONLY a Node EADDRINUSE dump made
    // detectDevPort(log, 3000) return 5000 — scraped straight out of the crash — because every other
    // field of that dump was filtered here and `port:` was not. Matched narrowly, as a bare field line
    // (`  port: 5000`), so a real announcement like "listening on port 3000" is untouched.
    || /^\s*port\s*:\s*\d{1,5},?\s*$/i.test(line)
    || /UNHANDLED REJECTION|unhandledRejection|\bwarn(?:ing)?\b/i.test(line)
    || /failed to (?:connect|reach)|could not connect|connection refused/i.test(line);

  /** Ports owned by datastores/infra — a dev server essentially never binds one. */
  const INFRA_PORTS = new Set([5432, 3306, 27017, 6379, 5672, 9200, 11211, 1433, 9092, 2379]);

  // Tier 1 — an explicit "I am listening" announcement. High confidence.
  const STRONG: RegExp[] = [
    /(?:^|\s)(?:Local|Network):\s*https?:\/\/[^\s]*?:(\d{2,5})/i,        // Vite: "  ➜  Local: http://localhost:5173/"
    /\b(?:listening|running|serving|started|ready)\b[^\n]{0,40}?\bon\b[^\n]{0,20}?\bport\b[:\s]+(\d{2,5})\b/i,
    /\b(?:listening|running|serving|started|ready)\b[^\n]{0,40}?\b(?:on|at)\b[^\n]{0,20}?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|https?:\/\/[^\s:]+):(\d{2,5})/i,
    /\blistening on\b[^\n]*?:(\d{2,5})/i,
  ];
  // Tier 2 — a bare address or a loose "port: N". Only consulted when no announcement was found.
  const WEAK: RegExp[] = [
    /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i,
    /port[:\s]+(\d{2,5})\b/i,
  ];

  // A launch that died with EADDRINUSE bound NOTHING. Any port in that log is the port we collided
  // with, so adopting it is how a dead relaunch gets reported as a live server: the port probe then
  // finds the ORPHANED earlier process still holding it, upgrades the verdict to "up", and a 404ing
  // corpse is published as the user's live preview ("Cannot GET /..."). Fall back to what the caller
  // asked for instead of trusting a number that only appears because we failed.
  if (/EADDRINUSE/i.test(output)) return fallback;

  const lines = output.split('\n').filter((l) => !isErrorLine(l));
  const pick = (patterns: RegExp[], rejectInfra: boolean): number | null => {
    for (const line of lines) {
      for (const re of patterns) {
        const m = re.exec(line);
        if (!m) continue;
        const p = parseInt(m[1], 10);
        if (!(p >= 1 && p <= 65535)) continue;
        // A datastore port from a weak signal is almost certainly a connection string, not our server.
        // It is still honoured when it IS the port we asked for (the caller knows better than we do).
        if (rejectInfra && INFRA_PORTS.has(p) && p !== fallback) continue;
        return p;
      }
    }
    return null;
  };

  return pick(STRONG, false) ?? pick(WEAK, true) ?? fallback;
}

/**
 * Decide whether the port the dev server ACTUALLY bound must be re-probed before the health
 * verdict can be trusted.
 *
 * ROOT CAUSE of a real false-DOWN: the initial liveness poll targets the ASSUMED port, but when the
 * server binds a DIFFERENT port (drift — e.g. a tool that ignores `--port`, or a non-strict server
 * that hopped 5173→5174), a DOWN on the assumed port says nothing about the port the server is
 * really on — yet the health line reports `boundPort`. The old inline guard `portUp && boundPort !==
 * port` only re-probed when the ASSUMED port was already UP, so a drifted-but-healthy server whose
 * assumed port was down got reported "did not come up on port {boundPort}" forever and the agent
 * never published the working port. Re-probe whenever the bound port is a real, DIFFERENT port —
 * independent of the assumed-port result. PURE + unit-testable.
 */
export function shouldReprobeBoundPort(assumedPort: number, boundPort: number): boolean {
  return Number.isInteger(boundPort) && boundPort > 0 && boundPort !== assumedPort;
}

/**
 * E6 — may we SKIP the full `npm run dev` sequence (config patch → pre-kill → launch → 25s port-wait →
 * recovery loop) because a healthy dev server is ALREADY bound on the port?
 *
 * A managed preview re-runs `npm run dev` on every update_preview; when the server is already up, a
 * running Vite/Next dev server picks up file edits via HMR, so relaunching just re-pays ~25s+ of
 * setup for nothing (the Mitrify-class "why is every preview so slow"). Skip ONLY when the port is
 * verifiably UP (a real probe — a false "up" is impossible) AND deps are NOT stale (a changed
 * package.json needs a reinstall + restart, which HMR can't do). On any doubt this returns false and
 * the full, proven sequence runs — today's behaviour, never worse. Pure + unit-testable.
 */
export function shouldSkipDevServerLaunch(portAlreadyUp: boolean, depsStale: boolean): boolean {
  return portAlreadyUp === true && depsStale !== true;
}

/**
 * Poll a TCP port until it is listening, returning the MOMENT it comes up instead
 * of sleeping a fixed wall-clock budget. A Vite/Next server that boots in 3 s no
 * longer costs the full fixed wait — across the many dev-server (re)starts in a
 * build this is the single biggest wall-clock saving and is what keeps long builds
 * under the watchdog cap.
 *
 * Emits `PORT_UP` on the first successful `nc -z` and exits early; emits
 * `PORT_DOWN` only after `maxSeconds` of 1 s polls. `maxSeconds` is clamped to a
 * sane floor so a bad caller can never produce a zero-iteration (instant-DOWN)
 * loop. PURE string builder — unit-testable without the E2B SDK.
 */
/**
 * Fix 42 — a STRICT HTTP liveness check (a real HTTP response, not just a TCP-open port). Used only
 * to corroborate a "PORT_UP" when the dev log showed the runner binary was not found: a stale process
 * or the sandbox proxy answers a TCP connect but not real HTTP, so this tells a genuinely-serving
 * prior attempt apart from a false positive. Emits HTTP_OK / HTTP_DOWN. Pure (returns a command).
 */
export function buildHttpLivenessCommand(port: number): string {
  return `if curl -s -o /dev/null --max-time 3 http://127.0.0.1:${port} 2>/dev/null; then echo HTTP_OK; else echo HTTP_DOWN; fi`;
}

export function buildPortWaitCommand(port: number, maxSeconds: number): string {
  const iterations = Math.max(1, Math.floor(maxSeconds));
  // Tool-agnostic, IPv4-forced liveness check. The old `nc -z localhost` check read a HEALTHY dev
  // server as DOWN in two real cases: (1) the sandbox image has no `nc` (netcat) → every poll fails;
  // (2) `localhost` resolves to IPv6 ::1 while Vite binds IPv4 0.0.0.0 → connection refused. Either
  // made the live preview "never come up" even though the server was ready. Now try nc, then curl,
  // then bash's /dev/tcp — all against 127.0.0.1 — so ANY one succeeding marks the port UP.
  const check = `nc -z 127.0.0.1 ${port} 2>/dev/null || curl -s -o /dev/null --max-time 2 http://127.0.0.1:${port} 2>/dev/null || (exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null`;
  return `for i in $(seq 1 ${iterations}); do if ${check}; then echo PORT_UP; exit 0; fi; sleep 1; done; echo PORT_DOWN`;
}
