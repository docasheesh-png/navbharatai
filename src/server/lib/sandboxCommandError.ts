// When a sandbox command FAILS, keep what it actually said.
//
// THE OPEN ROOT CAUSE THIS SERVES (build report e61b13b1, 2026-08-10). The pre-boot dependency install
// failed and the report's only evidence was `exit status 217` — no npm output at all — while the SAME
// installer succeeded nineteen seconds later inside the dev-server boot. I could not root-cause it,
// and recorded it honestly as open. This is why: nine call sites all handled a failed command as
//
//     .catch((err) => ({ exitCode: -1, stdout: '', stderr: err?.message || String(err) }))
//
// The E2B SDK REJECTS on a non-zero exit and carries the command's real stdout/stderr/exitCode ON THE
// ERROR. That handler throws all of it away and keeps `err.message`, which is the bare status line.
// So the one moment we most need the tool's own words is the exact moment we discard them — and the
// failure is then unexplainable by construction, no matter how many reports we collect.
//
// Centralised (rule 4: fix the class, not the instance) so every failing command reports the same way
// and no future call site can re-invent the lossy version. PURE — no I/O, fully unit-testable.

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Turn a rejected sandbox command into a result that still carries its output.
 *
 * Reads the error's own `stdout` / `stderr` / `exitCode` when present (the SDK attaches them), and
 * falls back to the message only when there is genuinely nothing else — so a bare `exit status 217`
 * remains possible, but only when that really is all we were given. `exitCode` keeps -1 for a
 * transport-level failure (timeout, sandbox gone), which callers already treat as "could not run".
 */
export function commandFailureResult(err: unknown): CommandResult {
  const e = (err ?? {}) as { stdout?: unknown; stderr?: unknown; exitCode?: unknown; message?: unknown };
  const stdout = str(e.stdout);
  const stderrOwn = str(e.stderr);
  const message = str(e.message) || (err == null ? '' : String(err));
  // The message still rides along when we have real output, because it names the exit status the
  // output alone does not — but it never REPLACES the output any more.
  const stderr = stderrOwn && message && !stderrOwn.includes(message)
    ? `${stderrOwn}\n${message}`
    : (stderrOwn || message);
  const exitCode = typeof e.exitCode === 'number' && Number.isFinite(e.exitCode) ? e.exitCode : -1;
  return { exitCode, stdout, stderr };
}

/**
 * The last `lines` of a command's combined output — what a diagnostic should carry. npm's real cause
 * is always at the END of its log, and the head is install noise. PURE.
 */
export function commandLogTail(result: { stdout?: string; stderr?: string }, lines = 25): string {
  const combined = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`.trim();
  if (!combined) return '';
  return combined.split('\n').slice(-Math.max(1, lines)).join('\n');
}
