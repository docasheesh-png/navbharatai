import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { braceBlock } from '../../../tests/helpers/sourceSlice';
import {
  isProductionSafeCommand, planProductionMigration, migrationOutcome,
  PRODUCTION_SAFE_COMMANDS,
} from './productionMigration';
import { detectMigrationPlan } from './MigrationPlanner';
import type { MigrationPlan } from './MigrationPlanner';

/**
 * NOTHING DESTRUCTIVE REACHES A LIVE DATABASE.
 *
 * `prisma migrate deploy` is safe; `prisma migrate reset` drops every table. One word apart, same tool.
 * Today's MigrationPlanner emits only the safe verbs — but the guard cannot depend on that, because the
 * whole point is to survive a future edit there by someone who never reads this file. These tests are
 * the boundary itself, not a description of it.
 */

const PROD = 'postgresql://u:p@db.example.com:5432/app';

describe('isProductionSafeCommand — an allowlist, failing CLOSED', () => {
  it('accepts each documented non-interactive apply verb', () => {
    for (const cmd of [
      'npx prisma migrate deploy', 'npx prisma generate', 'npx drizzle-kit migrate',
      'npx knex migrate:latest', 'npx typeorm migration:run', 'npx sequelize-cli db:migrate',
      'flyway migrate', 'alembic upgrade head',
    ]) expect(isProductionSafeCommand(cmd)).toBe(true);
  });

  it('REFUSES the table-dropping sibling of the command it allows', () => {
    // The single most important assertion in this file.
    expect(isProductionSafeCommand('npx prisma migrate reset')).toBe(false);
    expect(isProductionSafeCommand('npx prisma migrate reset --force')).toBe(false);
    expect(isProductionSafeCommand('npx prisma db push --accept-data-loss')).toBe(false);
  });

  it('refuses anything it does not recognise, rather than allowing what it cannot name', () => {
    for (const cmd of [
      'npx prisma migrate dev', 'rm -rf /', 'psql -c "DROP TABLE users"',
      'npm run migrate', 'npx some-new-tool apply', '',
    ]) expect(isProductionSafeCommand(cmd)).toBe(false);
  });

  it('refuses command CHAINING — one command means one command', () => {
    // The exact-match allowlist already stops these; this pins the second, independent guard, which is
    // what would still hold if the allowlist were ever loosened to a prefix match.
    expect(isProductionSafeCommand('npx prisma migrate deploy && npx prisma migrate reset')).toBe(false);
    expect(isProductionSafeCommand('npx prisma migrate deploy; drop database app')).toBe(false);
    expect(isProductionSafeCommand('npx prisma migrate deploy | tee out')).toBe(false);
  });

  it('the allowlist stays SHORT — a long one is a review failure, not a feature', () => {
    expect(PRODUCTION_SAFE_COMMANDS.length).toBeLessThanOrEqual(10);
  });
});

describe('planProductionMigration — refuses far more often than it runs', () => {
  const prismaPlan: MigrationPlan[] = [{ tool: 'prisma', commands: ['npx prisma generate', 'npx prisma migrate deploy'], reason: 'x' }];

  it('runs for a Postgres app that really has migrations', () => {
    const r = planProductionMigration({ plans: prismaPlan, productionUrl: PROD });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tool).toBe('prisma');
      expect(r.commands).toEqual(['npx prisma generate', 'npx prisma migrate deploy']);
      expect(r.summary).toContain('Nothing is deleted');
    }
  });

  it('no connected database ⇒ honest refusal naming the screen that fixes it', () => {
    const r = planProductionMigration({ plans: prismaPlan, productionUrl: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('no-database'); expect(r.message).toContain('Settings → App Settings → Database'); }
  });

  it('a NON-Postgres database is refused honestly, not attempted hopefully', () => {
    // We would not be able to tell whether it worked, and a confident "done" would be the lie.
    for (const url of ['mysql://u:p@h/db', 'mongodb+srv://u:p@c.net/db', 'not a url']) {
      const r = planProductionMigration({ plans: prismaPlan, productionUrl: url });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not-postgres');
    }
  });

  it('an app with no migration tool is a NO-OP, not a failure', () => {
    const r = planProductionMigration({ plans: [], productionUrl: PROD });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('no-migrations'); expect(r.message).toContain('nothing to apply'); }
  });

  it('ONE unsafe command poisons the whole plan — nothing partial runs', () => {
    const poisoned: MigrationPlan[] = [{ tool: 'prisma', commands: ['npx prisma generate', 'npx prisma migrate reset'], reason: 'x' }];
    const r = planProductionMigration({ plans: poisoned, productionUrl: PROD });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unsafe-command');
  });

  it('the refusal never leaks the raw command to the user', () => {
    const poisoned: MigrationPlan[] = [{ tool: 'prisma', commands: ['npx prisma migrate reset --force'], reason: 'x' }];
    const r = planProductionMigration({ plans: poisoned, productionUrl: PROD });
    if (!r.ok) { expect(r.message).not.toContain('reset'); expect(r.message).not.toContain('--force'); }
  });

  it('an empty command list is refused, not treated as "successfully did nothing"', () => {
    const empty: MigrationPlan[] = [{ tool: 'knex', commands: [], reason: 'x' }];
    const r = planProductionMigration({ plans: empty, productionUrl: PROD });
    expect(r.ok).toBe(false);
  });

  it('null/undefined inputs never throw', () => {
    expect(planProductionMigration({ plans: null, productionUrl: null }).ok).toBe(false);
    expect(planProductionMigration({ plans: undefined, productionUrl: undefined }).ok).toBe(false);
  });
});

describe('the REAL detector feeds this gate — the two must stay compatible', () => {
  it('every command the live MigrationPlanner emits for a Prisma app is accepted', () => {
    // A contract test, not a duplicate: it runs the actual producer, so if someone adds a destructive
    // verb there this fails HERE — which is the whole point of putting the guard at the boundary.
    const plans = detectMigrationPlan(
      ['prisma/schema.prisma', 'package.json'],
      JSON.stringify({ dependencies: { '@prisma/client': '^5', prisma: '^5' } }),
    );
    expect(plans.length).toBeGreaterThan(0);
    const gated = planProductionMigration({ plans, productionUrl: PROD });
    expect(gated.ok).toBe(true);
  });

  it('and for every other tool it detects', () => {
    const cases: Array<[string[], string]> = [
      [['drizzle.config.ts'], JSON.stringify({ dependencies: { 'drizzle-orm': '^0.3' } })],
      [['knexfile.js'], JSON.stringify({ dependencies: { knex: '^3' } })],
      [['alembic.ini'], '{}'],
      [['flyway.conf'], '{}'],
    ];
    for (const [files, pkg] of cases) {
      const plans = detectMigrationPlan(files, pkg);
      if (plans.length === 0) continue;
      expect(planProductionMigration({ plans, productionUrl: PROD }).ok).toBe(true);
    }
  });
});

describe('migrationOutcome — reads the real exit code, never assumes', () => {
  it('a non-zero exit is a failure, and says the app is published but cannot save data', () => {
    const r = migrationOutcome(1, 'Error: relation already exists');
    expect(r.outcome).toBe('failed');
    expect(r.message).toContain('still published');
  });

  it('"no pending migrations" is SUCCESS — a re-publish hits it every time', () => {
    // Reporting this as an error would teach users to ignore a real one.
    for (const out of ['No pending migrations to apply.', 'Already up to date', 'nothing to migrate']) {
      expect(migrationOutcome(0, out).outcome).toBe('nothing-to-apply');
    }
  });

  it('a clean apply is reported as applied', () => {
    expect(migrationOutcome(0, 'Applying migration `20260808_init`').outcome).toBe('applied');
  });

  it('a zero exit with unrecognised output is "applied", never silently "failed"', () => {
    expect(migrationOutcome(0, '').outcome).toBe('applied');
  });
});

/**
 * THE WIRING (rule 2 — a guard with no caller is dead code, which is the exact defect this session
 * spent the day removing: a real Render deploy engine that nothing in the client ever called).
 */
describe('the deploy tool actually runs this', () => {
  const dispatcher = readFileSync(join(__dirname, 'ToolDispatcher.ts'), 'utf8');
  const fn = braceBlock(dispatcher, 'private async migrateProductionDatabase');

  it('is called from the deploy tool, after the URL exists', () => {
    expect(dispatcher).toContain('await this.migrateProductionDatabase()');
    // The app is already live by then; a migration problem must be reported, never turn a successful
    // publish into a failed one.
    expect(dispatcher).toContain("this.migrateProductionDatabase().catch(() => '')");
  });

  it('only ever targets the USER\'s own database, never the sandbox one', () => {
    expect(fn).toContain('isUserOwnedDatabaseUrl(productionUrl)');
  });

  it('re-checks every command at the moment it runs, not only when planned', () => {
    // Planning and running are separated by awaits, and this is the last line before a command
    // touches live data.
    expect(fn).toContain('if (!isProductionSafeCommand(command))');
  });

  it('puts NO secret on the command line — recordCommand stores commands unredacted', () => {
    expect(fn).not.toContain('DATABASE_URL=${');
    expect(fn).not.toContain('productionMigrationEnv');
  });

  it('stops at the first failed command instead of running the rest', () => {
    expect(fn).toContain("if (step.outcome === 'failed') return");
  });

  it('stays silent when there is genuinely nothing to say', () => {
    // "This app has no migration tool" is true but useless noise on a successful publish.
    expect(fn).toContain("decision.reason === 'no-migrations' || decision.reason === 'no-database' ? ''");
  });
});
