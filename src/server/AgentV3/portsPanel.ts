// B2 — "what is actually running, and on which port" (ROADMAP §8B).
//
// `serviceGraph.ts` already answers what a project SHOULD consist of. Nothing answered what is actually
// UP. That gap is why a half-started project is so confusing: the frontend renders, its API calls fail,
// and the app looks broken in a way that sends the repair loop rewriting perfectly good code — when the
// real fact is simply "the backend is not listening".
//
// 🔒 REAL STATE ONLY (absolute rule 2). Every status is measured in the sandbox at the moment it is
// asked for. A service the graph EXPECTS is shown as expected-and-not-listening, never as "running"
// because a config file said it would be. Faking a green dot here would be worse than having no panel:
// it would send the user hunting a bug that is not there.
//
// ⚠️ THE PORT SCAN IS **NOT** REIMPLEMENTED HERE. `PortDiscovery.ts` already asks the sandbox which TCP
// ports are listening (LISTENING_PORTS_COMMAND + parseListeningPorts), and it is the version that has
// run in production. A first draft of this module hand-rolled a second /proc/net/tcp parser; the
// compiler caught the duplicate name, which is the only reason it was caught at all. Two parsers of the
// same kernel file is exactly the drift root-cause rule 2 exists to prevent — so this module imports
// that one and adds only what is genuinely new: the process list and the expected-vs-real join.

import { LISTENING_PORTS_COMMAND, isInfraPort } from './PortDiscovery';
import type { Service } from './serviceGraph';

/** Marker so one round trip carries both halves — a second sandbox command is billed VM time. */
const PROCS_MARK = 'NBAI_PROCS:';

/**
 * The probe: the proven listening-ports command, plus a process list.
 *
 * `ps` is best-effort on purpose. If the image lacks it the process list is simply empty, which reads
 * honestly as "we could not list processes" and never contradicts the port evidence — the ports are the
 * load-bearing half and they come from /proc via the shared command.
 */
export function buildServicesProbeCommand(): string {
  return `${LISTENING_PORTS_COMMAND}; echo '${PROCS_MARK}'; ps -eo pid,args --no-headers 2>/dev/null | head -60`;
}

export interface RunningProcess {
  pid: number;
  command: string;
}

/** Everything after the process marker. Tolerates the marker being absent. Pure. */
export function splitProcsSection(stdout: string | null | undefined): string {
  const s = String(stdout ?? '');
  const at = s.indexOf(PROCS_MARK);
  return at < 0 ? '' : s.slice(at + PROCS_MARK.length);
}

/**
 * Parse `ps -eo pid,args`. Keeps only what a user could act on — their app's own processes — because a
 * list including the sandbox's own shell, `ps` itself and this very probe is noise that makes the panel
 * look busy while saying nothing. Pure.
 */
export function parseProcessList(raw: string | null | undefined): RunningProcess[] {
  const out: RunningProcess[] = [];
  for (const line of String(raw ?? '').split('\n')) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const command = m[2];
    if (!/\b(node|npm|pnpm|yarn|bun|deno|vite|next|nest|python3?|uvicorn|gunicorn|flask|java|go|air)\b/i.test(command)) continue;
    // Our own probe (which is a `node -e` one-liner) and the shell that ran it are not the user's app.
    if (/\bps -eo\b|\/proc\/net\/tcp|NBAI_|LISTENING:/.test(command)) continue;
    out.push({ pid: Number.parseInt(m[1], 10), command: command.slice(0, 200) });
  }
  return out;
}

export type ServiceStatus = 'listening' | 'not_listening' | 'no_port';

export interface ServiceRow {
  id: string;
  name: string;
  kind: string;
  port: number | null;
  status: ServiceStatus;
  /** One plain sentence a non-technical user can act on. Never blank. */
  note: string;
}

/**
 * Join what the project EXPECTS (the service graph) with what is REALLY listening.
 *
 * The three statuses stay distinct because they need different actions, and collapsing them is what
 * makes a ports panel useless:
 *   • listening      — it is up.
 *   • not_listening  — it should be up and is not. THIS is the row that explains a "broken" app.
 *   • no_port        — a worker or cron job never opens a port, so "not listening" would be a false
 *                      alarm about a service that is working perfectly. serviceGraph's null port is
 *                      load-bearing for exactly this reason.
 * Pure.
 */
export function mergeServiceStatus(services: readonly Service[], listening: readonly number[]): ServiceRow[] {
  const up = new Set(listening);
  return (services ?? []).map((s) => {
    if (s.port == null) {
      return { id: s.id, name: s.name, kind: s.kind, port: null, status: 'no_port' as const, note: 'Background job — it does not use a port, so there is nothing to check here.' };
    }
    return up.has(s.port)
      ? { id: s.id, name: s.name, kind: s.kind, port: s.port, status: 'listening' as const, note: `Running on port ${s.port}.` }
      : { id: s.id, name: s.name, kind: s.kind, port: s.port, status: 'not_listening' as const, note: `Not running. This part of your app is expected on port ${s.port} — if the app looks broken, this is probably why.` };
  });
}

export interface ExtraPort {
  port: number;
  /** What it most likely is, in the user's terms. Never "unknown port 5432" when we know it is a database. */
  label: string;
}

/**
 * Listening ports that belong to no service in the graph. Worth showing rather than hiding: a database,
 * a preview proxy, or something the user started in the terminal is real, and a panel that omitted it
 * would be quietly incomplete.
 *
 * Infrastructure is NAMED using PortDiscovery's own list (isInfraPort) rather than a second copy — so a
 * listening 5432 reads as "your database", not as a mysterious extra process the user might go and kill.
 * Pure.
 */
export function extraPorts(services: readonly Service[], listening: readonly number[]): ExtraPort[] {
  const expected = new Set((services ?? []).map((s) => s.port).filter((p): p is number => p != null));
  return (listening ?? [])
    .filter((p) => !expected.has(p))
    .map((port) => ({ port, label: isInfraPort(port) ? 'Part of your app’s infrastructure (for example its database).' : 'Something else is using this port.' }));
}

/** The panel's one-line summary. Never a bare count — a count alone tells a user nothing. Pure. */
export function portsSummary(rows: readonly ServiceRow[], listening: readonly number[]): string {
  const down = rows.filter((r) => r.status === 'not_listening');
  if (down.length > 0) {
    const names = down.map((r) => r.name).join(', ');
    return `${down.length === 1 ? 'One part' : `${down.length} parts`} of your app ${down.length === 1 ? 'is' : 'are'} not running: ${names}.`;
  }
  if (rows.some((r) => r.status === 'listening')) return 'Everything your app needs is running.';
  if (listening.length > 0) return 'Your app is not running, but something else is using the sandbox.';
  return 'Nothing is running right now.';
}
