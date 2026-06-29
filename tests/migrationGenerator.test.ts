import { describe, it, expect } from 'vitest';
import {
  fieldKind,
  generatePrismaSchema,
  generateSqlDdl,
  generateMigration,
} from '../src/server/AppMakerLab/generator/MigrationGenerator';

/** P-CGE.6 — database migration generator (pure). */

describe('fieldKind', () => {
  it('infers from explicit type and from name', () => {
    expect(fieldKind({ name: 'whatever', type: 'int' })).toBe('int');
    expect(fieldKind({ name: 'whatever', type: 'boolean' })).toBe('boolean');
    expect(fieldKind({ name: 'id' })).toBe('id');
    expect(fieldKind({ name: 'createdAt' })).toBe('datetime');
    expect(fieldKind({ name: 'price' })).toBe('float');
    expect(fieldKind({ name: 'age' })).toBe('int');
    expect(fieldKind({ name: 'isActive' })).toBe('boolean');
    expect(fieldKind({ name: 'title' })).toBe('string');
  });
});

describe('generatePrismaSchema', () => {
  it('emits a datasource, generator and a model with mapped types', () => {
    const schema = generatePrismaSchema([
      { name: 'User', fields: [{ name: 'id' }, { name: 'email' }, { name: 'age' }, { name: 'createdAt' }] },
    ]);
    expect(schema).toContain('datasource db');
    expect(schema).toContain('env("DATABASE_URL")');
    expect(schema).toContain('model User {');
    expect(schema).toContain('@id @default(uuid())');
    expect(schema).toContain('@unique'); // email
    expect(schema).toContain('Int'); // age
    expect(schema).toContain('@default(now())'); // createdAt
  });
});

describe('generateSqlDdl', () => {
  it('emits CREATE TABLE with a primary key and types per provider', () => {
    const pg = generateSqlDdl([{ name: 'Product', fields: [{ name: 'id' }, { name: 'price' }, { name: 'name' }] }], 'postgresql');
    expect(pg).toContain('CREATE TABLE "products" (');
    expect(pg).toContain('PRIMARY KEY');
    expect(pg).toContain('DOUBLE PRECISION'); // price on postgres
    const my = generateSqlDdl([{ name: 'Product', fields: [{ name: 'id' }, { name: 'name' }] }], 'mysql');
    expect(my).toContain('`products`');
    expect(my).toContain('VARCHAR');
  });
  it('adds an id PK when none is declared', () => {
    const ddl = generateSqlDdl([{ name: 'Note', fields: [{ name: 'body' }] }]);
    expect(ddl).toContain('"id"');
    expect(ddl).toContain('PRIMARY KEY');
  });
});

describe('generateMigration', () => {
  it('emits both prisma + sql by default', () => {
    const { files, summary } = generateMigration([{ name: 'User', fields: [{ name: 'id' }] }]);
    expect(files.map((f) => f.path)).toEqual(['prisma/schema.prisma', 'migrations/001_init.sql']);
    expect(summary).toContain('2 migration file(s)');
  });
  it('respects dialect=prisma / sql', () => {
    expect(generateMigration([{ name: 'A', fields: [{ name: 'id' }] }], { dialect: 'prisma' }).files.map((f) => f.path)).toEqual(['prisma/schema.prisma']);
    expect(generateMigration([{ name: 'A', fields: [{ name: 'id' }] }], { dialect: 'sql' }).files.map((f) => f.path)).toEqual(['migrations/001_init.sql']);
  });
  it('tolerates no entities', () => {
    const { files, summary } = generateMigration([]);
    expect(files).toEqual([]);
    expect(summary).toContain('No entities');
  });
});
