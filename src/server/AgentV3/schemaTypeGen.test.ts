import { describe, it, expect } from 'vitest';
import { prismaToTypeScript, sqlToTypeScript, generateSchemaTypes } from './schemaTypeGen';

const P = (content: string, path = 'prisma/schema.prisma') => [{ path, content }];
const SQL = (content: string, path = 'migrations/1.sql') => [{ path, content }];

describe('prismaToTypeScript', () => {
  const types = prismaToTypeScript(P(`
enum Role { USER ADMIN }
model User {
  id    Int      @id
  email String
  name  String?
  role  Role     @default(USER)
  posts Post[]
}
model Post {
  id       Int  @id
  author   User @relation(fields: [authorId], references: [id])
  authorId Int
}
`));
  const byName = (n: string) => types.find((t) => t.name === n)?.code || '';

  it('emits an enum union', () => {
    expect(byName('Role')).toBe("export type Role = 'USER' | 'ADMIN';");
  });
  it('maps scalars, optionals, arrays, enums and relations', () => {
    const u = byName('User');
    expect(u).toContain('id: number;');
    expect(u).toContain('email: string;');
    expect(u).toContain('name?: string | null;'); // optional scalar
    expect(u).toContain('role: Role;');           // enum, not a relation
    expect(u).toContain('posts: Post[];');        // relation array
    expect(byName('Post')).toContain('author: User;');
  });
});

describe('sqlToTypeScript', () => {
  const types = sqlToTypeScript(SQL(`
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  bio TEXT,
  created_at TIMESTAMP NOT NULL,
  balance NUMERIC(10,2)
);
`));
  it('generates a PascalCase singular interface with mapped column types + nullability', () => {
    const c = types.find((t) => t.name === 'User')?.code || '';
    expect(c).toContain('id: number;');                 // PK → required
    expect(c).toContain('email: string;');              // NOT NULL → required
    expect(c).toContain('bio?: string | null;');        // nullable
    expect(c).toContain('created_at: Date;');
    expect(c).toContain('balance?: number | null;');    // NUMERIC(10,2) comma not split
  });
});

describe('generateSchemaTypes', () => {
  it('prefers Prisma, emits a headered file, null when nothing usable', () => {
    const r = generateSchemaTypes([...P('model A {\n  id Int @id\n}'), ...SQL('CREATE TABLE b (id INT);')]);
    expect(r?.source).toBe('prisma');
    expect(r?.fileContent).toContain('Auto-generated from your database schema');
    expect(r?.fileContent).toContain('export interface A');
    expect(generateSchemaTypes([{ path: 'src/a.ts', content: 'x' }])).toBeNull();
  });
});
