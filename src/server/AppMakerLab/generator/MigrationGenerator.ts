// P-CGE.6 — Database Migration Generator.
//
// DatabaseGenerationEngine emitted TypeScript entity interfaces only — no Prisma schema, no SQL DDL.
// This generates real, runnable migration artifacts from entity definitions: a `prisma/schema.prisma`
// and/or a SQL `CREATE TABLE` migration. Pure, dependency-free (text generation) → unit-tested.
//
// (Seed data is handled separately by P-CGE.13's generate_seed_data.)

export interface MigrationField {
  name: string;
  /** Optional explicit type hint; otherwise inferred from the field name. */
  type?: string;
}

export interface MigrationEntity {
  name: string;
  fields: MigrationField[];
}

export type SqlProvider = 'postgresql' | 'mysql' | 'sqlite';
export type MigrationDialect = 'prisma' | 'sql' | 'both';

type Kind = 'id' | 'string' | 'int' | 'float' | 'boolean' | 'datetime';

/** Canonical column kind for a field, from its explicit type or its name. Pure. */
export function fieldKind(field: MigrationField): Kind {
  const name = String(field.name || '').toLowerCase();
  const type = String(field.type || '').toLowerCase();
  if (/^id$/.test(name)) return 'id';
  if (type) {
    if (/^(int|integer)$/.test(type)) return 'int';
    if (/^(float|double|decimal|number)$/.test(type)) return 'float';
    if (/^(bool|boolean)$/.test(type)) return 'boolean';
    if (/^(date|datetime|timestamp)$/.test(type)) return 'datetime';
    if (/^(string|text|varchar|uuid|email)$/.test(type)) return 'string';
  }
  if (/_id$|uuid|guid/.test(name)) return 'string';
  if (/(^|_)(is|has|can|active|enabled|verified|published|deleted)/.test(name)) return 'boolean';
  if (/created|updated|date|time|dob|birth|_at$/.test(name)) return 'datetime';
  if (/price|amount|cost|total|salary|fee|balance|rate/.test(name)) return 'float';
  if (/age|count|quantity|qty|stock|num|year|priority|rank|level/.test(name)) return 'int';
  return 'string';
}

function pascal(s: string): string {
  return String(s || 'Model')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Model';
}

function snakePlural(s: string): string {
  const snake = String(s || 'table')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '') || 'table';
  return /s$/.test(snake) ? snake : `${snake}s`;
}

const PRISMA_TYPE: Record<Kind, string> = {
  id: 'String',
  string: 'String',
  int: 'Int',
  float: 'Float',
  boolean: 'Boolean',
  datetime: 'DateTime',
};

/** Generate a prisma/schema.prisma from entities. Pure. */
export function generatePrismaSchema(entities: MigrationEntity[], provider: SqlProvider = 'postgresql'): string {
  const list = (entities || []).filter((e) => e && e.name && Array.isArray(e.fields));
  const lines: string[] = [
    'generator client {',
    '  provider = "prisma-client-js"',
    '}',
    '',
    'datasource db {',
    `  provider = "${provider}"`,
    '  url      = env("DATABASE_URL")',
    '}',
    '',
  ];
  for (const e of list) {
    lines.push(`model ${pascal(e.name)} {`);
    const fields = e.fields.filter((f) => f && f.name);
    const hasId = fields.some((f) => fieldKind(f) === 'id');
    if (!hasId) lines.push('  id        String   @id @default(uuid())');
    for (const f of fields) {
      const kind = fieldKind(f);
      const name = String(f.name).toLowerCase();
      if (kind === 'id') {
        lines.push(`  ${f.name.padEnd(9)} String   @id @default(uuid())`);
      } else if (/^email$/.test(name)) {
        lines.push(`  ${f.name.padEnd(9)} String   @unique`);
      } else if (/created|_at$/.test(name) && kind === 'datetime') {
        lines.push(`  ${f.name.padEnd(9)} DateTime @default(now())`);
      } else {
        lines.push(`  ${f.name.padEnd(9)} ${PRISMA_TYPE[kind]}`);
      }
    }
    lines.push('}', '');
  }
  return lines.join('\n');
}

function sqlType(kind: Kind, provider: SqlProvider): string {
  const idType = provider === 'mysql' ? 'VARCHAR(36)' : 'TEXT';
  switch (kind) {
    case 'id': return idType;
    case 'string': return provider === 'mysql' ? 'VARCHAR(255)' : 'TEXT';
    case 'int': return provider === 'mysql' ? 'INT' : 'INTEGER';
    case 'float': return provider === 'sqlite' ? 'REAL' : provider === 'mysql' ? 'DOUBLE' : 'DOUBLE PRECISION';
    case 'boolean': return provider === 'sqlite' ? 'INTEGER' : 'BOOLEAN';
    case 'datetime': return provider === 'mysql' ? 'DATETIME' : provider === 'sqlite' ? 'TEXT' : 'TIMESTAMP';
  }
}

/** Generate a SQL CREATE TABLE migration from entities. Pure. */
export function generateSqlDdl(entities: MigrationEntity[], provider: SqlProvider = 'postgresql'): string {
  const list = (entities || []).filter((e) => e && e.name && Array.isArray(e.fields));
  const q = provider === 'mysql' ? '`' : '"';
  const wrap = (s: string) => `${q}${s}${q}`;
  const blocks: string[] = ['-- Auto-generated initial migration. Review before applying.', ''];
  for (const e of list) {
    const table = snakePlural(e.name);
    const fields = e.fields.filter((f) => f && f.name);
    const hasId = fields.some((f) => fieldKind(f) === 'id');
    const cols: string[] = [];
    if (!hasId) cols.push(`  ${wrap('id')} ${sqlType('id', provider)} PRIMARY KEY`);
    for (const f of fields) {
      const kind = fieldKind(f);
      const name = String(f.name).toLowerCase();
      let col = `  ${wrap(f.name)} ${sqlType(kind, provider)}`;
      if (kind === 'id') col += ' PRIMARY KEY';
      else if (/^email$/.test(name)) col += ' UNIQUE NOT NULL';
      // Parity with the Prisma schema's @default(now()) on created/_at datetime columns.
      // CURRENT_TIMESTAMP is portable across Postgres, MySQL and SQLite.
      else if (kind === 'datetime' && /created|_at$/.test(name)) col += ' DEFAULT CURRENT_TIMESTAMP';
      cols.push(col);
    }
    blocks.push(`CREATE TABLE ${wrap(table)} (`, cols.join(',\n'), ');', '');
  }
  return blocks.join('\n');
}

export interface MigrationFile {
  path: string;
  content: string;
}

export interface MigrationResult {
  files: MigrationFile[];
  summary: string;
}

/**
 * Generate migration artifacts for a set of entities. `dialect` selects prisma schema, SQL DDL, or
 * both (default). Pure: returns the files; the caller writes them. Never throws.
 */
export function generateMigration(
  entities: MigrationEntity[],
  opts: { dialect?: MigrationDialect; provider?: SqlProvider } = {},
): MigrationResult {
  const list = Array.isArray(entities) ? entities.filter((e) => e && e.name && Array.isArray(e.fields)) : [];
  const dialect: MigrationDialect = opts.dialect === 'prisma' || opts.dialect === 'sql' ? opts.dialect : 'both';
  const provider: SqlProvider = opts.provider || 'postgresql';
  const files: MigrationFile[] = [];
  if (list.length > 0 && (dialect === 'prisma' || dialect === 'both')) {
    files.push({ path: 'prisma/schema.prisma', content: generatePrismaSchema(list, provider) });
  }
  if (list.length > 0 && (dialect === 'sql' || dialect === 'both')) {
    files.push({ path: 'migrations/001_init.sql', content: generateSqlDdl(list, provider) });
  }
  const summary = list.length
    ? `Generated ${files.length} migration file(s) for ${list.length} entit${list.length > 1 ? 'ies' : 'y'} (${provider}): ${files.map((f) => f.path).join(', ')}.`
    : 'No entities provided — nothing to migrate.';
  return { files, summary };
}
