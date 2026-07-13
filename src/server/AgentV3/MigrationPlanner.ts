// GA-10 (roadmap Tier 2C) — DB migration RUNNER intelligence.
//
// The schema/migration GENERATOR half exists (MigrationGenerator). This is the runner half: detect which
// migration tool a project uses (from its files + package.json) and produce the exact command(s) to apply
// migrations, so a real fullstack app's database schema is actually created before the app runs — instead of
// booting against an empty DB and crashing. PURE detection (file tree + package.json + deps); the
// ToolDispatcher `run_migrations` tool executes each plan via the sandbox actuator and reports real output.

export type MigrationTool = 'prisma' | 'knex' | 'drizzle' | 'typeorm' | 'sequelize' | 'flyway' | 'alembic';

export interface MigrationPlan {
  tool: MigrationTool;
  /** Command(s) to run in the workspace root, in order (e.g. generate client, then apply). */
  commands: string[];
  /** Honest one-line reason this tool was detected. */
  reason: string;
}

function depsOf(pkgRaw: string | undefined): Set<string> {
  if (!pkgRaw) return new Set();
  try {
    const pkg = JSON.parse(pkgRaw) as Record<string, Record<string, string> | undefined>;
    const names = new Set<string>();
    for (const sec of ['dependencies', 'devDependencies']) {
      const s = pkg[sec];
      if (s && typeof s === 'object') for (const n of Object.keys(s)) names.add(n);
    }
    return names;
  } catch { return new Set(); }
}

/**
 * Detect the migration tool(s) a workspace uses and the command(s) to apply migrations. Deterministic:
 * a tool matches on its config file OR its package dependency. Prisma/Drizzle emit a client-generate step
 * first. Returns [] when no migration tool is found (an honest "no migrations to run"). Pure.
 */
export function detectMigrationPlan(files: string[], packageJsonRaw?: string): MigrationPlan[] {
  const has = (re: RegExp) => files.some((f) => re.test(f));
  const deps = depsOf(packageJsonRaw);
  const dep = (n: string) => deps.has(n);
  const plans: MigrationPlan[] = [];

  // Prisma — schema.prisma or the prisma dep. `migrate deploy` is the non-interactive production apply.
  if (has(/(^|\/)schema\.prisma$/) || dep('prisma') || dep('@prisma/client')) {
    plans.push({ tool: 'prisma', commands: ['npx prisma generate', 'npx prisma migrate deploy'], reason: 'Prisma schema/dependency detected.' });
  }
  // Drizzle — drizzle.config.* or drizzle-kit.
  if (has(/(^|\/)drizzle\.config\.[cm]?[jt]s$/) || dep('drizzle-kit') || dep('drizzle-orm')) {
    plans.push({ tool: 'drizzle', commands: ['npx drizzle-kit migrate'], reason: 'Drizzle config/dependency detected.' });
  }
  // Knex — knexfile.* or the knex dep.
  if (has(/(^|\/)knexfile\.[cm]?[jt]s$/) || dep('knex')) {
    plans.push({ tool: 'knex', commands: ['npx knex migrate:latest'], reason: 'Knex knexfile/dependency detected.' });
  }
  // TypeORM — the typeorm dep (data source drives config; migration:run applies).
  if (dep('typeorm')) {
    plans.push({ tool: 'typeorm', commands: ['npx typeorm migration:run'], reason: 'TypeORM dependency detected.' });
  }
  // Sequelize — .sequelizerc or sequelize-cli.
  if (has(/(^|\/)\.sequelizerc$/) || dep('sequelize-cli')) {
    plans.push({ tool: 'sequelize', commands: ['npx sequelize-cli db:migrate'], reason: 'Sequelize CLI config/dependency detected.' });
  }
  // Flyway (JVM/SQL) — flyway.conf or a conf/flyway.toml.
  if (has(/(^|\/)flyway\.(conf|toml)$/)) {
    plans.push({ tool: 'flyway', commands: ['flyway migrate'], reason: 'Flyway configuration detected.' });
  }
  // Alembic (Python) — alembic.ini.
  if (has(/(^|\/)alembic\.ini$/)) {
    plans.push({ tool: 'alembic', commands: ['alembic upgrade head'], reason: 'Alembic configuration detected.' });
  }
  return plans;
}

/** One honest summary line for a detected plan set (or an explicit "no migrations"). Pure. */
export function migrationPlanSummary(plans: ReadonlyArray<MigrationPlan>): string {
  if (!plans.length) return 'No database migration tool detected — nothing to migrate.';
  return `Detected ${plans.length} migration tool(s):\n` +
    plans.map((p) => `  • ${p.tool}: ${p.commands.join(' && ')}  (${p.reason})`).join('\n');
}
