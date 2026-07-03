// AgentV3 — deterministic guarantee that a Vite config never blocks the E2B preview host.
//
// Newer Vite (5.4+) enforces a `server.allowedHosts` check: a request whose Host header is not in
// the list is rejected with
//     Blocked request. This host ("<port>-<id>.e2b.app") is not allowed.
//     To allow this host, add "<host>" to `server.allowedHosts` in vite.config.js.
// The E2B preview is served through exactly such a host (`5173-<sandbox>.e2b.app`), so a Vite app
// whose config omits `allowedHosts` shows that error INSTEAD of the app.
//
// NavBharatAI's own scaffolds already set `allowedHosts: true`, and the system prompt tells the build
// agent to keep it — but a prompt is advisory and the model has shipped configs without it (a full
// rewrite of vite.config that drops the server block). This module is the deterministic backstop,
// mirroring ScaffoldGuard: a PURE, unit-testable transform that injects `allowedHosts: true` into a
// Vite config that lacks it. Conservative by design — it only edits a file it is confident it can
// edit safely, and is a NO-OP everywhere else (a corrupted config would be worse than the error).

/** True for a Vite config filename: vite.config.ts / .js / .mjs / .cjs / .mts / .cts (any directory). */
export function isViteConfigPath(path: string): boolean {
  return /(^|\/)vite\.config\.(c|m)?[jt]s$/.test((path || '').trim());
}

/**
 * Return `content` with a guaranteed `server.allowedHosts: true` for a Vite config, or unchanged when
 * it is not a Vite config, already sets `allowedHosts`, or has no anchor this function can edit safely.
 * PURE & deterministic.
 */
export function ensureViteAllowedHosts(path: string, content: string): string {
  if (!isViteConfigPath(path)) return content;
  const src = content ?? '';
  // Already handled anywhere (server or preview block) — never double-inject.
  if (/\ballowedHosts\b/.test(src)) return src;

  // Case 1: an existing `server: { … }` block — add allowedHosts as its first key.
  const serverBlock = /(\bserver\s*:\s*\{)/;
  if (serverBlock.test(src)) {
    return src.replace(serverBlock, '$1 allowedHosts: true,');
  }

  // Case 2: no server block — inject a fresh one at the start of the exported config object.
  // Prefer defineConfig({ … }); fall back to a bare `export default { … }` object literal. The
  // function form (`defineConfig(() => ({ … }))`) and other exotic shapes are intentionally left
  // untouched (Case 3) — a wrong injection would break the build worse than the host error.
  const defineConfigObj = /(defineConfig\s*\(\s*\{)/;
  if (defineConfigObj.test(src)) {
    return src.replace(defineConfigObj, '$1 server: { host: true, allowedHosts: true },');
  }
  const defaultObj = /(export\s+default\s*\{)/;
  if (defaultObj.test(src)) {
    return src.replace(defaultObj, '$1 server: { host: true, allowedHosts: true },');
  }

  // Case 3: no safe anchor — leave the file untouched (the system prompt still guides the agent).
  return src;
}
