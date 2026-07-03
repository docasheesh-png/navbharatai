// AgentV3 — deterministic dev-server failure classification + recovery planning.
//
// When a v3.0 dev server does NOT come up (the "Closed Port Error: no service on port 5173" the
// admin hit), the actuator used to just blindly restart ONCE and, on a second failure, give a generic
// "did not come up — check the logs" line. That is the opposite of production-grade: a missing
// dependency needs `npm install`, a busy port needs to be freed, a code error needs a SOURCE fix (a
// restart can never help it), and an OOM needs a plain retry. Guessing wrong wastes the whole build.
//
// This module turns the dev server's own log into a DETERMINISTIC diagnosis: the real root cause + the
// single correct recovery action. PURE + dependency-free so it is fully unit-testable without the E2B
// SDK, against the exact log signatures seen in real build reports. The actuator consumes it to run a
// bounded, cause-specific recovery loop instead of a blind restart, and to report an HONEST root cause.

/** What actually went wrong with the dev server, derived from its log output. */
export type DevServerFailureCause =
  | 'missing_module'  // an import/dependency isn't installed ("Cannot find module 'X'")
  | 'port_in_use'     // the target port is occupied (EADDRINUSE)
  | 'code_error'      // a syntax/transform error in the generated source — a restart can NEVER fix it
  | 'out_of_memory'   // the process was OOM-killed ("JavaScript heap out of memory" / "Killed")
  | 'crash'           // the process exited/crashed with no more specific signal
  | 'unknown';        // nothing recognisable in the log

/** The single correct next action for a given failure cause. */
export type DevServerRecovery =
  | 'reinstall'       // run `npm install`, then restart
  | 'kill_port_retry' // free the port, then restart
  | 'code_fix'        // surface the exact error to the agent — the SOURCE must change, not a restart
  | 'plain_retry'     // just restart once (transient crash / OOM)
  | 'give_up';        // bounded attempts exhausted — report the root cause honestly

export interface DevServerDiagnosis {
  cause: DevServerFailureCause;
  recovery: DevServerRecovery;
  /** Short human-readable root cause for the health-check line + the build diagnostics report. */
  detail: string;
}

/**
 * Validate that a project is actually RUNNABLE before we try to start its dev server — so a broken
 * package.json (missing, invalid JSON, or no run script) is reported as a clear structural issue
 * instead of surfacing later as a mystery "Closed Port Error: no service on port 5173". PURE.
 *
 * @param packageJsonRaw the raw text of package.json (null/'' when the file is missing)
 * @returns ok + the specific issues, and the run script to use ('dev' | 'start' | 'serve' | null)
 */
export function validateProjectForPreview(packageJsonRaw: string | null): { ok: boolean; issues: string[]; runScript: string | null } {
  const issues: string[] = [];
  if (!packageJsonRaw || !packageJsonRaw.trim()) {
    return { ok: false, issues: ['No package.json found — the project has no defined dependencies or start command to run a live preview.'], runScript: null };
  }
  let pkg: { scripts?: Record<string, unknown>; dependencies?: unknown; devDependencies?: unknown };
  try {
    pkg = JSON.parse(packageJsonRaw);
  } catch {
    return { ok: false, issues: ['package.json is not valid JSON — fix its syntax before the app can install or run.'], runScript: null };
  }
  const scripts = (pkg && typeof pkg.scripts === 'object' && pkg.scripts) ? pkg.scripts as Record<string, unknown> : {};
  // Prefer `dev`, then `start`, then `serve` — the run script that boots a dev/preview server.
  const runScript = ['dev', 'start', 'serve'].find((s) => typeof scripts[s] === 'string' && (scripts[s] as string).trim()) ?? null;
  if (!runScript) {
    issues.push('package.json has no "dev", "start", or "serve" script — there is no command to start the live preview server.');
  }
  return { ok: issues.length === 0, issues, runScript };
}

/**
 * The port the project's OWN dev script declares — the ground truth the health check must wait
 * on. Framework-based guessing waited on the wrong port for real imported apps (admin evidence,
 * 2026-07-04: the app's script was `tsx server.ts --port 5173 --strictPort` while the check
 * waited on port 3000 — the boot could never be seen as up). Parses `--port N`, `-p N`,
 * `--port=N` and a leading `PORT=N` env prefix from the dev/start/serve script. PURE; null when
 * the script names no explicit port (callers then fall back to the framework default).
 */
export function devScriptPort(packageJsonRaw: string | null): number | null {
  if (!packageJsonRaw) return null;
  let scripts: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(packageJsonRaw) as { scripts?: Record<string, unknown> };
    if (pkg && typeof pkg.scripts === 'object' && pkg.scripts) scripts = pkg.scripts;
  } catch {
    return null;
  }
  const script = ['dev', 'start', 'serve'].map((s) => scripts[s]).find((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (!script) return null;
  const m = script.match(/(?:--port[=\s]+|(?:^|\s)-p\s+|(?:^|\s)PORT=)(\d{2,5})/);
  const port = m ? Number(m[1]) : NaN;
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null;
}

/** cause → the deterministic recovery action for it. */
function recoveryFor(cause: DevServerFailureCause): DevServerRecovery {
  switch (cause) {
    case 'missing_module': return 'reinstall';
    case 'port_in_use': return 'kill_port_retry';
    case 'code_error': return 'code_fix'; // a restart cannot fix a syntax error — the source must change
    case 'out_of_memory': return 'plain_retry';
    case 'crash': return 'plain_retry';
    case 'unknown': return 'plain_retry';
  }
}

/**
 * Classify a dev server's log output into a root cause + recovery. Ordered MOST-SPECIFIC first so a
 * generic "Error:" never shadows a precise signal (a missing module, a busy port, a syntax error).
 * PURE. Call this only when the port is actually DOWN (a healthy server needs no diagnosis).
 */
export function classifyDevServerFailure(log: string): DevServerDiagnosis {
  const text = (log || '').slice(-8000); // the tail carries the fatal line; bound the scan
  const make = (cause: DevServerFailureCause, detail: string): DevServerDiagnosis => ({ cause, recovery: recoveryFor(cause), detail });

  // 1) Port already in use — free it and retry (never a code problem).
  if (/\bEADDRINUSE\b/i.test(text) || /port\s+\d+\s+is\s+(?:already\s+)?in\s+use/i.test(text) || /address already in use/i.test(text)) {
    const m = text.match(/(?:port\s+|:)(\d{2,5})\b/i);
    return make('port_in_use', `Port ${m ? m[1] : '(the dev-server port)'} is already in use — freeing it and restarting.`);
  }

  // 2) Missing dependency / uninstalled tool — reinstall, then restart.
  const mod = text.match(/Cannot find module ['"]([^'"\n]+)['"]/i)
    || text.match(/Cannot find package ['"]([^'"\n]+)['"]/i)
    || text.match(/Failed to resolve (?:import|entry|module) ['"]([^'"\n]+)['"]/i);
  if (mod) return make('missing_module', `Missing dependency "${mod[1]}" — reinstalling dependencies and restarting.`);
  if (/\bModule not found\b/i.test(text)) return make('missing_module', 'A module could not be resolved — reinstalling dependencies and restarting.');
  if (/\b(?:vite|next|tsc|tsx|node|npm)\b\s*:\s*(?:command\s+)?not found/i.test(text) || /command not found/i.test(text)) {
    return make('missing_module', 'A required CLI was not found — reinstalling dependencies and restarting.');
  }

  // 3) Code error in the generated source — a restart can NEVER fix this; the agent must edit the code.
  if (/\bSyntaxError\b/i.test(text)
    || /Transform failed with \d+ error/i.test(text)
    || /\[(?:esbuild|vite)\][^\n]*error/i.test(text)
    || /Expected [^\n]+ but (?:found|got)/i.test(text)
    || /Unexpected (?:token|end of|identifier)/i.test(text)
    || /Pre-transform error/i.test(text)
    || /Failed to parse/i.test(text)) {
    const line = (text.match(/[^\n]*(?:SyntaxError|Transform failed|Pre-transform error|Expected [^\n]+ but|Unexpected [^\n]+)[^\n]*/i) || [''])[0].trim().slice(0, 200);
    return make('code_error', `Code error in the generated source (a restart can't fix it): ${line || 'see the dev-server log'}`);
  }

  // 4) Out-of-memory / OOM-killed — a plain retry can clear a transient spike.
  if (/JavaScript heap out of memory/i.test(text) || /FATAL ERROR:[^\n]*memory/i.test(text) || /\bKilled\b/.test(text)) {
    return make('out_of_memory', 'The dev server was killed (out of memory) — restarting.');
  }

  // 5) Generic crash signals — retry once.
  if (/\bELIFECYCLE\b/i.test(text) || /npm ERR!/i.test(text) || /exited with (?:code|signal)/i.test(text) || /\bError:/i.test(text)) {
    const line = (text.match(/[^\n]*(?:npm ERR!|ELIFECYCLE|exited with|Error:)[^\n]*/i) || [''])[0].trim().slice(0, 200);
    return make('crash', `The dev server crashed on startup — restarting. ${line}`.trim());
  }

  // 6) Nothing recognisable — retry once, then report honestly.
  return make('unknown', 'The dev server did not start and the log had no recognisable error — restarting once.');
}

/**
 * Plan the recovery for a bounded retry loop: escalate to `give_up` once attempts are exhausted, and
 * short-circuit a `code_error` (a restart provably can't fix it, so don't waste attempts on it). PURE.
 *
 * @param log        the dev server's captured output for this attempt
 * @param attempt    1-based attempt number that just failed
 * @param maxAttempts total recovery attempts allowed
 */
export function planDevServerRecovery(log: string, attempt: number, maxAttempts: number): DevServerDiagnosis {
  const d = classifyDevServerFailure(log);
  // A syntax/transform error will fail identically on every restart — stop and surface it now.
  if (d.cause === 'code_error') return d;
  if (attempt >= Math.max(1, maxAttempts)) return { ...d, recovery: 'give_up' };
  return d;
}

/**
 * The honest one-line health-check summary the actuator appends to its output — a REAL root cause when
 * the server is down, not a generic "did not come up". PURE.
 */
export function devServerHealthLine(portUp: boolean, port: number, diagnosis?: DevServerDiagnosis): string {
  if (portUp) return `[health-check] dev server is UP on port ${port}. Call update_preview with port=${port}.`;
  const why = diagnosis?.detail ? ` Root cause: ${diagnosis.detail}` : '';
  // Keep the exact "did not come up on port {n}" phrasing so parseDevServerHealthCheck (agentv3.ts,
  // used by the Diagnose button) still extracts the port from this line.
  return `[health-check] dev server did not come up on port ${port} after automatic recovery.${why}`;
}
