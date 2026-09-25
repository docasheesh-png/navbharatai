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
//
// 🔴 AND IT WAS READ ON THE WRONG BRANCH — the RESTART, never the GIVE-UP (autopsy e628efd4,
// 2026-09-25). Both preview loops in `routes/agentv3.ts` read these last words one line before they
// restart the server, and then, when the server would not stay up and the loop finally recorded
// `PREVIEW_SERVER_DOWN`, recorded the restart COUNT and nothing about the cause. So the report could
// explain a death it recovered from and not the one it gave up on — exactly backwards, since the
// give-up is the only one a human has to act on.
//
// ⚠️ THE LOG AT GIVE-UP IS NOT STALE, AND THAT IS THE POINT. By then it holds the output of the LAST
// restart — the death that ENDED the loop — not the first one. Two different deaths, both worth
// having, which is why the give-up reads again instead of reusing the earlier string.

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

/** How long one tail read may take. Bounded here, not at the call site — see `devServerDeathEvidence`. */
const READ_TIMEOUT_MS = 8_000;

/**
 * The read, bounded, for every caller.
 *
 * 🔒 THE TIMEOUT LIVES HERE so the four call sites cannot drift into four different bounds — the
 * drifted-copy class this repo has paid for repeatedly. A read that times out yields null, exactly
 * like a read that fails: this is evidence, and an absent line must never become a thrown error in a
 * loop that is already reporting a dead server.
 */
export async function devServerDeathEvidence(
  run: (command: string) => Promise<{ stdout?: string | null }>,
  timeoutMs: number = READ_TIMEOUT_MS,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readDevServerLastWords(run),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(1, timeoutMs)); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The ONE sentence every report line uses for this evidence, so a reader meets the same words on a
 * restart and on a give-up. Never user-facing (the White-Label Law does not apply — it names no
 * vendor), and honest about the difference between "the log was empty" and "we could not read it".
 */
export function devServerLastWordsDetail(lastWords: string | null | undefined): string {
  return lastWords
    ? `its last output before it stopped: ${lastWords}`
    : 'its log said nothing before it stopped (or could not be read)';
}
