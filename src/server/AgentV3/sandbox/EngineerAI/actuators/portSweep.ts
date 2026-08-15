// SMART PREVIEW PORT — when the port we expected is silent, find the one the app is REALLY on.
//
// ADMIN 2026-08-15: "preview port ko smart switch banao, ek port par hard fix nahi rakho — ek jagah
// nahi chale to dusre par try karo."
//
// WHAT ALREADY EXISTS, and is deliberately NOT rebuilt here. `pinDevServerPort` pins a port before
// launch, and `detectDevPort` reads the port the server ANNOUNCED out of its own log — line-based,
// tiered, and careful enough to ignore a `ECONNREFUSED …:5432` in a stack trace (the mitrify autopsy).
// That work is good and this module sits strictly after it.
//
// THE GAP IT CLOSES. Both of those need the server to cooperate: pinning needs the launch to go
// through the managed path, and detection needs the log to contain a recognisable announcement. When
// neither holds, `detectDevPort` returns the FALLBACK — the port we merely assumed — and a single
// probe of that one port decides the verdict. A server alive on any other port is reported dead.
//
// That is not hypothetical. In the 35.8-minute build of 2026-08-15 the model launched the dev server
// itself with `timeout 20 npm run dev 2>&1 || true` — piped, so the pinning helpers correctly skipped
// it — the app came up on 3000, the framework had been detected as `vite-react` so the platform
// watched 5173, and the preview stayed blank while a perfectly healthy server was running one port
// away. The model then spent its last ten minutes trying to MOVE the working server to 5173.
//
// DESIGN CONSTRAINTS, both from that same report:
//   • ONE sandbox command, never one per port. That build measured a bare `ls -la` at 116 SECONDS on a
//     degraded sandbox; a ten-port sweep at one round trip each could cost longer than the build.
//   • A REAL HTTP response, never a bare TCP open. The Fix-42 report showed a stale/zombie process (or
//     the sandbox proxy) holding a port and reading as "up" while the log said `vite: not found` —
//     shipping a false "the dev server is UP" and a "preview verified" on an app that never started.
//   • ONLY on failure. When the expected port answers, nothing here runs and the happy path is
//     byte-for-byte unchanged.

/**
 * Ports a dev server realistically lands on, most likely first.
 *
 * Ordered by what actually shows up in this platform's builds rather than by framework popularity:
 * 3000 (Node/Express, Next, Nuxt, and the platform's own default) and 5173 (Vite) dominate, then 5000
 * — which is BOTH the Replit-style fullstack default and the port the mitrify import used — then the
 * long tail. The list is deliberately short: every extra port is time spent on a sandbox that is
 * already, by the time we are sweeping, behaving badly.
 */
export const COMMON_DEV_PORTS: readonly number[] = [3000, 5173, 5000, 8080, 4200, 8000, 3001, 4321, 1420, 5174];

/** A port number that could plausibly be a dev server. */
export function isUsablePort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536;
}

/**
 * The ports to try, in order: the one we expected FIRST, then the common ones.
 *
 * The expected port leads even though it has just failed a probe — a server that is slow to bind may
 * answer by the time the sweep runs, and re-confirming the port we already believe in is the cheapest
 * possible correct answer. Duplicates are removed so a candidate is never probed twice.
 */
export function portCandidates(expected?: number, extra: readonly number[] = []): number[] {
  const out: number[] = [];
  const push = (p: unknown) => { if (isUsablePort(p) && !out.includes(p)) out.push(p); };
  push(expected);
  for (const p of extra) push(p);
  for (const p of COMMON_DEV_PORTS) push(p);
  return out;
}

/** What the sweep prints when it finds a live server. Parsed, so it must be unambiguous in a noisy log. */
export const SWEEP_HIT = 'NB_PORT_LIVE=';
export const SWEEP_MISS = 'NB_PORT_NONE';

/**
 * ONE shell command that probes every candidate and stops at the first REAL HTTP responder.
 *
 * `curl -s -o /dev/null` succeeds on any HTTP status, which is what we want: a dev server answering
 * 404 on `/` is still unambiguously a running dev server, and demanding 200 would reject apps whose
 * root path is not a page. `--max-time 2` per port bounds the whole sweep at roughly
 * 2 × candidates seconds even when every port black-holes.
 *
 * The loop breaks on the first hit, so the common case (the app is on the first or second candidate)
 * costs a fraction of the worst case.
 */
export function buildPortSweepCommand(ports: readonly number[]): string {
  const usable = ports.filter(isUsablePort);
  // No candidates is not a command — returning an empty string would run the shell's own idea of
  // nothing and read as a miss. Say MISS explicitly instead.
  if (usable.length === 0) return `echo ${SWEEP_MISS}`;
  const list = usable.join(' ');
  return `for p in ${list}; do if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$p" 2>/dev/null; then echo "${SWEEP_HIT}$p"; exit 0; fi; done; echo ${SWEEP_MISS}`;
}

/**
 * The live port the sweep found, or null.
 *
 * Strict on purpose. This answer re-points the user's preview, so a number scraped out of unrelated
 * log noise would send them to a URL that shows nothing — the very failure this module exists to end.
 * Only our own marker counts, and only when it carries a usable port.
 */
export function parsePortSweep(stdout: string | null | undefined): number | null {
  if (typeof stdout !== 'string' || !stdout) return null;
  const m = stdout.match(new RegExp(`${SWEEP_HIT}(\\d{1,5})\\b`));
  if (!m) return null;
  const port = Number.parseInt(m[1], 10);
  return isUsablePort(port) ? port : null;
}

/**
 * Should a sweep run at all?
 *
 * The whole point is that it is FREE on a healthy build: a server answering where we expected costs
 * nothing extra, and only a genuine miss pays for the scan.
 */
export function shouldSweep(expectedPortUp: boolean): boolean {
  return !expectedPortUp;
}

/**
 * The honest line for the build report when a sweep changed the answer.
 *
 * It names both ports, because "we looked in the wrong place" is a materially different fact from
 * "your app was broken" — and for ten minutes of that build, the engine believed the second one.
 */
export function sweepFoundSummary(expected: number | null, found: number): string {
  return expected && expected !== found
    ? `Your app is running on port ${found}, not the ${expected} this project's framework normally uses — the preview now points at ${found}.`
    : `Your app is running on port ${found} — the preview now points at it.`;
}
