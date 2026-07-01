/**
 * Force a dev server to listen on 0.0.0.0 so it is reachable through the E2B
 * sandbox's external preview URL (e.g. `{port}-{id}.e2b.app`). A localhost-only
 * bind (the Vite/Next default when a config does not set host:true) passes a local
 * `nc -z localhost` health check but returns 502/blank on the PUBLIC preview — the
 * #1 cause of "files built but the preview is blank".
 *
 * This is the v3.0-local copy of the helper (the legacy EngineerAI engine has its
 * own); kept self-contained so the v3.0 actuator never depends on the retired
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

export function ensureHostBinding(command: string): string {
  if (!command) return command;
  // Already binds a host (any interface / explicit flag) — leave untouched.
  if (/--host|-H\b|HOST=|0\.0\.0\.0/.test(command)) return command;
  // Next.js dev server.
  if (/\bnext\b/.test(command)) return `${command} -H 0.0.0.0`;
  // Vite invoked directly.
  if (/\bvite\b/.test(command)) return `${command} --host 0.0.0.0`;
  // Vite via a package-manager script (npm/pnpm/yarn/bun run dev|serve): pass the
  // host flag through to the underlying tool with `--`. `start` is intentionally
  // excluded — it is ambiguous with CRA, which needs HOST= instead of --host.
  if (/\b(?:npm|pnpm|yarn|bun)\b.*\b(?:run\s+)?(?:dev|serve)\b/.test(command)) {
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
export function isLongRunningCommand(command: string): boolean {
  if (!command) return false;
  if (/^\s*(?:curl|wget)\b/.test(command)) return false;
  // One-shot process-inspection/management commands are NEVER a dev-server start, even when they
  // reference "vite" as a filter/pattern — e.g. `pkill -f "vite"`, `ps aux | grep vite`, a piped
  // `grep -E "vite|node" | head -10`. Matching "vite" as a bare substring (below) previously caught
  // these too, routing a kill/inspect command into the background-dev-server-start path: it force-
  // killed the port, then tried to "launch" the mangled command with dev-server flags appended
  // (`ensureHostBinding`/`pinDevServerPort`), which pkill/ps/grep/head reject as unrecognized options
  // — the process management the agent actually asked for silently failed, so a server the agent
  // tried to stop/inspect kept getting reported as "not responding — restarting…" after a ~45s port-
  // wait, and the agent looped: restart dev server, try to verify/kill it, get corrupted output,
  // restart again. Confirmed against a real build report (repeated `pkill: unrecognized option
  // '--host'` / `grep: unrecognized option '--host'` / `head: unrecognized option '--host'`).
  if (/^\s*(?:sleep\s+\d+\s*&&\s*)?(?:pkill|pgrep|ps|kill|grep|netstat|lsof|fuser|ss|head|tail|wc|find|which|echo|cat)\b/i.test(command)) return false;
  // Any Vite invocation is a dev/preview server EXCEPT `vite build` (compiles then exits).
  const isVite = /\bvite(?:\.js)?\b/i.test(command) && !/\bvite(?:\.js)?\b[^\n]*\bbuild\b/i.test(command);
  return (
    isVite ||
    /\b(?:dev|serve|watch|livereload)\b/i.test(command) ||
    /npm\s+run\s+(?:dev|start|serve)\b/i.test(command) ||
    /python.*http\.server|http-server|live-server/i.test(command) ||
    /\buvicorn\b|\bgunicorn\b|\bflask\s+run\b/i.test(command) ||
    // Shell scripts that wrap dev servers (Django, Flask, FastAPI dev.sh)
    /^\s*(?:bash|sh)\s+\S*dev\.sh\b/i.test(command) ||
    // Framework-specific CLIs
    /\bng\s+serve\b/i.test(command) ||            // Angular CLI
    /\bnext\s+dev\b/i.test(command) ||             // Next.js direct
    /\bnuxt\s+dev\b/i.test(command) ||             // Nuxt direct
    /\bastro\s+dev\b/i.test(command)               // Astro direct
  );
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
 * Shell test that prints `STALE` when dependencies need (re)installing — node_modules is
 * missing, or package.json has been edited since the last install (a newly-declared dep like
 * `tailwindcss` is not yet on disk). Used to gate `npm install` before a build AND before a dev
 * server starts, so the server never crashes with "Cannot find module 'tailwindcss'". Ends in
 * `true` so a clean tree exits 0. PURE string builder — unit-testable without E2B.
 */
export function buildDepsStaleCheckCommand(): string {
  return '[ ! -d node_modules ] || [ package.json -nt node_modules ] && echo STALE || true';
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
export function pinDevServerPort(command: string, port: number): string {
  if (!command) return command;
  if (/--port[=\s]|[\s]-p[\s]/.test(command)) return command; // already pinned — respect it
  if (/\bnext\b/.test(command)) return `${command} -p ${port}`;
  // Bare `vite`, OR a package-manager dev/serve script (npm/pnpm/yarn/bun run dev|serve),
  // which the v3.0 scaffold uses for Vite — the same pm-script ⇒ vite assumption
  // ensureHostBinding already makes when it appends `--host`.
  if (/\bvite\b/.test(command) || /\b(?:npm|pnpm|yarn|bun)\b.*\b(?:run\s+)?(?:dev|serve)\b/.test(command)) {
    return `${command} --port ${port} --strictPort`;
  }
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
  const patterns = [
    /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i,   // Local: http://localhost:5174/
    /running on port (\d{2,5})/i,
    /listening on\b[^\n]*?:(\d{2,5})/i,
    /port[:\s]+(\d{2,5})\b/i,
  ];
  for (const re of patterns) {
    const m = output.match(re);
    if (m) {
      const p = parseInt(m[1], 10);
      if (p >= 1 && p <= 65535) return p;
    }
  }
  return fallback;
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
