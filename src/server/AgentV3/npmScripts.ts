// READING AN npm SCRIPT — the ONE parser, shared by everything that asks a package.json about ports.
//
// 🔴 WHY THIS EXISTS AS ITS OWN FILE (autopsy `1a7f4a58`, 2026-09-18). Four separate modules read a
// port out of a script's command text, and every one of them read ONE command and stopped:
// `declaredPort.fromScripts`, `serviceGraph.portForService`, `DevServerRecovery.scriptPort` and
// `E2BActuator`. None followed `npm run`.
//
// That mattered because the normal way to write a full-stack dev script is to delegate:
//
//     "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\""
//
// The app's explicit `--port 5173` lives in `dev:client`. Every reader saw `dev`, found no port, and
// concluded the app declared nothing — so the platform killed the app's own web server to bless its
// own API, and the preview served `Cannot GET /`.
//
// This repo has paid for the drifted-copy class more than once (four `safeRelPath`s, two complex-app
// detectors), so the parser lives in ONE place and the readers import it. Adding a delegation form
// here fixes every caller at once, by construction.
//
// PURE — strings in, answers out. No I/O, never throws.

/**
 * How deep a `npm run` chain is followed. Three covers every real shape seen
 * (`dev` → `dev:client` → a tool) and bounds a pathological package.json by construction.
 */
export const MAX_SCRIPT_DEPTH = 3;

/** Ports below 1024 are never an app's own dev server, so a stray match cannot mislead a caller. */
export function usablePort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port > 1023 && port < 65536;
}

/** Every `--port N` / `-p N` / `PORT=N` in ONE command string, in the order they appear. */
export function portsInCommand(command: string): number[] {
  const out: number[] = [];
  const patterns = [/(?:--port[= ]|(?:^|\s)-p\s+)(\d{2,5})\b/g, /\bPORT=(\d{2,5})\b/g];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(command)) !== null) {
      const n = Number(m[1]);
      if (usablePort(n)) out.push(n);
    }
  }
  return out;
}

/**
 * Script names this command delegates to.
 *
 * 🔒 Deliberately only the `run`-prefixed forms plus `npm-run-all` / `run-p` / `run-s`: a bare
 * `yarn <word>` would read `yarn add express` as a script called "add". Inventing a delegation is how
 * a port reader starts answering about something that is not the app, so the safe direction here is
 * to miss a form rather than to guess one.
 */
export function delegatesTo(command: string): string[] {
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
 * Walk an entry script and everything it delegates to, newest frame first.
 *
 * Calls `visit(scriptName, command)` once per reachable script. Cycle-safe (a script is visited at
 * most once) and depth-bounded, so a package.json that references itself cannot loop.
 */
export function walkScript(
  scripts: Record<string, string>,
  entry: string,
  visit: (name: string, command: string) => void,
  seen: Set<string> = new Set(),
  depth = 0,
): void {
  if (depth > MAX_SCRIPT_DEPTH || seen.has(entry)) return;
  seen.add(entry);
  const command = typeof scripts?.[entry] === 'string' ? scripts[entry] : '';
  if (!command) return;
  visit(entry, command);
  for (const next of delegatesTo(command)) walkScript(scripts, next, visit, seen, depth + 1);
}
