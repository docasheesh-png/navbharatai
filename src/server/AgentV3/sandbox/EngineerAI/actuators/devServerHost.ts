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
 * `fuser -k {port}/tcp` is precise (targets exactly whatever holds that port).
 * Everything is `|| true`-guarded so a missing tool or an already-free port never
 * makes the step fail. PURE string builder so it is unit-testable without E2B.
 */
export function buildPreKillPortCommand(port: number): string {
  return `fuser -k ${port}/tcp 2>/dev/null; pkill -f "node.*:${port}" 2>/dev/null; true`;
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
