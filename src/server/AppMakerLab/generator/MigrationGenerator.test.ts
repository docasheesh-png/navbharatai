import { describe, it, expect } from 'vitest';
import { generateSqlDdl, generatePrismaSchema, generateMigration, fieldKind } from './MigrationGenerator';

const entity = { name: 'Post', fields: [
  { name: 'id' },
  { name: 'title', type: 'string' },
  { name: 'views', type: 'int' },
  { name: 'published' },
  { name: 'created_at' },
] };

describe('fieldKind', () => {
  it('infers kind from explicit type and from the field name', () => {
    expect(fieldKind({ name: 'id' })).toBe('id');
    expect(fieldKind({ name: 'x', type: 'int' })).toBe('int');
    expect(fieldKind({ name: 'is_active' })).toBe('boolean');
    expect(fieldKind({ name: 'created_at' })).toBe('datetime');
    expect(fieldKind({ name: 'price' })).toBe('float');
    expect(fieldKind({ name: 'title' })).toBe('string');
  });
});

describe('generateSqlDdl', () => {
  it('gives a created/_at datetime column a portable DEFAULT CURRENT_TIMESTAMP (parity with Prisma now())', () => {
    for (const provider of ['postgresql', 'mysql', 'sqlite'] as const) {
      const ddl = generateSqlDdl([entity], provider);
      expect(ddl).toMatch(/created_at["`]?\s+\w+(\s*\(\d+\))?\s+DEFAULT CURRENT_TIMESTAMP/);
    }
  });

  it('does NOT add a timestamp default to a non-created datetime column', () => {
    const ddl = generateSqlDdl([{ name: 'Event', fields: [{ name: 'scheduled', type: 'datetime' }] }], 'postgresql');
    expect(ddl).not.toContain('DEFAULT CURRENT_TIMESTAMP');
  });

  it('marks the id column PRIMARY KEY and email UNIQUE NOT NULL', () => {
    const ddl = generateSqlDdl([{ name: 'User', fields: [{ name: 'id' }, { name: 'email' }] }], 'postgresql');
    expect(ddl).toMatch(/"id"\s+TEXT PRIMARY KEY/);
    expect(ddl).toMatch(/"email"\s+TEXT UNIQUE NOT NULL/);
  });

  it('adds a surrogate id when the entity has none, and quotes per dialect', () => {
    const pg = generateSqlDdl([{ name: 'Tag', fields: [{ name: 'label', type: 'string' }] }], 'postgresql');
    expect(pg).toContain('"id" TEXT PRIMARY KEY');
    const my = generateSqlDdl([{ name: 'Tag', fields: [{ name: 'label', type: 'string' }] }], 'mysql');
    expect(my).toContain('`id` VARCHAR(36) PRIMARY KEY');
  });
});

describe('generatePrismaSchema', () => {
  it('emits a model with @id and now() default on created_at', () => {
    const schema = generatePrismaSchema([entity]);
    expect(schema).toContain('model Post {');
    expect(schema).toContain('@id @default(uuid())');
    expect(schema).toContain('DateTime @default(now())');
  });
});

describe('generateMigration', () => {
  it('returns both prisma + sql files by default and never throws on bad input', () => {
    const out = generateMigration([entity]);
    expect(out.files.some((f) => f.path.endsWith('schema.prisma'))).toBe(true);
    expect(out.files.some((f) => /\.sql$/.test(f.path))).toBe(true);
    // @ts-expect-error — malformed input must not throw
    expect(() => generateMigration(null)).not.toThrow();
  });
});
