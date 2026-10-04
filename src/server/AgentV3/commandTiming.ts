/**
 * ⏱️ WHERE A SLOW COMMAND'S TIME WENT (queue Q-273, autopsy 241215d1, 2026-10-04).
 *
 * `python3 --version && which python3` was recorded as `exit 0 (11s)` on a sandbox that had answered a
 * `head -50` in one second a minute earlier. The report carried only the total, and the total is the
 * sum of four different things, any one of which could have been the 11 seconds:
 *   1. our own steps BEFORE the command (the vault `.env` write and its key checks, the local Postgres
 *      preflight, a package.json read for version pins) — all inside the bash tool's timer;
 *   2. reaching the machine (`getSandbox`: a reconnect, or resuming a paused sandbox);
 *   3. the command itself on the machine;
 *   4. our own steps AFTER it (recording files the command wrote, the Prisma/format retries).
 * A slow (1) or (4) is our bug, a slow (2) is a resume, a slow (3) is the machine — three different
 * fixes. So a command that takes long enough to matter now says which, in the same report line.
 *
 * PURE. The numbers come from the dispatcher (1, 4) and the actuator (2, 3); an actuator that reports
 * no timing (the local one) leaves the line exactly as it was.
 */

/** What the actuator measured: reaching the machine, and the command on it. */
export interface ActuatorCommandTiming {
  sandboxMs: number;
  runMs: number;
}

/** The whole split: the dispatcher adds its own time before the command. */
export interface CommandTiming extends ActuatorCommandTiming {
  setupMs: number;
}

/** Below this the split is noise; a report has hundreds of one-second commands. */
export const SLOW_COMMAND_SPLIT_MS = 5_000;

function secs(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

function valid(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * The report's split of a slow command, e.g. ` — our setup 0.2s · sandbox 9.4s · command 1.3s · our
 * checks after 0.1s`. Empty for a fast command, a missing or unreadable timing, or no total. The parts
 * are measured, never derived to look right: "after" is the only remainder, and a negative remainder
 * (clocks read in a different order) is shown as 0. PURE.
 */
export function commandTimingText(timing: Partial<CommandTiming> | null | undefined, totalMs: number | null | undefined): string {
  if (!timing || !valid(totalMs) || totalMs < SLOW_COMMAND_SPLIT_MS) return '';
  const { setupMs, sandboxMs, runMs } = timing;
  if (!valid(setupMs) || !valid(sandboxMs) || !valid(runMs)) return '';
  const afterMs = Math.max(0, totalMs - setupMs - sandboxMs - runMs);
  return ` — our setup ${secs(setupMs)} · sandbox ${secs(sandboxMs)} · command ${secs(runMs)} · our checks after ${secs(afterMs)}`;
}
