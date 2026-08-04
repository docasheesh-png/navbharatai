import { describe, it, expect } from 'vitest';
import { generateSqlDdl, generatePrismaSchema, generateMigration, fieldKind, foreignKeysFor } from './MigrationGenerator';

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

// T1.1 — DEEP SCHEMA. FKs, indexes, timestamps, soft-delete, composite join-key, transactional SQL.
const relSchema = [
  { name: 'User', fields: [{ name: 'id' }, { name: 'email' }] },
  { name: 'Post', fields: [{ name: 'id' }, { name: 'title', type: 'string' }, { name: 'user_id' }] },
  // classic many-to-many link row (two FKs) — user <-> post
  { name: 'Like', fields: [{ name: 'id' }, { name: 'user_id' }, { name: 'post_id' }] },
];

describe('foreignKeysFor', () => {
  it('detects _id / Id fields that reference another entity', () => {
    expect(foreignKeysFor(relSchema[1], relSchema)).toEqual([{ field: 'user_id', targetModel: 'User', targetTable: 'users' }]);
    expect(foreignKeysFor(relSchema[2], relSchema).map((f) => f.field)).toEqual(['user_id', 'post_id']);
  });
  it('ignores plain id, words merely ending in lowercase "id", and _id with no matching entity', () => {
    expect(foreignKeysFor({ name: 'Thing', fields: [{ name: 'id' }, { name: 'valid' }, { name: 'uuid' }, { name: 'grid' }] }, relSchema)).toEqual([]);
    expect(foreignKeysFor({ name: 'Order', fields: [{ name: 'coupon_id' }] }, relSchema)).toEqual([]);
  });
});

describe('deep schema — enriched SQL', () => {
  it('emits FK constraints with ON DELETE CASCADE + one index per FK, inside a transaction', () => {
    const ddl = generateSqlDdl(relSchema, 'postgresql', true);
    expect(ddl).toMatch(/^-- Auto-generated[\s\S]*BEGIN;/);
    expect(ddl.trim().endsWith('COMMIT;')).toBe(true);
    expect(ddl).toContain('FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE');
    expect(ddl).toContain('CREATE INDEX "idx_posts_user_id" ON "posts" ("user_id");');
  });
  it('adds created_at/updated_at defaults + a nullable deleted_at when absent', () => {
    const ddl = generateSqlDdl(relSchema, 'postgresql', true);
    expect(ddl).toContain('"created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    expect(ddl).toContain('"updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    expect(ddl).toContain('"deleted_at" TIMESTAMP NULL');
  });
  it('makes a two-FK join table pair UNIQUE', () => {
    expect(generateSqlDdl(relSchema, 'postgresql', true)).toContain('UNIQUE ("user_id", "post_id")');
  });
  it('enrich=false stays byte-identical to the legacy flat output', () => {
    const flat = generateSqlDdl(relSchema, 'postgresql', false);
    expect(flat).not.toContain('BEGIN;');
    expect(flat).not.toContain('FOREIGN KEY');
    expect(flat).not.toContain('deleted_at');
  });
});

describe('deep schema — enriched Prisma', () => {
  it('adds @@index per FK, audit timestamps, a nullable deletedAt, and a composite @@unique join key', () => {
    const p = generatePrismaSchema(relSchema, 'postgresql', true);
    expect(p).toContain('@@index([user_id])');
    expect(p).toContain('@@index([post_id])');
    expect(p).toContain('@@unique([user_id, post_id])');
    expect(p).toMatch(/createdAt\s+DateTime @default\(now\(\)\)/);
    expect(p).toMatch(/updatedAt\s+DateTime @updatedAt/);
    expect(p).toMatch(/deletedAt\s+DateTime\?/);
  });
  it('enrich=false reproduces the legacy schema', () => {
    const p = generatePrismaSchema(relSchema, 'postgresql', false);
    expect(p).not.toContain('@@index');
    expect(p).not.toContain('deletedAt');
  });
});

describe('deep schema — generateMigration defaults to enriched', () => {
  it('the tool path emits the deep schema by default', () => {
    const sql = generateMigration(relSchema).files.find((f) => /\.sql$/.test(f.path))!.content;
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('BEGIN;');
  });
  it('enrich:false opts back into the flat schema', () => {
    const sql = generateMigration(relSchema, { enrich: false }).files.find((f) => /\.sql$/.test(f.path))!.content;
    expect(sql).not.toContain('ON DELETE CASCADE');
  });
});
