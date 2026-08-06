// AgentV3 — LAZY POSTGRES PROVISIONING decisions (MediConnect autopsy 2026-07-19).
//
// ROOT CAUSE (App #14, Remix + Prisma + PostgreSQL): the from-scratch full-stack build flow NEVER
// provisioned a Postgres server in the sandbox — the `provisionBackend(['db'])` path (which installs +
// starts Postgres + createdb + returns DATABASE_URL) was wired ONLY into the imported-app preview path
// (routes/agentv3.ts). So when the builder ran `npx prisma migrate dev` against a `provider="postgresql"`
// schema, there was nothing at localhost:5432 → P1001 → the builder improvised a broken SQLite downgrade.
//
// THE FIX (admin-chosen strategy 2026-07-19: "provision real Postgres in sandbox"): provision the SAME
// proven Postgres the imported path uses, LAZILY — the first time the builder is about to run a command
// that genuinely needs a live database, AND only when the app's Prisma schema actually targets Postgres.
// This module is the PURE decision layer (no I/O), so both "does this command need a DB?" and "does this
// schema target Postgres?" are unit-testable; the ToolDispatcher wires the actual provision + `.env` write.
//
// Kill switch: AGENTV3_SANDBOX_POSTGRES=off → never provision (reverts to today's behaviour exactly).

export function sandboxPostgresEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_SANDBOX_POSTGRES ?? '').trim().toLowerCase() !== 'off';
}

/**
 * True when a sandbox command genuinely needs a LIVE database connection to succeed:
 *   • `prisma migrate …` / `prisma db push` / `prisma db seed` — connect + apply schema
 *   • a seed script (`tsx prisma/seed.ts`, `ts-node … seed`, `node … seed.js`, `prisma db seed`)
 * NOT `prisma generate` (offline codegen) and NOT `prisma format`/`validate` (no connection).
 * A dev-server start is intentionally EXCLUDED here — the boot path provisions separately; this is the
 * build-time migrate/seed gate. Pure + unit-testable.
 */
export function commandNeedsLiveDatabase(command: string): boolean {
  if (typeof command !== 'string' || !command.trim()) return false;
  // prisma migrate (dev/deploy/reset) and db push/seed/execute all open a real connection.
  if (/\bprisma\s+migrate\b/i.test(command)) return true;
  if (/\bprisma\s+db\s+(push|seed|execute)\b/i.test(command)) return true;
  // A seed script run directly (the common `tsx prisma/seed.ts` / `ts-node prisma/seed` / `node …seed.js`).
  if (/\b(?:tsx|ts-node|node|bun)\b[^\n]*\bseed(?:\.[tj]s)?\b/i.test(command)) return true;
  // `prisma generate`, `prisma format`, `prisma validate` do NOT need a live DB.
  return false;
}

/**
 * Does a Prisma schema's datasource target PostgreSQL? Matches `provider = "postgresql"` inside a
 * `datasource … { … }` block (whitespace/quote tolerant). Returns false for sqlite/mysql/mongodb or a
 * schema with no datasource. Pure — the caller reads prisma/schema.prisma and passes the content.
 */
export function schemaTargetsPostgres(schemaContent: string | null | undefined): boolean {
  if (typeof schemaContent !== 'string' || !schemaContent) return false;
  return /datasource\s+\w+\s*\{[^}]*provider\s*=\s*["']postg(?:res|resql)["'][^}]*\}/is.test(schemaContent);
}

/**
 * Given a provisioned DATABASE_URL, produce the `.env` line map to merge into the workspace `.env` so
 * Prisma (which auto-loads `.env`) sees the connection string. Empty url → no lines. Pure.
 */
export function postgresEnvLines(databaseUrl: string | null | undefined): Record<string, string> {
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) return {};
  return { DATABASE_URL: databaseUrl.trim() };
}

/**
 * Merge a KEY=value into a `.env` file's text, replacing an existing line for KEY (preserving every other
 * line) or appending it when absent. Used to write a provisioned DATABASE_URL into a FIRST-TIME app's .env
 * without clobbering the user's other vars. Returns the new .env content. Pure + unit-testable.
 */
export function mergeEnvVar(envContent: string | null | undefined, key: string, value: string): string {
  const k = String(key).trim();
  if (!k) return typeof envContent === 'string' ? envContent : '';
  const line = `${k}=${value}`;
  const existing = typeof envContent === 'string' ? envContent : '';
  const keyRe = new RegExp(`^\\s*(?:export\\s+)?${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=.*$`, 'm');
  if (keyRe.test(existing)) return existing.replace(keyRe, line);
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  return `${existing}${sep}${line}\n`;
}

// ── Postgres LIVENESS: keepalive watchdog + preflight probe (last-5-reports gap analysis 2026-07-20) ──
//
// THE CLASS behind five consecutive build reports (#14 MediConnect → #18 EstateNest): the sandbox
// Postgres DIES between touchpoints (E2B reaps the daemon minutes after provision), and every fix so far
// was REACTIVE — a command had to FAIL with P1001 before a revival ran, costing a failed command plus the
// LLM turns spent reading the error. Two structural closures:
//   • WATCHDOG — a tiny in-sandbox loop, started at provision time, that restarts the cluster within
//     ~20s of it dying. The reap self-heals BEFORE any command can hit it; the reactive nets (mid-build
//     revival, preview-boot reprovision) become rare last resorts instead of the primary path.
//   • PREFLIGHT — before any live-DB command, a millisecond-cheap `pg_isready` probe; if the DB is down,
//     revive FIRST and run the command ONCE, instead of fail → diagnose → revive → retry.
// Both are pure command builders here; the actuator/dispatcher own the I/O. Same kill switch
// (AGENTV3_SANDBOX_POSTGRES=off) governs the whole regime.

import { pgUpCommand, pgStartCommand } from './sandbox/pgShell';

/** Marker embedded as the watchdog shell's $0 so `pgrep -f` can find (and not duplicate) it. */
export const POSTGRES_WATCHDOG_MARKER = 'nb_pg_watchdog';

/**
 * The keepalive watchdog launch command: starts ONE background loop (guarded by pgrep on the $0 marker,
 * so repeated provisions never stack watchdogs) that restarts the Postgres cluster whenever pg_isready
 * fails. Detached via nohup + setsid so it outlives the provisioning command. Pure.
 */
export function postgresWatchdogCommand(): string {
  // The up-check and the start are the SHARED ones (pgShell). They used to be written inline here in
  // terms of pg_isready + pg_ctlcluster, which meant that the moment the sandbox got its Postgres from
  // anywhere else, this loop read "down" every 20 seconds and then ran a command that does not exist —
  // a busy loop that could never revive anything. A reaped database then never came back and the build
  // died half way through. See pgShell for the whole class.
  return `if ! pgrep -f ${POSTGRES_WATCHDOG_MARKER} >/dev/null 2>&1; then
  nohup setsid sh -c 'while true; do
  if ! ${pgUpCommand()}; then
    ${pgStartCommand()}
  fi
  sleep 20
done' ${POSTGRES_WATCHDOG_MARKER} >/tmp/${POSTGRES_WATCHDOG_MARKER}.log 2>&1 &
fi
echo WATCHDOG_ARMED`;
}

/** The millisecond-cheap liveness probe run BEFORE a live-DB command. Prints PG_UP / PG_DOWN. Pure. */
export function postgresPreflightProbeCommand(): string {
  // SHARED up-check. As a bare `pg_isready` this reported PG_DOWN for a perfectly healthy database
  // whenever the image had no client tools — burning the bounded revivals and releasing the provider
  // lock into the SQLite downgrade the lock exists to prevent.
  return `${pgUpCommand()} && echo PG_UP || echo PG_DOWN`;
}

/**
 * Should the dispatcher run the preflight probe before this command? Only when a Postgres was actually
 * provisioned this build, it is not confirmed dead, the command needs a live DB, and provisioning didn't
 * JUST happen (a probe right after a fresh provision is pure waste — it was verified ready then).
 * Pure + unit-testable; the dispatcher supplies its own state.
 */
export function shouldPreflightPostgres(state: {
  provisioned: boolean;
  confirmedDead: boolean;
  needsLiveDb: boolean;
  provisionedAtMs: number;
  nowMs: number;
}): boolean {
  const { provisioned, confirmedDead, needsLiveDb, provisionedAtMs, nowMs } = state;
  if (!provisioned || confirmedDead || !needsLiveDb) return false;
  return nowMs - provisionedAtMs > 15_000;
}

/**
 * May the engine attempt (another) Postgres revival? Bounded, but NOT once-only — a 60-minute two-window
 * build can see the sandbox reap Postgres more than once, and FleetOps/EstateNest proved a restart
 * genuinely works. Once-only (the old flag) forced a SQLite downgrade on the second death even though a
 * cheap restart would have saved the app. Cap at 2 revivals per build; past that, confirmed-dead +
 * lock-release remains the honest degrade. Pure.
 */
export const POSTGRES_MAX_REVIVALS = 2;
export function canAttemptPostgresRevival(attempts: number, max: number = POSTGRES_MAX_REVIVALS): boolean {
  return Number.isFinite(attempts) && attempts >= 0 && attempts < Math.max(1, max);
}

// ── Postgres-provider LOCK (LedgerLoop autopsy 2026-07-20) ─────────────────────────────────────────
//
// ROOT CAUSE the lock closes: on BOTH MediConnect (#14) and LedgerLoop (#15) the builder, when its
// Postgres migrate failed (a genuinely-unreachable DB the first time, a BROKEN SCHEMA the second), wrote
// the schema's datasource back to `provider = "sqlite"` — silently downgrading a PostgreSQL app the user
// explicitly asked for, and triggering the enum/DateTime SQLite cascade. Provisioning Postgres (Slice 2)
// removes the DB excuse, but nothing STOPS the LLM from flipping the provider when it misreads a schema
// error as "no database". The lock is the guarantee: once an app is known to target Postgres, a schema
// write that flips the datasource to sqlite is reverted to postgresql (url restored to env("DATABASE_URL")).
// The builder is nudged to FIX THE SCHEMA instead of downgrading. Pure — the dispatcher owns the state.

/** True if a Prisma schema's datasource targets SQLite (the downgrade we must revert when locked). Pure. */
export function schemaTargetsSqlite(content: string | null | undefined): boolean {
  if (typeof content !== 'string' || !content) return false;
  return /datasource\s+\w+\s*\{[^}]*provider\s*=\s*["']sqlite["'][^}]*\}/is.test(content);
}

/**
 * Revert a SQLite datasource back to PostgreSQL: `provider = "sqlite"` → `provider = "postgresql"` and a
 * `url = "file:…"` → `url = env("DATABASE_URL")`, ONLY inside the `datasource` block. No-op if the schema
 * doesn't target sqlite. Returns { content, reverted } so the caller can nudge only when it actually
 * changed something. Pure + unit-testable.
 */
export function revertSqliteToPostgres(content: string): { content: string; reverted: boolean } {
  if (typeof content !== 'string' || !schemaTargetsSqlite(content)) return { content, reverted: false };
  const out = content.replace(/datasource\s+\w+\s*\{[^}]*\}/is, (block) =>
    block
      .replace(/provider\s*=\s*["']sqlite["']/i, 'provider = "postgresql"')
      .replace(/url\s*=\s*["']file:[^"']*["']/i, 'url = env("DATABASE_URL")'),
  );
  return { content: out, reverted: out !== content };
}

/**
 * Hosts that mean "the sandbox's own throwaway Postgres" rather than a database the user owns.
 * `db`/`postgres` are the docker-compose service names a generated `docker-compose.yml` uses; there is
 * no docker in the sandbox, so such a URL is a scaffold default, never a real user database.
 */
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'db', 'postgres', 'database']);

/**
 * Is this `DATABASE_URL` a REAL database the user owns, rather than the sandbox-local one we provision?
 *
 * ROOT CAUSE (admin question 2026-08-06, "user apna db ka link credentials dega"): a user CAN connect
 * their own database (Settings → App Settings → Database writes `DATABASE_URL` into their encrypted
 * vault, and the build injects it into the app's `.env`). But `ensureSandboxPostgres` then provisioned a
 * sandbox-local Postgres and merged `postgresql://postgres@localhost:5432/myapp` OVER it — the vault
 * value loses because the merge lets the newer value win. So the user connected their database, we
 * silently pointed their app somewhere else, and nothing said so. Their explicit choice was discarded.
 *
 * The safe direction is deliberate: an UNRECOGNISED host counts as the user's, so at worst we skip
 * provisioning and the app reports an honest connection error — never "we quietly replaced the database
 * you chose". A `file:` URL is SQLite and names no server at all. PURE.
 */
export function isUserOwnedDatabaseUrl(url: string | null | undefined): boolean {
  const raw = String(url ?? '').trim().replace(/^["']|["']$/g, '');
  if (!raw) return false;
  if (/^file:/i.test(raw)) return false; // SQLite — a local file, not a server we could point elsewhere
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return false; // not a connection URL (e.g. a placeholder)
  let host = '';
  try {
    host = new URL(raw).hostname;
  } catch {
    // Some Postgres URLs carry characters Node's URL parser rejects (an unencoded password). Fall back
    // to reading the authority directly rather than treating a real remote database as unknown.
    host = /@([^/:?#]+)/.exec(raw)?.[1] ?? '';
  }
  host = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  return !LOCAL_DB_HOSTS.has(host);
}
