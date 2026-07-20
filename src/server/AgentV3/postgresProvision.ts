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
