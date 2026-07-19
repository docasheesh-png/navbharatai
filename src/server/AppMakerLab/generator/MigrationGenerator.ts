// P-CGE.6 — Database Migration Generator.
//
// DatabaseGenerationEngine emitted TypeScript entity interfaces only — no Prisma schema, no SQL DDL.
// This generates real, runnable migration artifacts from entity definitions: a `prisma/schema.prisma`
// and/or a SQL `CREATE TABLE` migration. Pure, dependency-free (text generation) → unit-tested.
//
// (Seed data is handled separately by P-CGE.13's generate_seed_data.)
//
// T1.1 — DEEP SCHEMA (roadmap 2026-07-19). The generator used to emit FLAT tables (only a PK + a
// UNIQUE email + a created_at default) — no foreign keys, indexes, cascade, timestamps, soft-delete,
// or transactions, so every generated backend shipped a shallow schema. `enrich` (default ON via
// `generateMigration`) now adds, deterministically from the entity/field names:
//   • Foreign keys — a `<x>_id` / `<x>Id` field whose base matches another entity → a real SQL
//     FOREIGN KEY … ON DELETE CASCADE, plus a Prisma `@@index` on the scalar (Prisma relation
//     NAVIGATION is a deliberate fast-follow — index-only keeps the emitted schema always VALID).
//   • An index on every foreign-key column (SQL CREATE INDEX + Prisma @@index).
//   • createdAt / updatedAt timestamps when absent (audit basics).
//   • A nullable deletedAt column when absent (enables soft-delete).
//   • A composite UNIQUE on a 2-FK join table (the classic many-to-many link row).
//   • A transactional SQL migration (BEGIN … COMMIT), so a partial apply never half-migrates.
// `enrich: false` (the default of the low-level generators) reproduces the exact prior output.

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

/** Crude, dependency-free singularizer — only used to match a FK base against an entity name. Pure. */
function singular(s: string): string {
  const n = String(s || '');
  if (/ies$/i.test(n)) return n.replace(/ies$/i, 'y');
  if (/([sxz]|ch|sh)es$/i.test(n)) return n.replace(/es$/i, '');
  if (/s$/i.test(n) && !/ss$/i.test(n)) return n.replace(/s$/i, '');
  return n;
}

/** Normalize an identifier for matching (letters+digits, lowercased). Pure. */
function normName(s: string): string {
  return String(s || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

interface ForeignKey {
  /** The FK field/column name exactly as declared (e.g. `user_id` or `authorId`). */
  field: string;
  /** The referenced entity's model name (PascalCase). */
  targetModel: string;
  /** The referenced entity's table name (snake_plural). */
  targetTable: string;
}

/**
 * Detect foreign keys on an entity: a `<base>_id` / `<base>Id` field whose singularized base matches
 * another entity in the set. `id` alone is never a FK (its base is empty). Self-references are allowed.
 * A lowercase `…id` (valid, uuid, grid) is NOT a FK — only the `_id` / `Id` suffixes qualify. Pure.
 */
export function foreignKeysFor(entity: MigrationEntity, all: MigrationEntity[]): ForeignKey[] {
  const byKey = new Map<string, MigrationEntity>();
  for (const e of all) if (e && e.name) byKey.set(normName(singular(e.name)), e);
  const fks: ForeignKey[] = [];
  const seen = new Set<string>();
  for (const f of (entity.fields || []).filter((x) => x && x.name)) {
    const m = String(f.name).match(/^(.+?)(_id|Id)$/);
    if (!m) continue;
    const base = m[1];
    if (!base) continue;
    const target = byKey.get(normName(singular(base)));
    if (!target || !target.name) continue;
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    fks.push({ field: f.name, targetModel: pascal(target.name), targetTable: snakePlural(target.name) });
  }
  return fks;
}

/** True when the entity already declares a field matching one of the given lowercased base names. */
function hasField(fields: MigrationField[], test: (lower: string) => boolean): boolean {
  return (fields || []).some((f) => f && f.name && test(String(f.name).toLowerCase()));
}

const PRISMA_TYPE: Record<Kind, string> = {
  id: 'String',
  string: 'String',
  int: 'Int',
  float: 'Float',
  boolean: 'Boolean',
  datetime: 'DateTime',
};

/** Generate a prisma/schema.prisma from entities. `enrich` adds indexes/timestamps/soft-delete. Pure. */
export function generatePrismaSchema(entities: MigrationEntity[], provider: SqlProvider = 'postgresql', enrich = false): string {
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
    if (enrich) {
      // Audit timestamps + soft-delete, only when the entity did not already declare them.
      if (!hasField(fields, (n) => n === 'createdat' || n === 'created_at' || n === 'created')) {
        lines.push(`  ${'createdAt'.padEnd(9)} DateTime @default(now())`);
      }
      if (!hasField(fields, (n) => n === 'updatedat' || n === 'updated_at' || n === 'updated')) {
        lines.push(`  ${'updatedAt'.padEnd(9)} DateTime @updatedAt`);
      }
      if (!hasField(fields, (n) => n === 'deletedat' || n === 'deleted_at' || n === 'deleted')) {
        lines.push(`  ${'deletedAt'.padEnd(9)} DateTime?`);
      }
      const fks = foreignKeysFor(e, list);
      for (const fk of fks) lines.push(`  @@index([${fk.field}])`);
      // Classic many-to-many link row (exactly two FKs) → the pair must be unique.
      if (fks.length === 2) lines.push(`  @@unique([${fks[0].field}, ${fks[1].field}])`);
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

/** Generate a SQL CREATE TABLE migration from entities. `enrich` adds FKs/indexes/timestamps/tx. Pure. */
export function generateSqlDdl(entities: MigrationEntity[], provider: SqlProvider = 'postgresql', enrich = false): string {
  const list = (entities || []).filter((e) => e && e.name && Array.isArray(e.fields));
  const q = provider === 'mysql' ? '`' : '"';
  const wrap = (s: string) => `${q}${s}${q}`;
  const ts = sqlType('datetime', provider);
  const blocks: string[] = ['-- Auto-generated initial migration. Review before applying.', ''];
  // Transactional migration — a failed statement rolls the whole thing back instead of half-applying.
  if (enrich) blocks.push('BEGIN;', '');
  const indexStatements: string[] = [];
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
    const fks = enrich ? foreignKeysFor(e, list) : [];
    if (enrich) {
      // Audit timestamps + soft-delete, only when absent.
      if (!hasField(fields, (n) => n === 'createdat' || n === 'created_at' || n === 'created')) {
        cols.push(`  ${wrap('created_at')} ${ts} DEFAULT CURRENT_TIMESTAMP`);
      }
      if (!hasField(fields, (n) => n === 'updatedat' || n === 'updated_at' || n === 'updated')) {
        cols.push(`  ${wrap('updated_at')} ${ts} DEFAULT CURRENT_TIMESTAMP`);
      }
      if (!hasField(fields, (n) => n === 'deletedat' || n === 'deleted_at' || n === 'deleted')) {
        cols.push(`  ${wrap('deleted_at')} ${ts} NULL`);
      }
      // Foreign-key constraints (referential integrity + cascade).
      for (const fk of fks) {
        cols.push(`  FOREIGN KEY (${wrap(fk.field)}) REFERENCES ${wrap(fk.targetTable)}(${wrap('id')}) ON DELETE CASCADE`);
        indexStatements.push(`CREATE INDEX ${wrap(`idx_${table}_${fk.field}`)} ON ${wrap(table)} (${wrap(fk.field)});`);
      }
      // Classic many-to-many link row (exactly two FKs) → the pair must be unique.
      if (fks.length === 2) cols.push(`  UNIQUE (${wrap(fks[0].field)}, ${wrap(fks[1].field)})`);
    }
    blocks.push(`CREATE TABLE ${wrap(table)} (`, cols.join(',\n'), ');', '');
  }
  // Indexes come after every table exists (a FK index can reference its own table safely either way,
  // but keeping them last also keeps the CREATE TABLE blocks clean and readable).
  if (enrich && indexStatements.length > 0) blocks.push(...indexStatements, '');
  if (enrich) blocks.push('COMMIT;', '');
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
 * both (default). `enrich` (default TRUE here — the tool path) adds foreign keys, indexes, timestamps,
 * soft-delete and a transactional migration; pass `enrich: false` for the flat legacy schema. Pure:
 * returns the files; the caller writes them. Never throws.
 */
export function generateMigration(
  entities: MigrationEntity[],
  opts: { dialect?: MigrationDialect; provider?: SqlProvider; enrich?: boolean } = {},
): MigrationResult {
  const list = Array.isArray(entities) ? entities.filter((e) => e && e.name && Array.isArray(e.fields)) : [];
  const dialect: MigrationDialect = opts.dialect === 'prisma' || opts.dialect === 'sql' ? opts.dialect : 'both';
  const provider: SqlProvider = opts.provider || 'postgresql';
  const enrich = opts.enrich !== false; // deep schema is the default; opt out with enrich:false
  const files: MigrationFile[] = [];
  if (list.length > 0 && (dialect === 'prisma' || dialect === 'both')) {
    files.push({ path: 'prisma/schema.prisma', content: generatePrismaSchema(list, provider, enrich) });
  }
  if (list.length > 0 && (dialect === 'sql' || dialect === 'both')) {
    files.push({ path: 'migrations/001_init.sql', content: generateSqlDdl(list, provider, enrich) });
  }
  const summary = list.length
    ? `Generated ${files.length} migration file(s) for ${list.length} entit${list.length > 1 ? 'ies' : 'y'} (${provider}${enrich ? ', deep schema: FKs/indexes/timestamps/soft-delete' : ''}): ${files.map((f) => f.path).join(', ')}.`
    : 'No entities provided — nothing to migrate.';
  return { files, summary };
}
