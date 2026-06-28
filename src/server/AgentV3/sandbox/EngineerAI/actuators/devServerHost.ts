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
