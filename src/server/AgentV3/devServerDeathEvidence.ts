// AgentV3 — the dev server's last words, read before it is restarted.
//
// 🔴 WHY (autopsy ac41a924, 2026-09-23; recorded OPEN twice before: "why the dev server died between
// the first render and the runtime check is not in the report — no process log"). The platform
// restarts a stopped preview server deterministically, which is right, and it records THAT it did —
// but the server's own output, which is the only thing that could say WHY it stopped (a crash, an
// install swapping node_modules under it, an out-of-memory kill), was never read. Every such report
// could only guess. The dev server already writes everything it prints to DEV_SERVER_LOG_PATH; this
// reads the tail of it once, just before the restart overwrites the picture, and puts it in the
// admin report beside the restart.
//
// Evidence only: it never decides anything, and a failed read yields null, never an error.

import { DEV_SERVER_LOG_PATH } from './sandbox/EngineerAI/actuators/devServerHost';

const TAIL_LINES = 15;
const MAX_LINE_CHARS = 200;
const MAX_TOTAL_CHARS = 1200;

/** The one command that reads the tail. Never fails (the `|| true`), so it cannot turn into an error. */
export function devServerTailCommand(logPath: string = DEV_SERVER_LOG_PATH): string {
  return `tail -n ${TAIL_LINES} ${logPath} 2>/dev/null || true`;
}

/**
 * The tail as one bounded report line, or null when there is nothing to say. PURE.
 * Blank lines are dropped and each line is capped, so one enormous stack line cannot flood the report.
 */
export function formatDevServerTail(stdout: string | null | undefined): string | null {
  const lines = String(stdout ?? '')
    .split('\n')
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trimEnd())
    .filter((l) => l.trim().length > 0)
    .map((l) => (l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)}…` : l));
  if (lines.length === 0) return null;
  const joined = lines.join(' ⏎ ');
  return joined.length > MAX_TOTAL_CHARS ? `…${joined.slice(joined.length - MAX_TOTAL_CHARS)}` : joined;
}

/** Read and format the tail through any command runner. Never throws; null when unreadable. */
export async function readDevServerLastWords(
  run: (command: string) => Promise<{ stdout?: string | null }>,
): Promise<string | null> {
  try {
    const r = await run(devServerTailCommand());
    return formatDevServerTail(r?.stdout);
  } catch {
    return null;
  }
}
