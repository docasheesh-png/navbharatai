// AgentV3 — Port Discovery: the evidence-first "flip system" (admin 2026-08-07: "ek par na chale to
// dusra, dusre par na chale to teesra?").
//
// The admin's instinct is right — one guess must never be the end of the story. But a BLIND cascade
// ("try 3000, then 5000, then 8080…") is still guessing, just more times, and each wrong guess costs
// a timeout. The stronger form: ask the sandbox OS which TCP ports are ACTUALLY LISTENING (that list
// is a fact, not a guess), rank the candidates, then VISIT each one and publish only the port whose
// page really renders the app — the same earn-the-verdict rule everything else follows.
//
// /proc/net/tcp is used because it exists on every Linux and needs no tools (`ss`/`netstat` are not
// guaranteed in a slim sandbox image; node IS, since we just ran npm). State 0A = LISTEN.
//
// PURE: command string + parsers + ranking here; the route runs the command and does the visiting.

/** Prints a comma-separated list of listening TCP ports inside the sandbox (IPv4+IPv6, deduped). */
export const LISTENING_PORTS_COMMAND =
  `node -e '` +
  `const fs=require("fs");const s=new Set();` +
  `for(const f of["/proc/net/tcp","/proc/net/tcp6"]){` +
  `try{for(const ln of fs.readFileSync(f,"utf8").split("\\n").slice(1)){` +
  `const p=ln.trim().split(/\\s+/);` +
  `if(p[3]==="0A")s.add(parseInt(p[1].split(":")[1],16));` +
  `}}catch{}}` +
  `console.log("LISTENING:"+[...s].sort((a,b)=>a-b).join(","))'`;

/** Parse the command's output back into ports. Tolerates noise around the marker line. PURE. */
export function parseListeningPorts(stdout: string | null | undefined): number[] {
  const m = String(stdout ?? '').match(/LISTENING:([\d,]*)/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 65535);
}

/**
 * Ports that are INFRASTRUCTURE, never the user's app — the provisioned PostgreSQL (5432) is
 * listening in the exact sandboxes this discovery runs in, and publishing it as "the app" would be
 * worse than finding nothing. SSH/DNS + the common DB engines are excluded for the same reason.
 */
const INFRA_PORTS = new Set([22, 53, 5432, 3306, 27017, 6379, 9229]);

/**
 * Is this port infrastructure rather than the user's app? Exported (B2) so the ports panel can LABEL a
 * listening 5432 as "your database", instead of showing it as a mysterious extra process — the same
 * knowledge, one source, rather than a second list that drifts.
 */
export function isInfraPort(port: number): boolean {
  return INFRA_PORTS.has(port);
}

/** Common dev-server ports, in rough order of likelihood across the frameworks we build. */
const COMMON_DEV_PORTS = [3000, 5173, 5000, 8080, 4000, 8000, 4200, 5174];

/** The port a given framework's dev server uses by default — moved to the front of the blind tail. */
const FRAMEWORK_DEFAULT_PORT: Record<string, number> = {
  'node-express': 5000,
  express: 5000,
  'vite-react': 5173,
  vite: 5173,
  react: 3000,
  next: 3000,
  nextjs: 3000,
  nuxt: 3000,
  svelte: 5173,
  sveltekit: 5173,
  vue: 5173,
  angular: 4200,
  astro: 4321,
};

export const MAX_PORT_CANDIDATES = 4;

/**
 * The ordered list of ports worth VISITING — strongest evidence first:
 *   1. the port the boot log itself named (the app's own testimony),
 *   2. the dev script's declared --port,
 *   3. the expected/pinned port,
 *   4. every OTHER genuinely-listening port (common dev ports first, then ascending) — this is the
 *      flip: when the app landed somewhere nobody predicted, the OS still knows, and we follow it,
 *   5. LAST RESORT — the well-known dev ports even when nothing was observed listening.
 *
 * TIER 5 EXISTS BECAUSE EVIDENCE CAN BE ABSENT (admin 2026-08-10: "port 3000 par nahi chale to port
 * 5000 par try kiya jayega"). Tier 4 is strictly better than guessing — but it produces NOTHING when
 * the listening scan cannot run, comes back empty, or simply runs a moment before the server finishes
 * binding. In that case the flip had no second candidate at all and the preview stayed pinned to a
 * dead port, which is the very failure it exists to prevent. So after every piece of real evidence is
 * exhausted, the familiar ports are tried anyway — a bounded guess is better than a certain dead end.
 * The framework's own default leads that tail, so a node-express app reaches 5000 before it reaches
 * a Vite port. Ordering guarantees this never OVERRIDES evidence: it only fills the space evidence
 * left empty.
 *
 * Deduped, infra ports removed, bounded. Never empty when any input port exists. PURE.
 */
export function rankPortCandidates(opts: {
  parsed: number | null;
  scriptPort: number | null;
  expected: number | null;
  listening: number[];
  /** Optional hint so the last-resort tail starts with this framework's own default port. */
  framework?: string | null;
}): number[] {
  const out: number[] = [];
  const push = (p: number | null | undefined): void => {
    if (typeof p === 'number' && Number.isInteger(p) && p > 0 && p <= 65535 && !INFRA_PORTS.has(p) && !out.includes(p)) out.push(p);
  };
  push(opts.parsed);
  push(opts.scriptPort);
  push(opts.expected);
  const listening = (opts.listening ?? []).filter((p) => !INFRA_PORTS.has(p));
  for (const p of COMMON_DEV_PORTS) if (listening.includes(p)) push(p);
  for (const p of listening) push(p);
  // Tier 5 — the bounded guess, only ever reaching ports evidence did not already supply.
  //
  // GATED ON HAVING ANY EVIDENCE AT ALL. With not one port from any source, nothing booted anywhere
  // and there is nothing to flip TO — guessing there would spend four browser visits proving a dev
  // server that never started is still not running. The tail is for "the app IS up, just not where we
  // looked", which is the case the admin described.
  if (out.length > 0) {
    push(FRAMEWORK_DEFAULT_PORT[(opts.framework ?? '').trim().toLowerCase()]);
    for (const p of COMMON_DEV_PORTS) push(p);
  }
  return out.slice(0, MAX_PORT_CANDIDATES);
}
