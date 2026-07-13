import { describe, it, expect } from 'vitest';
import { detectMigrationPlan, migrationPlanSummary } from './MigrationPlanner';

const pkg = (deps: Record<string, string> = {}, dev: Record<string, string> = {}) =>
  JSON.stringify({ dependencies: deps, devDependencies: dev });

describe('detectMigrationPlan', () => {
  it('detects Prisma from schema.prisma with a generate-then-deploy plan', () => {
    const plans = detectMigrationPlan(['prisma/schema.prisma', 'src/index.ts'], pkg({ '@prisma/client': '^5' }));
    expect(plans).toHaveLength(1);
    expect(plans[0].tool).toBe('prisma');
    expect(plans[0].commands).toEqual(['npx prisma generate', 'npx prisma migrate deploy']);
  });

  it('detects Knex from a knexfile', () => {
    const plans = detectMigrationPlan(['knexfile.ts'], pkg({ knex: '^3' }));
    expect(plans[0].tool).toBe('knex');
    expect(plans[0].commands).toEqual(['npx knex migrate:latest']);
  });

  it('detects Drizzle from drizzle.config.ts', () => {
    const plans = detectMigrationPlan(['drizzle.config.ts'], pkg({}, { 'drizzle-kit': '^0.20' }));
    expect(plans[0].tool).toBe('drizzle');
    expect(plans[0].commands).toEqual(['npx drizzle-kit migrate']);
  });

  it('detects TypeORM and Sequelize from deps/config', () => {
    expect(detectMigrationPlan([], pkg({ typeorm: '^0.3' }))[0].tool).toBe('typeorm');
    expect(detectMigrationPlan(['.sequelizerc'], pkg())[0].tool).toBe('sequelize');
  });

  it('detects Flyway (flyway.conf) and Alembic (alembic.ini)', () => {
    expect(detectMigrationPlan(['flyway.conf'])[0].commands).toEqual(['flyway migrate']);
    expect(detectMigrationPlan(['migrations/alembic.ini'])[0].commands).toEqual(['alembic upgrade head']);
  });

  it('can detect more than one tool in a polyglot repo', () => {
    const plans = detectMigrationPlan(['prisma/schema.prisma', 'alembic.ini']);
    expect(plans.map((p) => p.tool).sort()).toEqual(['alembic', 'prisma']);
  });

  it('returns [] when no migration tool is present (honest "nothing to migrate")', () => {
    expect(detectMigrationPlan(['src/App.tsx', 'package.json'], pkg({ react: '^18' }))).toEqual([]);
  });
});

describe('migrationPlanSummary', () => {
  it('renders each plan, or an explicit no-migrations line', () => {
    expect(migrationPlanSummary([])).toContain('No database migration tool detected');
    const s = migrationPlanSummary(detectMigrationPlan(['prisma/schema.prisma']));
    expect(s).toContain('prisma:');
    expect(s).toContain('npx prisma migrate deploy');
  });
});
