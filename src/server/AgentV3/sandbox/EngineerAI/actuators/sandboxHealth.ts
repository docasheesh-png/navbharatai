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

/**
 * Recover the REAL exit code from a thrown command error. E2B's `commands.run` REJECTS on a non-zero
 * exit (a CommandExitError carrying `.exitCode` and a message like "exit status 2"), so a genuine
 * command failure (e.g. `tsc --noEmit` finding type errors → exit 2) would otherwise be flattened to
 * the sentinel -1 and read like the sandbox never ran it (PaisaTrack autopsy 2026-07-19: a real tsc
 * exit-2 was reported as `exit -1`, a dead-sandbox look-alike). Prefer the error's own `exitCode`; else
 * parse "exit status N" from the message. Returns -1 ONLY when the program truly never ran (SDK/network
 * throw with no exit info) — exactly the case the dead-sandbox detector then handles. PURE.
 */
export function resolveThrownCommandExit(err: unknown): number {
  const e = err as { exitCode?: unknown; message?: unknown } | null | undefined;
  if (e && typeof e.exitCode === 'number' && Number.isInteger(e.exitCode) && e.exitCode >= 0) {
    return e.exitCode;
  }
  const msg = e && typeof e.message === 'string' ? e.message : '';
  const m = /exit\s+status\s+(\d+)/i.exec(msg) || /exit\s+code[:\s]+(\d+)/i.exec(msg);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return -1; // truly could not run (no exit info) — the dead-sandbox path owns this
}

// ── Silent DB-unreachable failure (MediConnect autopsy 2026-07-19) ────────────────────────────────
//
// ROOT CAUSE (App #14, Remix + Prisma + Postgres): `npx prisma migrate dev` returned **exit 0** while
// its own output said `P1001: Can't reach database server at localhost:5432` and
// `dev server did not come up on port 5432`. The migration NEVER applied — no Postgres was running in
// the sandbox — yet the exit-0 made recordCommand log it as a benign `SANDBOX_CMD` (info, autoResolved).
// The builder, seeing "migrate succeeded", proceeded on a FALSE premise, then improvised a broken
// Postgres→SQLite downgrade that cascaded into enum/DateTime errors. A DB-connectivity failure hidden
// behind a 0 exit code is a lie the report must not repeat: exit 0 ≠ "the database was reachable".
//
// These patterns are Prisma/Postgres connectivity failures that are unambiguous even on a 0 exit — a
// health-check wrapper can swallow the real exit while still printing the failure into stdout.
const DB_UNREACHABLE_PATTERNS: RegExp[] = [
  /\bP1001\b/i,                                   // Prisma: "Can't reach database server"
  /can'?t\s+reach\s+database\s+server/i,
  /database\s+server\s+.*(is\s+not\s+running|not\s+reachable|unreachable)/i,
  /connection\s+refused.*:\s*5432|:\s*5432.*connection\s+refused/i,
];

// A Prisma SCHEMA-validation failure (broken relations, missing @id/enum) is NOT a DB-connectivity
// problem — the DB is fine, the schema is wrong (LedgerLoop autopsy 2026-07-20). Our health-check
// wrapper unhelpfully prints "did not come up on port 5432" for ANY dev-server boot failure, including
// a schema error, so that string alone must never be treated as DB-unreachable. When these markers are
// present the failure is the schema, and DB_UNREACHABLE would be a false, misleading verdict.
const SCHEMA_VALIDATION_MARKERS: RegExp[] = [
  /Validation Error Count:/i,
  /\[Context:\s*validate\]/i,
  /Prisma schema validation/i,
  /Error validating (?:model|field|datasource)/i,
  /is missing an opposite relation field/i,
];

/** True when a command is DB-provisioning/ORM-related (prisma / migrate / seed / psql / drizzle / pg). */
function isDbRelatedCommand(command: string | undefined): boolean {
  if (!command) return false;
  return /\b(prisma|migrate|drizzle|psql|pg_|createdb|sequelize)\b/i.test(command)
    || /\bseed(\.[tj]s)?\b/i.test(command);
}

/**
 * Detect a "silent" database-unreachable failure: a command that reported SUCCESS (exit 0, so the
 * normal `failed` path never fires) but whose output proves the database was never reachable, so the
 * migration/query did NOT actually happen. Requires BOTH a hard DB-unreachable output signal AND a
 * DB-related command, so an app that merely PRINTS "P1001" in a log line it's echoing is never
 * mis-flagged. Only meaningful when the command claims success (exitCode 0) — a real nonzero exit is
 * already handled by the normal failure path. Pure + unit-testable.
 */
/**
 * True when command output shows the database is genuinely UNREACHABLE (a live-connectivity failure),
 * regardless of exit code — used to trigger a mid-build Postgres RE-PROVISION when the provisioned DB
 * died (FleetOps autopsy 2026-07-20: the sandbox Postgres was reaped ~2.5 min after provisioning). Keyed
 * on the unambiguous connectivity signals only (P1001 / can't reach server / connection refused :5432);
 * a schema-validation failure is deliberately NOT included. Pure.
 */
export function looksLikeDbUnreachable(text: string | null | undefined): boolean {
  if (typeof text !== 'string' || !text) return false;
  return /\bP1001\b/i.test(text)
    || /can'?t\s+reach\s+database\s+server/i.test(text)
    || /connection\s+refused.*:\s*5432|:\s*5432.*connection\s+refused/i.test(text);
}

export function detectSilentDbFailure(sig: { command?: string; exitCode: number | null; stdout?: string; stderr?: string }): boolean {
  if (sig.exitCode !== 0) return false;              // a real nonzero exit is handled elsewhere
  if (!isDbRelatedCommand(sig.command)) return false;
  const out = `${sig.stdout || ''}\n${sig.stderr || ''}`;
  // A schema-validation failure is NOT a connectivity failure — the DB is reachable, the schema is wrong.
  // Never mislabel it DB_UNREACHABLE (the schema-repair self-heal + honest SANDBOX_CMD path own that case).
  if (SCHEMA_VALIDATION_MARKERS.some((re) => re.test(out)) && !/\bP1001\b/i.test(out)) return false;
  return DB_UNREACHABLE_PATTERNS.some((re) => re.test(out));
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

// ─── DEGRADED (alive, but pathologically slow) ────────────────────────────────────────────────────
//
// Everything above answers "is this sandbox DEAD?" — it fails fast, with a recognisable error. The
// 2026-08-15 report showed the other failure mode entirely, and nothing was watching for it:
//
//     $ ls -la client/src/  → exit 0 (97s)
//     $ ls -la server/      → exit 0 (116s)
//     $ timeout 10 npm run dev  → exit 0 (129s)      ← a 10-SECOND timeout took 129 seconds
//
// Every command SUCCEEDED. Nothing errored, nothing matched a dead-sandbox pattern, so the corpse
// detector correctly said "healthy" — and the build spent 36 minutes on a machine where listing a
// directory cost two minutes. It had also lost 149 of 149 files at startup. The user gave up.
//
// A directory listing is O(directory) work with no project, network or dependency involvement: if it
// takes longer than a coffee sip, the machine is the problem, not the command. That makes trivial
// commands a clean, false-positive-resistant probe — which is exactly why they are the ONLY ones
// measured here. An `npm install` legitimately takes minutes, so its slowness proves nothing.
//
// The remedy reuses the proven path rather than inventing one: a degraded sandbox is treated like a
// dead one — evicted, so the next `getSandbox` creates a fresh sandbox and replays the cached files.
// That machinery already exists for the dead case and has been in production since 2026-07-05.

/**
 * Commands whose runtime says something about the MACHINE rather than the work.
 *
 * Deliberately tiny. Every entry must be O(1)-ish, dependency-free and network-free, so a slow one
 * can only mean the sandbox itself. `npm`, `git`, `curl`, builds and tests are all excluded on
 * purpose: they are legitimately slow, and judging them would produce exactly the false positives
 * that make a health check untrustworthy.
 */
const TRIVIAL_COMMAND = /^\s*(ls|pwd|echo|cat|true|whoami|which|test|stat|head|tail|wc|basename|dirname)\b/;

/** True when this command's duration is evidence about the sandbox, not about the work. Pure. */
export function isTrivialCommand(command: string | null | undefined): boolean {
  if (!command) return false;
  // A pipe or chain can hide real work behind a trivial-looking head (`ls | xargs npm view`), so only
  // a genuinely simple invocation qualifies as a probe.
  if (/[|;&]|\$\(|`/.test(command)) return false;
  return TRIVIAL_COMMAND.test(command);
}

/**
 * How slow a trivial command has to be before it is evidence of a sick machine.
 *
 * 30s is far above any healthy value (these normally return in well under a second, and even a
 * contended sandbox answers within a few) and far below what the report actually measured (97s, 116s).
 * The gap between "normal" and "broken" here is two orders of magnitude, so the exact threshold is not
 * delicate — it only has to sit inside that gap.
 */
export const SLOW_TRIVIAL_MS = 30_000;

/**
 * How many slow trivial commands before acting.
 *
 * One could be a genuine one-off (a cold page cache, a noisy neighbour). Two is a pattern. Requiring
 * two costs at most one extra slow command and removes the entire class of single-blip false
 * positives — worth it, because the action is throwing away a machine mid-build.
 */
export const SLOW_TRIVIAL_STRIKES = 2;

export interface SandboxLatencyState { strikes: number }

export function newSandboxLatencyState(): SandboxLatencyState {
  return { strikes: 0 };
}

/**
 * Record one command's latency; returns true the moment the sandbox should be considered DEGRADED.
 *
 * Returns true only on the transition, so a caller can act once instead of on every subsequent
 * command — evicting a sandbox repeatedly would be its own kind of thrash.
 */
export function recordCommandLatency(
  state: SandboxLatencyState,
  command: string | null | undefined,
  durationMs: number,
): boolean {
  if (!isTrivialCommand(command)) return false;
  if (!(typeof durationMs === 'number' && durationMs >= SLOW_TRIVIAL_MS)) return false;
  state.strikes++;
  return state.strikes === SLOW_TRIVIAL_STRIKES;
}

/** The honest report line — it names the evidence, so the verdict can be checked rather than believed. */
export function degradedSandboxSummary(command: string, durationMs: number): string {
  return `The build machine was running abnormally slowly — \`${command.trim().slice(0, 60)}\` took ${Math.round(durationMs / 1000)}s, which should be instant. Switched to a fresh machine and restored your files.`;
}
