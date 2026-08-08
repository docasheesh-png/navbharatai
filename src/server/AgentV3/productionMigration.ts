// Applying an app's OWN migrations to the DURABLE database it will live on after publish.
//
// THE GAP THIS CLOSES (admin's own words in the old ROADMAP_NO1: "Asli gap: PRODUCTION DB"). Everything
// else in the chain is built — the sandbox provisions a Postgres for development, `generate_db_config`
// wires the app to the user's own database, Database Studio reads it, and the publish gate now refuses
// to ship a data-storing app with nowhere to put the data. But the sandbox's Postgres dies when the
// build ends, so a published app points at a durable database that has NO TABLES IN IT. The app loads,
// and then every signup, order and booking fails against a schema that was never created there.
//
// `MigrationPlanner` already detects WHICH migration tool a project uses and what to run. That runs
// inside the sandbox, against the throwaway database. This module is the other half: deciding whether
// those same migrations may be pointed at the user's REAL database, and refusing when they may not.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: nothing destructive ever reaches a live database.
//
// `prisma migrate deploy` is safe. `prisma migrate reset` DROPS EVERY TABLE. They differ by one word,
// they come from the same tool, and today's `MigrationPlanner` happens to emit only the safe one — but
// "happens to" is not a guarantee. A future edit there, or a new tool added by someone who has never
// read this file, would silently send a table-dropping command at somebody's production data.
//
// So the check does NOT live at the producer and is NOT a review convention. Every command is matched
// against an ALLOWLIST of known-safe apply verbs at the point it would enter production, and anything
// unrecognised is refused — not warned about, refused. An allowlist fails CLOSED: an unfamiliar command
// is treated as dangerous by default, which is the only correct direction when the cost of being wrong
// is a user's live data. PURE — no I/O, so the boundary is tested directly rather than assumed.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import type { MigrationPlan } from './MigrationPlanner';
import { isPostgresUrl } from '../lib/postgresQuery';

/**
 * Commands allowed to run against a LIVE database.
 *
 * Deliberately exact and deliberately short. Each entry is a tool's documented non-interactive "apply
 * the pending migrations" verb — the operation whose whole contract is that it only moves forward.
 * Adding to this list means asserting that a command can never destroy data; do not add one to make a
 * test pass.
 */
export const PRODUCTION_SAFE_COMMANDS: readonly RegExp[] = [
  /^npx prisma generate$/,                    // codegen only — touches no database at all
  /^npx prisma migrate deploy$/,              // the production apply; never resets, never prompts
  /^npx drizzle-kit migrate$/,
  /^npx knex migrate:latest$/,
  /^npx typeorm migration:run$/,
  /^npx sequelize-cli db:migrate$/,
  /^flyway migrate$/,
  /^alembic upgrade head$/,
];

/**
 * Shapes that must NEVER reach a live database, checked BEFORE the allowlist.
 *
 * Strictly redundant — an allowlist already refuses everything it does not recognise — and kept anyway
 * as a second, independent reason to refuse. If someone ever loosens the allowlist (say to a prefix
 * match, which would make `npx prisma migrate deploy` accept a trailing `&& prisma migrate reset`),
 * this still catches the destructive verb. Defence in depth is cheap here and the failure is not.
 */
export const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /\breset\b/i, /\bdrop\b/i, /\btruncate\b/i, /\bdelete\b/i,
  /\bwipe\b/i, /\bforce\b/i, /--accept-data-loss/i, /\bdb\s+push\b/i,
  /[;&|]/,                                     // command chaining — one command means one command
];

/** True only for a command this module will point at a user's live database. PURE. */
export function isProductionSafeCommand(command: string): boolean {
  const cmd = String(command ?? '').trim();
  if (!cmd) return false;
  if (DESTRUCTIVE_PATTERNS.some((p) => p.test(cmd))) return false;
  return PRODUCTION_SAFE_COMMANDS.some((p) => p.test(cmd));
}

export type ProductionMigrationRefusal =
  | 'no-database'        // nothing durable to migrate to
  | 'not-postgres'       // we can only speak to Postgres today, and we say so rather than guessing
  | 'no-migrations'      // the app has no migration tool — nothing to apply, and that is fine
  | 'unsafe-command';    // a command we will not point at live data

export interface ProductionMigrationPlan {
  ok: true;
  tool: MigrationPlan['tool'];
  /** Verified safe, in order. */
  commands: string[];
  /** Written for the user — says what is about to happen to their real database. */
  summary: string;
}

export interface ProductionMigrationRefused {
  ok: false;
  reason: ProductionMigrationRefusal;
  /** Written for the user; names the next action where there is one. */
  message: string;
}

/**
 * Decide whether this app's migrations may be applied to `productionUrl`, and exactly what would run.
 *
 * Takes the ALREADY-DETECTED plans rather than re-detecting, so there is one detector in the codebase
 * and this module is only ever the gate. When several tools are detected the FIRST is used, matching
 * `MigrationPlanner`'s own ordering — a project with two migration tools is unusual enough that
 * guessing between them would be worse than being predictable. PURE.
 */
export function planProductionMigration(opts: {
  plans: MigrationPlan[] | null | undefined;
  productionUrl: string | null | undefined;
}): ProductionMigrationPlan | ProductionMigrationRefused {
  const url = String(opts.productionUrl ?? '').trim();
  if (!url) {
    return {
      ok: false, reason: 'no-database',
      message: 'Your app has no database connected, so there are no tables to create. Connect one in Settings → App Settings → Database.',
    };
  }
  if (!isPostgresUrl(url)) {
    // Honest rather than optimistic: we would not know whether the migration even applied.
    return {
      ok: false, reason: 'not-postgres',
      message: 'NavBharatAI can set up tables automatically on PostgreSQL databases. For this one, run your app\'s migrations from your database provider\'s own console once.',
    };
  }

  const plans = (opts.plans || []).filter(Boolean);
  if (plans.length === 0) {
    return {
      ok: false, reason: 'no-migrations',
      message: 'This app does not use a migration tool, so there is nothing to apply — its database is ready as-is.',
    };
  }

  const plan = plans[0];
  const commands = (plan.commands || []).map((c) => String(c ?? '').trim()).filter(Boolean);
  const unsafe = commands.find((c) => !isProductionSafeCommand(c));
  if (unsafe || commands.length === 0) {
    // Named, not silently skipped: an unrecognised command is a thing a human must look at, and the
    // build report should carry it. The user-facing line stays free of the raw command.
    return {
      ok: false, reason: 'unsafe-command',
      message: 'NavBharatAI did not recognise this app\'s database setup command as safe to run on a live database, so it did not run it. Apply your migrations from your database provider\'s console.',
    };
  }

  return {
    ok: true,
    tool: plan.tool,
    commands,
    summary: `Creating your app's tables on the database you connected (${plan.tool}). Nothing is deleted — this only adds what is missing.`,
  };
}

export type MigrationOutcome = 'applied' | 'nothing-to-apply' | 'failed';

/**
 * What actually happened, from the command's real exit code and output.
 *
 * "No pending migrations" is a SUCCESS, not a failure — a re-publish of an unchanged app hits it every
 * time, and reporting that as an error would teach users to ignore a real one. A non-zero exit is
 * always a failure; we never read a zero exit as proof the tables exist, only as proof the tool said
 * it was done. PURE.
 */
export function migrationOutcome(exitCode: number, output: string): { outcome: MigrationOutcome; message: string } {
  const text = String(output ?? '');
  if (exitCode !== 0) {
    return {
      outcome: 'failed',
      message: 'Your app\'s tables could not be created on your database. Your app is still published — it will not be able to save data until this is fixed.',
    };
  }
  if (/no pending migrations|already up to date|nothing to migrate|no migrations to apply/i.test(text)) {
    return { outcome: 'nothing-to-apply', message: 'Your database was already up to date — no changes were needed.' };
  }
  return { outcome: 'applied', message: 'Your app\'s tables are set up on your database. Your published app can save and read data.' };
}
