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
  | 'db_engine_unavailable' // the app needs a database ENGINE the sandbox cannot start (MongoDB, MySQL, Redis…)
  | 'db_client_missing' // a script shells out to psql/createdb/pg_dump, which this PostgreSQL does not ship
  | 'missing_credential' // the app kills itself at boot because a USER-supplied key isn't set yet
  | 'missing_session_secret' // express-session has no secret — the platform env that supplied it wasn't imported
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
  /**
   * The node_modules package that installed only PARTIALLY, when the log proves one did.
   *
   * WHY IT MUST TRAVEL WITH THE DIAGNOSIS (mitrify autopsy 2026-08-04): a plain `npm install` cannot
   * repair a half-installed package — package.json is already satisfied and the directory already
   * exists, so npm does nothing and the next restart fails identically. The recovery has to DELETE the
   * broken package first, which means it needs its name. Without this the 'reinstall' recovery would be
   * classified correctly and still not work — a heal that runs and changes nothing.
   */
  corruptPackage?: string;
  /**
   * The port the log proves is ACTUALLY occupied, when that is knowable — see conflictingPortFromLog.
   *
   * WHY IT MUST TRAVEL WITH THE DIAGNOSIS (mitrify autopsy 2026-08-05): the recovery freed only the port
   * the health check WATCHES. When the app bound a different port (an Express server ignoring the
   * `--port` flag we appended and taking `process.env.PORT || 5000`), the orphan holding THAT port was
   * never touched, so every restart hit the identical EADDRINUSE and "automatic recovery is exhausted"
   * was structurally guaranteed — a retry loop around code that deterministically fails. Freeing the
   * port the error itself names is the only recovery that can ever succeed.
   */
  conflictPort?: number;
  /**
   * Which database ENGINE the app was trying to reach, when the log names one.
   *
   * The message has to be specific to be useful: "connect a database" is advice; "your app is trying to
   * reach MongoDB, and this preview can only start PostgreSQL" is an explanation the user can act on —
   * either connect their own MongoDB or ask for the app to use a database that IS available here.
   */
  dbEngine?: 'mongodb' | 'mysql' | 'redis' | 'mssql';
}

/** How each engine is named to a user, and the port that identifies it in a connection error. */
const DB_ENGINES: Array<{ id: 'mongodb' | 'mysql' | 'redis' | 'mssql'; label: string; port: number; re: RegExp }> = [
  { id: 'mongodb', label: 'MongoDB', port: 27017, re: /\bMongo(?:Server|Network|Timeout)?\w*Error\b|\bmongodb(?:\+srv)?:\/\/|\bfailed to connect to server\b.*\b27017\b|:27017\b/i },
  { id: 'mysql', label: 'MySQL', port: 3306, re: /\bER_(?:ACCESS_DENIED|BAD_DB|CON_COUNT)\w*\b|\bPROTOCOL_CONNECTION_LOST\b|\bmysql:\/\/|:3306\b/i },
  { id: 'redis', label: 'Redis', port: 6379, re: /\bredis(?:s)?:\/\/|\bReplyError\b|\bNOAUTH\b|:6379\b/i },
  { id: 'mssql', label: 'SQL Server', port: 1433, re: /\bELOGIN\b|\bmssql:\/\/|:1433\b/i },
];

/**
 * Which database engine a boot failure is about, when the log names one that is NOT PostgreSQL.
 *
 * Only fires alongside a real CONNECTION failure — a log that merely mentions `mongodb://` in a comment
 * or a printed config is not a database being unreachable, and misreading that would send a working app
 * down a "you need a database" path it never needed. PURE.
 */
export function unavailableDbEngine(log: string): { id: 'mongodb' | 'mysql' | 'redis' | 'mssql'; label: string } | null {
  const text = stripAnsi(log || '').slice(-8000);
  const refused = /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|connection refused|connect failed|server selection|topology was destroyed|getaddrinfo)\b/i.test(text);
  if (!refused) return null;
  for (const e of DB_ENGINES) {
    if (e.re.test(text)) return { id: e.id, label: e.label };
  }
  return null;
}

/**
 * Ports we must NEVER free, even when a log names them as occupied.
 *
 * Freeing a port means killing whatever owns it. These belong to the sandbox's own infrastructure — the
 * app's database above all — so "recovering" one would take the app from "won't start" to "started and
 * lost its data store", which is strictly worse than the failure we were repairing. If a log ever names
 * one of these, we report the conflict honestly and free nothing.
 */
const PROTECTED_PORTS = new Set([5432, 3306, 6379, 27017, 1433, 9200]);

/**
 * The port that is genuinely occupied, read from the failure itself.
 *
 * ROOT CAUSE this replaces (mitrify autopsy 2026-08-05): the port used to be scraped with
 * `/(?:port\s+|:)(\d{2,5})/` over the whole log tail, which takes the FIRST number that looks like a
 * port — and a dev-server log always echoes its launch command first. On the reported build that echo
 * was `tsx server/index.ts --host 0.0.0.0 --port 3000 --strictPort` while the real failure two lines
 * later was `EADDRINUSE: address already in use 0.0.0.0:5000`. So the engine announced "Port 3000 is
 * already in use", freed 3000, and left 5000 held — wrong port in the message AND wrong port in the fix.
 *
 * This reads the ERROR forms only (never the command echo), most-specific first, and refuses the digits
 * of a dotted IP (`127.0.0.1:3000` must yield 3000, never 127). PURE.
 */
export function conflictingPortFromLog(log: string): number | null {
  const text = stripAnsi(log || '').slice(-8000);
  const patterns = [
    // Node/libuv: `listen EADDRINUSE: address already in use 0.0.0.0:5000` | `EADDRINUSE :::3000`
    /EADDRINUSE[^\n]*?[:\s]([0-9]{2,5})(?!\.?\d)/i,
    // Vite/generic: `Port 5173 is (already) in use`
    /\bport\s+([0-9]{2,5})\s+is\s+(?:already\s+)?in\s+use/i,
    // Create React App: `Something is already running on port 4100.`
    /already running on port\s+([0-9]{2,5})(?!\.?\d)/i,
    // Bare bind error with no EADDRINUSE token: `address already in use :::8080`
    /address already in use[^\n]*?[:\s]([0-9]{2,5})(?!\.?\d)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const p = Number(m[1]);
    if (!Number.isInteger(p) || p < 1 || p > 65535) continue;
    // A protected port is a real answer — just not an actionable one. Stop here rather than falling
    // through to a looser pattern that might produce a killable-looking number for the same conflict.
    return PROTECTED_PORTS.has(p) ? null : p;
  }
  return null;
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
    // The sandbox can start PostgreSQL and nothing else. Restarting an app that wants MongoDB does not
    // conjure a MongoDB, so 'reprovision_db' would burn both attempts on a certainty. Short-circuit and
    // say something the user can act on instead.
    case 'db_engine_unavailable': return 'code_fix';
    // `npm install` cannot deliver an OS binary, and a restart re-runs the same script against the same
    // missing tool. The SCRIPT must use the database client the app already has.
    case 'db_client_missing': return 'code_fix';
    case 'missing_credential': return 'code_fix'; // the key is still unset on every restart — only the SOURCE can stop crashing
    // The secret is not coming back on a restart either: it lived in a .env we deliberately never
    // import. Only the SOURCE can stop every request 500-ing.
    case 'missing_session_secret': return 'code_fix';
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
  // ANSI-stripped for the same class reason as classifyDevServerFailure (see stripAnsi): a coloured
  // "Missing STRIPE_SECRET_KEY" line would not match the word-boundary patterns below.
  const text = stripAnsi(log || '').slice(-8000);
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

/**
 * TRUE when the app's session middleware has no secret.
 *
 * ADMIN REPORT 2026-08-13 (zip import of a Replit-exported app). The boot log said, in as many words:
 *
 *     express-session deprecated req.secret; provide secret option at …/replitAuth.ts
 *     … secret option required for sessions
 *
 * and the verdict the user was shown said the opposite — "this is common for a full-stack app whose
 * client routes aren't served (only its API)". Not a routing problem at all. We printed the real cause
 * directly beneath a sentence that guessed a different one.
 *
 * WHY THIS IS A CLASS AND NOT ONE APP. Exports from Replit, Heroku and Railway lean on a
 * platform-provided session secret, and NavBharatAI deliberately never imports `.env` files
 * (SECRET_FILE_RE — we do not take somebody's secrets). So the secret is missing by DESIGN on every
 * such import, and the app 500s on its very first request while the port looks perfectly healthy.
 *
 * `missingCredentialFromLog` cannot catch it: that one extracts an UPPER_SNAKE variable NAME, and this
 * message contains no name at all — the library is describing its own option, not an env var. Hence a
 * separate detector rather than a looser pattern in that one, which would cost it the precision its
 * header promises. The phrase is express-session's own fixed wording, so matching it is exact. PURE.
 */
export function sessionSecretMissing(log: string): boolean {
  const text = stripAnsi(log || '').slice(-8000);
  return /secret option required for sessions/i.test(text)
    || /express-session\b[\s\S]{0,120}\bprovide secret option/i.test(text);
}

/**
 * Remove ANSI colour/style escape sequences from a log before pattern-matching it.
 *
 * ROOT CAUSE (mitrify autopsy 2026-08-04, "The app didn't finish starting… no recognisable error"): a
 * dev-server log is written to a TTY-like stream, so esbuild/Vite colour it. The captured text is not
 * `✘ [ERROR] Could not resolve` but `\x1b[31m✘ \x1b[41;97mERROR\x1b[0m…`. Every pattern in this file
 * anchors on a WORD BOUNDARY (`\bError:`, `\bModule not found`), and an escape sequence ends in a word
 * character (`m`), so `mERROR` has NO boundary before `E` — the match silently fails. That is a CLASS
 * bug: it can defeat any rule here, not just one, and it defeated ALL of them on the reported build,
 * which is exactly why a log full of loud red errors was classified "nothing recognisable".
 *
 * Stripping once, at the entry point, fixes the whole class rather than one pattern. PURE.
 */
export function stripAnsi(text: string): string {
  // CSI sequences (colour/style) + the standalone ESC form some tools emit.
  // eslint-disable-next-line no-control-regex
  return (text || '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b[@-Z\\-_]/g, '');
}

/**
 * The name of an executable the shell could not find, or null. THE single definition of that question.
 *
 * ROOT CAUSE (admin report 2026-08-16, build 4b744bef). The app's start script is
 * `concurrently "npm run server" "vite"`, `concurrently` was not installed, and the log said exactly
 * that — on its fourth line: `sh: 1: concurrently: not found`. The platform answered "The dev server did
 * not start and the log had no recognisable error", restarted the identical command twice, and gave up.
 * A missing binary cannot appear by itself, so both recovery attempts were spent on a certainty.
 *
 * TWO INDEPENDENT REASONS IT WAS INVISIBLE, both the same class: (1) the classifier tested
 * `/command not found/` — BASH's wording, while this sandbox's shell is `sh` (dash), which says
 * `sh: 1: NAME: not found` with no "command" in it; (2) its other test was a hardcoded list
 * (vite|next|tsc|tsx|node|npm), and a start script may run any binary (concurrently, nodemon, turbo…).
 * `devServerRunnerMissing` in this very file already matched dash correctly — two siblings, one truth,
 * separate patterns. Both now call this. The generic sibling of `sh: 1: tsx: not found` from 5b4f9b63.
 *
 * PRECISION: the name must look like a command (no spaces/metacharacters) and the `NAME:` colon is
 * required, so prose like "the file was not found" cannot match. PURE.
 */
export function missingBinaryFromLog(log: string): string | null {
  const text = stripAnsi(log || '').slice(-8000);
  // Three real shapes, in one pass:
  //   dash  — "sh: 1: concurrently: not found"        (this sandbox)
  //   bash  — "bash: vite: command not found" / "/bin/sh: createdb: command not found"
  //   bare  — "next: command not found"
  const re = /(?:^|\n)[^\n]{0,80}?(?:^|[\s:/])([A-Za-z0-9._@/-]{1,64}):\s*(?:command\s+)?not found\b/gim;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const name = m[1].replace(/^.*\//, ''); // "/usr/bin/foo" → "foo"
    // A shell prefix or a line number is the frame, never the answer.
    if (/^(?:sh|bash|dash|zsh|env|\d+)$/i.test(name)) continue;
    return name;
  }
  return null;
}

/**
 * The unresolved import specifier + the file that imported it, from an esbuild/Vite resolution error.
 *
 * WHY THE IMPORTER MATTERS (mitrify autopsy 2026-08-04): "Could not resolve" means two completely
 * different things depending on WHO could not resolve it. When the importing file lives inside
 * `node_modules/`, the INSTALL is broken — the reported build had
 * `node_modules/lucide-react/dist/esm/lucide-react.js` importing `./icons/router.js`, i.e. the package's
 * barrel file was present but its `icons/` directory was not: a partial/corrupt install that a
 * reinstall fixes and a code edit cannot. When the importer is the user's own source, it is a real code
 * error and reinstalling would waste both recovery attempts. PURE.
 */
export function unresolvedImportFromLog(log: string): { specifier: string; importer: string | null; inNodeModules: boolean } | null {
  const text = stripAnsi(log || '');
  const m = /Could not resolve\s+["']([^"'\n]+)["']/i.exec(text);
  if (!m) return null;
  const specifier = m[1];
  // esbuild prints the importing file on the NEXT non-empty line, as `path/to/file.js:LINE:COL:`.
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 500);
  const imp = /\n\s*([^\s:][^\n:]*?):\d+:\d+:/.exec(after);
  const importer = imp ? imp[1].trim() : null;
  return { specifier, importer, inNodeModules: !!importer && /(^|\/)node_modules\//.test(importer) };
}

export function classifyDevServerFailure(log: string): DevServerDiagnosis {
  // Strip ANSI FIRST (see stripAnsi): a coloured log defeats every word-boundary rule below.
  const text = stripAnsi(log || '').slice(-8000); // the tail carries the fatal line; bound the scan
  const make = (cause: DevServerFailureCause, detail: string): DevServerDiagnosis => ({ cause, recovery: recoveryFor(cause), detail });

  // 1) Port already in use — free it and retry (never a code problem). Covers Node's EADDRINUSE,
  //    Vite's "port X is in use", AND Create-React-App's phrasing "Something is already running on
  //    port 4100." (RealWorld/Conduit report 2026-07-07 — CRA's wording matched nothing, so the
  //    recovery plain-retried into the same conflict instead of freeing the port).
  if (/\bEADDRINUSE\b/i.test(text) || /port\s+\d+\s+is\s+(?:already\s+)?in\s+use/i.test(text) || /address already in use/i.test(text)
    || /already running on port\s+\d+/i.test(text)) {
    // The port comes from the ERROR, never from the echoed launch command — see conflictingPortFromLog.
    const conflict = conflictingPortFromLog(text);
    const d = make('port_in_use', `Port ${conflict ?? '(the dev-server port)'} is already in use — freeing it and restarting.`);
    return conflict ? { ...d, conflictPort: conflict } : d;
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
  // esbuild's own phrasing — "Could not resolve "./icons/router.js"" — was matched by NOTHING here, so
  // the single most common Vite/esbuild boot failure fell through to "no recognisable error" (mitrify
  // autopsy 2026-08-04). It is only a MISSING-MODULE when the importer is inside node_modules, i.e. the
  // package installed partially; when the user's own file cannot resolve an import, it is a code error
  // and a reinstall would burn both recovery attempts (handled in the code_error branch below).
  const unresolved = unresolvedImportFromLog(text);
  if (unresolved?.inNodeModules) {
    const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(unresolved.importer || '')?.[1];
    const d = make('missing_module', `The installed package${pkg ? ` "${pkg}"` : ''} is incomplete — its own file could not resolve "${unresolved.specifier}", so the install is partial/corrupt. Removing it and reinstalling dependencies, then restarting.`);
    return pkg ? { ...d, corruptPackage: pkg } : d;
  }
  if (/\bModule not found\b/i.test(text)) return make('missing_module', 'A module could not be resolved — reinstalling dependencies and restarting.');
  // 3.5) A DATABASE CLIENT TOOL, not an npm package. Caught BEFORE the generic "command not found"
  //    branch, which reinstalls node_modules — and `npm install` can never deliver an OS binary, so that
  //    branch spent a real install and a restart on a certainty. Today the same situation produced THREE
  //    different wrong answers: `psql: not found` was 'unknown' (two blind retries), `createdb: command
  //    not found` was 'missing_module' (npm install), `pg_dump: not found` was 'unknown' again.
  //    A relocatable PostgreSQL ships the SERVER only — no psql, no createdb, no pg_dump — so a script
  //    that shells out to one has to use the client the app already depends on instead.
  const clientTool = /\b(psql|createdb|dropdb|pg_dump|pg_restore|pg_isready)\b\s*:\s*(?:command\s+)?not found/i.exec(text)
    || /\bcommand not found\b[^\n]*\b(psql|createdb|dropdb|pg_dump|pg_restore|pg_isready)\b/i.exec(text);
  if (clientTool) {
    const tool = clientTool[1];
    return make('db_client_missing', `A script runs \`${tool}\`, which is not installed here — the preview's PostgreSQL ships the server only, with no command-line tools. Run this step through the database client the app already depends on (pg / Prisma / Drizzle) instead of shelling out to \`${tool}\`; installing packages cannot provide it.`);
  }

  // 3.6) ANY missing executable, named. See missingBinaryFromLog — this used to be a hardcoded list of
  //    six tool names plus a `/command not found/` test, and the sandbox's shell is `sh` (dash), which
  //    says "sh: 1: concurrently: not found" with no "command" in it. So a binary off the list was
  //    invisible twice over (build 4b744bef).
  const missingBin = missingBinaryFromLog(text);
  if (missingBin) {
    return make('missing_module', `\`${missingBin}\` is not installed — the app's start script runs it, but it is not in node_modules. Reinstalling dependencies (including devDependencies) and restarting.`);
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
  // 2.55) A DATABASE ENGINE THE SANDBOX CANNOT START. Caught right after the Postgres branch, because
  //    the two need OPPOSITE actions: Postgres can be provisioned here, MongoDB/MySQL/Redis cannot.
  //    Before this, a Mongo app's `MongoServerSelectionError … ECONNREFUSED 127.0.0.1:27017` matched
  //    nothing, fell through to the generic crash branch, and bought two blind restarts that could not
  //    possibly help — then reported "the dev server kept crashing on startup", which names the symptom
  //    and hides the cause. A restart does not conjure a MongoDB.
  const engine = unavailableDbEngine(text);
  if (engine) {
    return {
      ...make('db_engine_unavailable', `The app is trying to reach ${engine.label}, which this preview cannot start — only PostgreSQL can be started here. Connect a ${engine.label} database (Settings → App Settings → Database), or switch the app to a database available in the preview.`),
      dbEngine: engine.id,
    };
  }

  // BEFORE the generic credential scan: this failure carries no variable name, so that scan cannot see
  // it, and after it the log would fall through to a bare 'crash' with nothing useful to say.
  if (sessionSecretMissing(text)) {
    return make('missing_session_secret',
      'The app\'s login sessions have no secret key, so every page request fails. That key normally comes from an environment file, and NavBharatAI never imports those — your secrets stay yours. Fix the SOURCE: give the session middleware a secret that reads from the environment with a generated development fallback (e.g. `secret: process.env.SESSION_SECRET || crypto.randomUUID()`), so the app runs here and still uses your real key once you add SESSION_SECRET in Settings → App Settings → Secrets & API Keys.');
  }

  const missingCred = missingCredentialFromLog(text);
  if (missingCred) {
    return make('missing_credential',
      `The app refuses to start because ${missingCred} is not set — but that key is supplied later by the end user from their own account, so it is legitimately empty here. A restart can never fix this. Fix the SOURCE: delete the boot-time throw/exit for ${missingCred}, gate that feature on a boolean (e.g. \`const enabled = Boolean(process.env.${missingCred});\`), and render its control visibly disabled as "Coming soon" naming ${missingCred} and Settings → App Settings → Secrets & API Keys. Keep every other part of the app working, never crash at boot, and never fake a result.`);
  }

  // 3) Code error in the generated source — a restart can NEVER fix this; the agent must edit the code.
  // An unresolved import from the user's OWN source (not node_modules) is a code error: the file or the
  // dependency name is wrong, and no number of restarts or reinstalls changes that.
  if (unresolved && !unresolved.inNodeModules) {
    return make('code_error', `Code error in the source (a restart can't fix it): "${unresolved.specifier}" could not be resolved${unresolved.importer ? ` from ${unresolved.importer}` : ''} — fix the import path, or add the package to package.json if it is a real dependency.`);
  }
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
      return `A dependency the app needs is still missing after reinstalling. ${tail} ${d.detail.includes('incomplete') ? 'The package installed only partially — deleting node_modules and installing again usually clears it.' : 'Check that it is listed in package.json and installs cleanly.'}`.trim();
    case 'port_in_use':
      return `The port stayed occupied by another process. ${tail}`;
    case 'db_engine_unavailable':
      // NOT "recovery is exhausted" — nothing was attempted, and nothing could have been. Saying we
      // tried and failed would misdescribe a situation the user can fix in one step.
      return `${d.detail}`;
    case 'db_client_missing':
      return `${d.detail}`;
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
    case 'db_client_missing':
      // The user did not write this script and cannot install an OS package here — so this is one to
      // hand back to the assistant, not a chore to hand to them.
      return 'One of your app\'s setup steps uses a database command-line tool that is not available in the preview. Ask me to run that step through the app\'s own database library instead, and I will fix the script.';
    case 'db_engine_unavailable': {
      const label = (log ? unavailableDbEngine(log)?.label : null) ?? 'that database';
      return `Your app needs ${label} to start. This preview can only start PostgreSQL for you, so connect your own ${label} in Settings → App Settings → Database — or ask me to switch the app to a database that runs here, and I will.`;
    }
    case 'missing_module':
      return "One of the app's dependencies could not be installed, so it can't start. Ask me to fix the dependencies and I'll sort it out.";
    case 'missing_script':
      return "The app is being started with the wrong command — its package.json doesn't have that script. Ask me to fix the start command.";
    case 'port_in_use':
      // The port the ERROR named, when we know it — the watched port is only a fallback. Telling the
      // user "Port 3000 was held" when the app actually failed to bind 5000 is a false statement about
      // their own app, and it is the same wrong number that made the recovery free the wrong port.
      return `Port ${diag.conflictPort ?? port} was still being held by another process, so the app couldn't take it. Press Diagnose again in a few seconds.`;
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
  // ONE definition of "a binary was not found", shared with the classifier. These two functions used to
  // carry SEPARATE patterns and drifted: this one already knew dash's `sh: 1: X: not found` shape while
  // classifyDevServerFailure matched only bash's `command not found` against a hardcoded list of six
  // names. So the health check could correctly refuse to trust the port (this function) and, in the very
  // same breath, report "the log had no recognisable error" (that one). See missingBinaryFromLog.
  return missingBinaryFromLog(log) !== null;
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
