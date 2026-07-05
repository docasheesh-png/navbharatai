// AgentV3 — dead-sandbox detection (warm-sandbox durability, admin-mandated 2026-07-05).
//
// ROOT CAUSE it fixes (real build report, 2026-07-05): the E2B sandbox was reaped mid-build (it timed
// out / was reclaimed between the long multi-session build). `getSandbox()` handed back the CACHED
// dead reference with no liveness check, and the ONLY eviction path (fileOp) fired only on a *timeout*
// — but a dead sandbox fails FAST (every `ls`/`pwd`/`cat`/`true`/`echo ok` returned exit -1 in 0s, not
// a timeout). So the corpse was never evicted and 81 commands died against it over 21 minutes.
//
// This is the missing intelligence: classify whether a command FAILURE means the SANDBOX ITSELF is
// dead/unreachable (evict + recreate) vs. a normal command that ran and returned nonzero (keep the
// sandbox). Pure + unit-testable; the actuator wires it into runCommand/fileOp/getSandbox.

// Error-message shapes that mean the sandbox (not the command) is gone: E2B reaped/expired it, the
// connect handle is stale, or the network to it is down.
const DEAD_PATTERNS: RegExp[] = [
  /sandbox\s*(is\s*)?(not\s*found|not\s*running|does\s*not\s*exist|unavailable|paused)/i,
  /sandbox.*(timed?\s*out|timeout|expired|killed|terminated|reaped|reclaimed|gone)/i,
  /\b(50[234])\b/, // bad-gateway / unavailable / gateway-timeout from the E2B edge
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EPIPE|socket hang ?up|network\s*error|fetch failed/i,
  /(connection|stream)\s*(closed|lost|refused|reset|aborted)/i,
  /disconnected|unreachable|not\s*connected/i,
];

/** True when an error message indicates the SANDBOX is dead/unreachable (vs. a normal command error). Pure. */
export function isDeadSandboxError(errMessage: string | null | undefined): boolean {
  if (!errMessage) return false;
  return DEAD_PATTERNS.some((re) => re.test(errMessage));
}

export interface CommandFailureSignal {
  /** Exit code. <0 means the SDK threw (the program never ran) rather than the program exiting nonzero. */
  exitCode: number;
  /** Wall-clock ms the call took before failing. A dead sandbox rejects the RPC almost instantly. */
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  /** The thrown error's message, when the SDK call rejected. */
  errorMessage?: string;
}

/**
 * Decide whether a command failure signals a DEAD sandbox (→ evict + recreate) rather than a real
 * command that ran and failed (→ keep the sandbox). True when:
 *   • the error/stderr matches a dead-sandbox pattern (reaped / not-running / network gone / 5xx), OR
 *   • it "failed instantly with no output": exitCode < 0 (the SDK threw — the program never executed),
 *     the call returned in ~0 ms, and there is NO program output. A live sandbox running a real command
 *     produces *some* stdout/stderr or takes real time; a dead sandbox rejects the RPC immediately with
 *     nothing — exactly the "exit -1 (0s), empty" shape of the 81 failed commands in the report.
 * Pure + unit-testable.
 */
export function isDeadSandboxSignal(sig: CommandFailureSignal): boolean {
  if (isDeadSandboxError(sig.errorMessage) || isDeadSandboxError(sig.stderr)) return true;
  const noOutput = !(sig.stdout || '').trim() && !(sig.stderr || '').trim();
  const instant = (sig.durationMs ?? 0) <= 250;
  return sig.exitCode < 0 && instant && noOutput;
}
