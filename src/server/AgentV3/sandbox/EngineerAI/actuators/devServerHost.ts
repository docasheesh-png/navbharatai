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
  return `for i in $(seq 1 ${iterations}); do nc -z localhost ${port} 2>/dev/null && { echo PORT_UP; exit 0; }; sleep 1; done; echo PORT_DOWN`;
}
