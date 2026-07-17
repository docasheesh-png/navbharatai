// Bounded command execution for the Code Studio REAL terminal (no fake output).
//
// A user terminal runs commands in the user's OWN v5.0 sandbox, but it must never become an
// unbounded shell on NavBharatAI's infra: every command is wrapped with a hard `timeout` (so no
// runaway/long-running process) and its output is capped. These are pure helpers so the bounding
// rules are unit-tested independently of the sandbox.

/** Max seconds a single terminal command may run before the sandbox kills it. */
export const EXEC_TIMEOUT_SEC = 30;
/** Max characters of stdout/stderr returned to the client (each), to keep responses bounded. */
export const EXEC_OUTPUT_CAP = 100_000;

/**
 * Wrap a user command so it runs under a hard timeout in a login shell. Single-quotes in the command
 * are escaped with the standard POSIX `'\''` technique, so the whole command is passed as one safely
 * quoted argument to `bash -lc` (no operator/pipe breakage, no quote injection). Pure.
 */
export function wrapBoundedCommand(command: string, timeoutSec: number = EXEC_TIMEOUT_SEC): string {
  const escaped = String(command).replace(/'/g, `'\\''`);
  return `timeout ${Math.max(1, Math.floor(timeoutSec))} bash -lc '${escaped}'`;
}

/** Cap a stream to EXEC_OUTPUT_CAP characters, appending a clear truncation marker. Pure. */
export function capOutput(s: string | undefined | null, max: number = EXEC_OUTPUT_CAP): string {
  const str = typeof s === 'string' ? s : '';
  if (str.length <= max) return str;
  return str.slice(0, max) + '\n…(output truncated)';
}

/** Is a command worth running at all? Rejects empty/whitespace. Pure. */
export function isRunnableCommand(command: unknown): command is string {
  return typeof command === 'string' && command.trim().length > 0 && command.length <= 4000;
}

/** A bounded terminal exec result returned to the client. */
export interface ExecResult {
  available: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}
