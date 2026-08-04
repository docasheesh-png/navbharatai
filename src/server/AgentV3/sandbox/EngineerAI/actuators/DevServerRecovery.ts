// AgentV3 — deterministic dev-server failure classification + recovery planning.
//
// When a v5.0 dev server does NOT come up (the "Closed Port Error: no service on port 5173" the
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
  | 'missing_script'  // the launch command names a script package.json doesn't have ("Missing script: dev")
  | 'port_in_use'     // the target port is occupied (EADDRINUSE)
  | 'db_unreachable'  // the app's database isn't running in the sandbox (Prisma P1001 / ECONNREFUSED :5432)
  | 'missing_credential' // the app kills itself at boot because a USER-supplied key isn't set yet
  | 'code_error'      // a syntax/transform error in the generated source — a restart can NEVER fix it
  | 'out_of_memory'   // the process was OOM-killed ("JavaScript heap out of memory" / "Killed")
  | 'crash'           // the process exited/crashed with no more specific signal
  | 'unknown';        // nothing recognisable in the log

/** The single correct next action for a given failure cause. */
export type DevServerRecovery =
  | 'reinstall'       // run `npm install`, then restart
  | 'kill_port_retry' // free the port, then restart
  | 'reprovision_db'  // restart PostgreSQL in the sandbox (it was reaped/never started), then restart
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
 * The npm command that actually starts THIS project's dev server, derived from its package.json
 * scripts (`dev` → `start` → `serve`, the same priority validateProjectForPreview uses — one source
 * of truth, no drift). Root cause this kills (CoreUI report 2026-07-07): the preview boot hardcoded
 * `npm run dev`, but CoreUI's script is `start` — so the boot failed with `npm error Missing script:
 * "dev"`, was restarted once (same wrong command), and died with "no recognisable error". Falls back
 * to `npm run dev` when package.json is missing/unreadable (the scaffold default). PURE.
 */
export function resolveDevRunCommand(packageJsonRaw: string | null): string {
  const { runScript } = validateProjectForPreview(packageJsonRaw);
  if (!runScript || runScript === 'dev') return 'npm run dev';
  if (runScript === 'start') return 'npm start';
  return `npm run ${runScript}`;
}

/**
 * The HONEST reason to show when a preview sandbox has NO readable package.json — derived from the
 * DURABLE project truth (the saved file-path index), not the ephemeral sandbox alone. PURE.
 *
 * A missing package.json in the sandbox is usually a FAILED RESTORE of a recycled/cold sandbox, NOT
 * the user's project genuinely lacking one. Telling a user whose app really does have a package.json
 * that "the project has no defined dependencies" is a false verdict about their code (build-report
 * autopsy 2026-07-06 — a freshly-built React+Vite login page whose package.json was written 5/12 and
 * saved, yet the Diagnose panel claimed "No package.json found"). So:
 *   • durable index empty        → the files weren't saved/restorable yet — say THAT.
 *   • durable index HAS pkg      → the project is fine; the restore failed this time — say THAT.
 *   • durable index, but no pkg  → a genuine structural issue — the original honest message.
 */
export function missingPreviewReason(durablePaths: string[]): string {
  const durableHasPkg = durablePaths.some((p) => p === 'package.json' || p.endsWith('/package.json'));
  if (durablePaths.length === 0) {
    return "I couldn't find your saved project files to restore into a preview sandbox — they may not have finished saving yet. Make an edit or re-run the build, then try Diagnose again.";
  }
  if (durableHasPkg) {
    return "Your project's package.json is saved safely, but it couldn't be restored into a fresh preview sandbox this time. Try Diagnose again in a few seconds.";
  }
  return 'No package.json found — the project has no defined dependencies or start command to run a live preview.';
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
    case 'missing_script': return 'code_fix'; // restarting re-runs the same wrong command forever — the LAUNCH COMMAND must change
    case 'port_in_use': return 'kill_port_retry';
    case 'db_unreachable': return 'reprovision_db'; // a blind restart can never revive a reaped Postgres — restart the DB itself
    case 'missing_credential': return 'code_fix'; // the key is still unset on every restart — only the SOURCE can stop crashing
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
/**
 * The env-var name whose absence killed the app at boot, or `null` when the log shows no such failure.
 *
 * HIGH PRECISION on purpose — a wrong hit would send the agent editing source for an unrelated crash.
 * The name must look like a real environment variable (UPPER_SNAKE, i.e. at least one underscore), which
 * is how essentially every credential is named (RAZORPAY_KEY_SECRET, SMTP_HOST, TWILIO_ACCOUNT_SID …).
 * A single all-caps word without an underscore is deliberately NOT matched; it falls through to the
 * generic crash branch rather than risk a false "edit your source" verdict.
 *
 * DATABASE_URL is excluded here because the caller reaches this only after the db_unreachable branch,
 * which has a strictly better recovery for it (provision Postgres); this guard makes that explicit so a
 * future reorder cannot silently downgrade the database path. PURE.
 */
export function missingCredentialFromLog(log: string): string | null {
  const text = (log || '').slice(-8000);
  const NAME = '[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+';
  const patterns: RegExp[] = [
    // "Error: Missing RAZORPAY_KEY_SECRET" / "Missing required environment variable: SMTP_HOST"
    new RegExp(`\\bMissing\\s+(?:required\\s+)?(?:env(?:ironment)?\\s+var(?:iable)?s?\\s*:?\\s*)?["'\`]?(${NAME})["'\`]?`, 'i'),
    // "STRIPE_SECRET_KEY is required" / "must be set" / "is not defined" / "is undefined"
    new RegExp(`["'\`]?(${NAME})["'\`]?\\s+(?:is\\s+)?(?:required|must\\s+be\\s+set|is\\s+not\\s+set|not\\s+set|is\\s+not\\s+defined|not\\s+defined|is\\s+undefined|is\\s+missing)\\b`),
    // "Environment variable SENDGRID_API_KEY is ..." (the name follows the phrase)
    new RegExp(`\\benv(?:ironment)?\\s+var(?:iable)?s?\\s+["'\`]?(${NAME})["'\`]?`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    const name = m?.[1];
    if (name && name !== 'DATABASE_URL') return name;
  }
  return null;
}

export function classifyDevServerFailure(log: string): DevServerDiagnosis {
  const text = (log || '').slice(-8000); // the tail carries the fatal line; bound the scan
  const make = (cause: DevServerFailureCause, detail: string): DevServerDiagnosis => ({ cause, recovery: recoveryFor(cause), detail });

  // 1) Port already in use — free it and retry (never a code problem). Covers Node's EADDRINUSE,
  //    Vite's "port X is in use", AND Create-React-App's phrasing "Something is already running on
  //    port 4100." (RealWorld/Conduit report 2026-07-07 — CRA's wording matched nothing, so the
  //    recovery plain-retried into the same conflict instead of freeing the port).
  if (/\bEADDRINUSE\b/i.test(text) || /port\s+\d+\s+is\s+(?:already\s+)?in\s+use/i.test(text) || /address already in use/i.test(text)
    || /already running on port\s+\d+/i.test(text)) {
    const m = text.match(/(?:port\s+|:)(\d{2,5})\b/i);
    return make('port_in_use', `Port ${m ? m[1] : '(the dev-server port)'} is already in use — freeing it and restarting.`);
  }

  // 2) Wrong launch command — the script doesn't exist in package.json ("npm error Missing script:
  //    \"dev\"" — the CoreUI report 2026-07-07: its script is `start`, not `dev`). Restarting re-runs
  //    the SAME wrong command; this must surface as a launch-command mismatch, never "no recognisable
  //    error". resolveDevRunCommand() upstream prevents it; this classifier keeps the report honest
  //    if any path still launches blind.
  const missScript = text.match(/Missing script:\s*"?([\w:-]+)"?/i);
  if (missScript) {
    return make('missing_script', `package.json has no "${missScript[1]}" script — the app must be started with its own run script (e.g. \`npm start\`), not \`npm run ${missScript[1]}\`. This is a launch-command mismatch, not an app error.`);
  }

  // 3) Missing dependency / uninstalled tool — reinstall, then restart.
  const mod = text.match(/Cannot find module ['"]([^'"\n]+)['"]/i)
    || text.match(/Cannot find package ['"]([^'"\n]+)['"]/i)
    || text.match(/Failed to resolve (?:import|entry|module) ['"]([^'"\n]+)['"]/i);
  if (mod) return make('missing_module', `Missing dependency "${mod[1]}" — reinstalling dependencies and restarting.`);
  if (/\bModule not found\b/i.test(text)) return make('missing_module', 'A module could not be resolved — reinstalling dependencies and restarting.');
  if (/\b(?:vite|next|tsc|tsx|node|npm)\b\s*:\s*(?:command\s+)?not found/i.test(text) || /command not found/i.test(text)) {
    return make('missing_module', 'A required CLI was not found — reinstalling dependencies and restarting.');
  }

  // 2.5) Database not reachable — the app's Postgres isn't running in the sandbox (Prisma P1001, or a raw
  //    connection refused on the Postgres port). A blind restart can NEVER revive a reaped/never-started
  //    Postgres — the DB itself must be (re)started, so this is its OWN cause, caught BEFORE the generic
  //    crash branch (P1001's line also contains "Error:", which would otherwise mis-classify it as a plain
  //    crash and waste both attempts on futile restarts). EstateNest autopsy 2026-07-20: a from-scratch
  //    Prisma+Postgres app previewed ~13 min after the build began, by which point the provisioned Postgres
  //    had been reaped, so `npm run dev` crashed on boot with P1001 and the preview never came up.
  if (/\bP1001\b/i.test(text)
    || /can'?t reach database server/i.test(text)
    || /(?:ECONNREFUSED|connection refused)[^\n]*(?::|\bport\s*)5432\b/i.test(text)
    // Postgres' own multi-line "could not connect to server: Connection refused … port 5432?" — the two
    // halves straddle a newline, so match their presence anywhere in the (bounded) tail rather than inline.
    || (/could not connect to (?:server|database)/i.test(text) && /\b5432\b/.test(text))
    // DB NEVER PROVISIONED (Mitrify autopsy 2026-08-02): a from-scratch Drizzle/Express app (`server/db.ts`
    // reads process.env.DATABASE_URL) crashes on boot because NO DATABASE_URL is set — the Prisma-only
    // provisioner never fired. This is NOT "Postgres reaped"; the DB was never created. Same recovery
    // (provision Postgres + write DATABASE_URL to .env), so route it to db_unreachable → reprovision_db.
    || /DATABASE_URL\s+must\s+be\s+set/i.test(text)
    || /did\s+you\s+forget\s+to\s+provision\s+a\s+database/i.test(text)
    || /DATABASE_URL\s+(?:is\s+)?(?:not\s+set|not\s+defined|required|missing|undefined|is\s+empty)/i.test(text)
    || /(?:missing|no)\s+(?:required\s+)?(?:env(?:ironment)?\s+var(?:iable)?\s+)?DATABASE_URL/i.test(text)) {
    return make('db_unreachable', "The app needs a database but none is set up in the sandbox — provisioning PostgreSQL, writing DATABASE_URL, and retrying.");
  }

  // 2.6) MISSING USER CREDENTIAL — the app kills itself at boot because an env var the END USER supplies
  //    from their own account (a payment key, an SMTP password, a Maps key) is not set yet. Caught AFTER
  //    db_unreachable (DATABASE_URL has a better recovery: provision Postgres) and BEFORE the generic
  //    crash branch, which used to swallow it: `throw new Error('Missing RAZORPAY_KEY_SECRET')` matched
  //    only `/\bError:/` → 'crash' → 'plain_retry', and a restart can NEVER help because the key is still
  //    unset on the next boot. Both attempts were wasted and the report said "crashed on startup" instead
  //    of the truth. This is the RETROACTIVE half of the missing-credential contract (2026-08-03): apps
  //    built BEFORE the contract shipped still contain these boot-killers, and this is the moment it
  //    actually bites — so classify it honestly and route it to the SOURCE fix.
  const missingCred = missingCredentialFromLog(text);
  if (missingCred) {
    return make('missing_credential',
      `The app refuses to start because ${missingCred} is not set — but that key is supplied later by the end user from their own account, so it is legitimately empty here. A restart can never fix this. Fix the SOURCE: delete the boot-time throw/exit for ${missingCred}, gate that feature on a boolean (e.g. \`const enabled = Boolean(process.env.${missingCred});\`), and render its control visibly disabled as "Coming soon" naming ${missingCred} and Settings → App Settings → Secrets & API Keys. Keep every other part of the app working, never crash at boot, and never fake a result.`);
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
/**
 * Rewrite a diagnosis's detail for the GIVE-UP verdict, so it states what IS true instead of what we were
 * about to do.
 *
 * ROOT CAUSE (mitrify autopsy 2026-08-04): every `detail` is written in the present-progressive voice of a
 * recovery that is about to run — "provisioning PostgreSQL, writing DATABASE_URL, and retrying",
 * "reinstalling dependencies and restarting", "freeing it and restarting". When attempts ran out, the
 * caller printed that SAME text as the terminal message, so the user was told a database was being
 * provisioned at the exact moment we stopped trying. Announcing an action we do not take is fake success.
 *
 * The terminal line keeps the real CAUSE (which is genuinely useful) and replaces the promise with the
 * honest outcome plus, where one exists, what the user can actually do. PURE.
 */
export function terminalDetail(d: DevServerDiagnosis): string {
  const tail = 'Automatic recovery is exhausted.';
  switch (d.cause) {
    case 'db_unreachable':
      return `The app needs a database and one could not be started in the sandbox. ${tail} Connect your own database in Settings → App Settings → Database, then press Diagnose to boot it.`;
    case 'missing_module':
      return `A dependency the app needs is still missing after reinstalling. ${tail} Check that it is listed in package.json and installs cleanly.`;
    case 'port_in_use':
      return `The port stayed occupied by another process. ${tail}`;
    case 'out_of_memory':
      return `The dev server ran out of memory and was killed. ${tail} A smaller build or fewer watchers may be needed.`;
    case 'crash':
      return `The dev server kept crashing on startup. ${tail} ${d.detail}`.slice(0, 400);
    case 'unknown':
    default:
      return `The dev server did not start and its log had no recognisable error. ${tail}`;
  }
}

/**
 * The message a NON-TECHNICAL USER should read when their preview does not come up — plain language,
 * the real cause, and the ONE thing they can do about it.
 *
 * ROOT CAUSE (mitrify autopsy 2026-08-04). Two separate audiences were being served the same text:
 *   • The Diagnose panel's headline GUESSED — "the exact cause is in the detail log below (a crash on
 *     boot, a missing dependency, or a port conflict)" — while `classifyDevServerFailure` already knew
 *     the answer deterministically. We made the user read a log to find out something we had computed.
 *   • Where a real cause WAS shown, it was the AGENT's text. A `missing_credential` detail tells the
 *     model to "delete the boot-time throw and gate the feature on a boolean" — instructions a user
 *     cannot act on, about code they did not write.
 *
 * So the agent instruction and the user message are now different strings by construction. This one is
 * for the human: it never names a file, a stack frame, or an internal fix, and for the two causes the
 * user genuinely CAN resolve — a missing credential and a missing database — it says exactly where to
 * go. (Admin: "agar app ko chalane ke liye user se kuch credential chahiye to user ko bolo!") PURE.
 */
export function userFacingPreviewFailure(diag: DevServerDiagnosis, port: number, log?: string): string {
  switch (diag.cause) {
    case 'missing_credential': {
      const key = (log ? missingCredentialFromLog(log) : null) ?? 'a key';
      return `Your app needs one of your own keys before it can start: \`${key}\`. Add it in Settings → App Settings → Secrets & API Keys, then press Diagnose again. Everything else in the app is ready.`;
    }
    case 'db_unreachable':
      return 'Your app needs a database to start, and one could not be set up automatically here. Connect your own in Settings → App Settings → Database, then press Diagnose again — your data always stays in your own account.';
    case 'missing_module':
      return "One of the app's dependencies could not be installed, so it can't start. Ask me to fix the dependencies and I'll sort it out.";
    case 'missing_script':
      return "The app is being started with the wrong command — its package.json doesn't have that script. Ask me to fix the start command.";
    case 'port_in_use':
      return `Port ${port} was still being held by another process, so the app couldn't take it. Press Diagnose again in a few seconds.`;
    case 'code_error':
      return "There's an error in the app's code that stops it from starting. Ask me to fix it and I'll find and repair it.";
    case 'out_of_memory':
      return 'The app ran out of memory while starting. Ask me to make the build lighter, then try again.';
    case 'crash':
    case 'unknown':
    default:
      return "The app didn't finish starting. Press Diagnose to try again, or ask me to look into it and I'll read the logs and fix what I find.";
  }
}

/**
 * Strip pure NOISE from the log we show a user. `git status --porcelain` output (`?? client/`) was being
 * concatenated into the Diagnose detail box, so the panel read like
 * "…and retrying.?? .gitignore ?? DEPLOY_NOW.md ?? attached_assets/" — unrelated to the failure and
 * meaningless to the reader. The agent's own copy of the log is untouched; this only cleans what a human
 * sees. PURE.
 */
export function cleanPreviewLogForUser(log: string): string {
  if (!log) return '';
  // `?? path` is git's "untracked" marker — the only porcelain form that leaked here, and never
  // meaningful to a user reading a startup failure. Nothing else is removed: a real error line that
  // happens to start with a letter is untouched.
  return log
    .split('\n')
    .filter((l) => !/^\s*\?\?\s+\S/.test(l))
    .join('\n');
}

export function planDevServerRecovery(log: string, attempt: number, maxAttempts: number): DevServerDiagnosis {
  const d = classifyDevServerFailure(log);
  // Anything whose ONLY cure is a source change fails identically on every restart — stop and surface it
  // now, on ANY attempt. Keyed on the RECOVERY, not on one cause: `code_error` was special-cased here,
  // but `missing_script` and `missing_credential` are equally unfixable by restarting, and on the FINAL
  // attempt they were being rewritten to 'give_up' — which throws away the one thing that would have
  // fixed them (the actionable detail telling the agent exactly what to change). Fix the class, not the
  // instance: every `code_fix` recovery short-circuits with its detail intact.
  if (d.recovery === 'code_fix') return d;
  if (attempt >= Math.max(1, maxAttempts)) return { ...d, recovery: 'give_up', detail: terminalDetail(d) };
  return d;
}

/**
 * The honest one-line health-check summary the actuator appends to its output — a REAL root cause when
 * the server is down, not a generic "did not come up". PURE.
 */
/**
 * Fix 42 (report 2026-07-11): a dev log that shows the launch command's own binary was NOT FOUND
 * (`sh: 1: vite: not found`, `next: command not found`, …) means THIS launch produced no server —
 * anything answering on the port is a stale/zombie process or the sandbox proxy, not the app. The
 * caller uses this to demand a REAL HTTP response before trusting a TCP-open "PORT_UP", so a build
 * can never again report "dev server is UP" + "preview verified" while the runner never even started.
 * Pure.
 */
export function devServerRunnerMissing(log: string): boolean {
  const text = (log || '').slice(-8000);
  // "sh: 1: vite: not found" / "vite: command not found" / "next: not found" — the RUNNER binary,
  // not a generic module (a missing npm module is handled by the missing_module reinstall path).
  return /\b(vite|next|nuxt|astro|remix|react-scripts|vue-cli-service|ng|webpack|parcel|tsx|node)\b\s*:\s*(?:command\s+)?not\s+found/i.test(text)
    || /sh:\s*\d+:\s*[\w./-]+:\s*not\s+found/i.test(text);
}

export function devServerHealthLine(portUp: boolean, port: number, diagnosis?: DevServerDiagnosis): string {
  if (portUp) return `[health-check] dev server is UP on port ${port}. Call update_preview with port=${port}.`;
  const why = diagnosis?.detail ? ` Root cause: ${diagnosis.detail}` : '';
  // Keep the exact "did not come up on port {n}" phrasing so parseDevServerHealthCheck (agentv3.ts,
  // used by the Diagnose button) still extracts the port from this line.
  return `[health-check] dev server did not come up on port ${port} after automatic recovery.${why}`;
}

/**
 * Parse the AUTHORITATIVE health verdict out of a managed dev-server launch's own output. The managed
 * launcher (E2BActuator) runs the SAME port check (buildPortWaitCommand) that `update_preview` later
 * re-runs, then prints one of the `devServerHealthLine` strings (or the "already healthy … reused it"
 * line). When the launcher has ALREADY confirmed the port UP, a second, independent inline re-poll must
 * NOT be allowed to override that verdict to DOWN — that "two drifting truths, the flaky one wins" bug
 * reported a genuinely-booted app as "the live preview didn't start automatically" (build report
 * 2026-07-06: `npm run dev` → "dev server is UP on port 5173", yet the re-poll missed it and no preview
 * was published). Callers TRUST this verdict: a health-UP can only ever CONFIRM up, never mark it down.
 * PURE. Returns up:true only on an explicit UP / already-healthy line; up:false on an explicit DOWN
 * line; null when the output carries no health verdict at all (caller then falls back to its own probe).
 */
export function parseDevServerHealthLine(output: string): { up: boolean; port: number | null } | null {
  const text = output || '';
  const up = /dev server (?:is UP|already healthy) on port (\d+)/i.exec(text);
  if (up) return { up: true, port: Number(up[1]) };
  const down = /dev server did not come up on port (\d+)/i.exec(text);
  if (down) return { up: false, port: Number(down[1]) };
  return null;
}
