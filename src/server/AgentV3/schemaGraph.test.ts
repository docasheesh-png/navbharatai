import { describe, it, expect } from 'vitest';
import { analyzeSchemaGraph, schemaGraphSummary, analyzeSqlSchema, sqlSchemaSummary } from './schemaGraph';

const P = (content: string, path = 'prisma/schema.prisma') => [{ path, content }];

describe('analyzeSchemaGraph — valid relations', () => {
  it('links two models that both exist, no dangling', () => {
    const g = analyzeSchemaGraph(P(`
model User {
  id    Int    @id @default(autoincrement())
  posts Post[]
}
model Post {
  id       Int  @id @default(autoincrement())
  author   User @relation(fields: [authorId], references: [id])
  authorId Int
}
`));
    expect(g.models.map((m) => m.name)).toEqual(['Post', 'User']);
    expect(g.dangling).toEqual([]);
    // Post.author → User and User.posts → Post are both real relations.
    expect(g.relations.some((r) => r.from === 'Post' && r.to === 'User' && r.field === 'author')).toBe(true);
    expect(g.relations.some((r) => r.from === 'User' && r.to === 'Post' && r.field === 'posts')).toBe(true);
  });

  it('allows a self-relation (model referencing itself)', () => {
    const g = analyzeSchemaGraph(P(`
model Category {
  id       Int        @id
  parent   Category?  @relation("tree", fields: [parentId], references: [id])
  parentId Int?
  children Category[] @relation("tree")
}
`));
    expect(g.dangling).toEqual([]);
  });
});

describe('analyzeSchemaGraph — dangling relation (the actionable bug)', () => {
  it('flags a relation to a model the schema never defines', () => {
    const g = analyzeSchemaGraph(P(`
model Post {
  id     Int  @id
  author User @relation(fields: [authorId], references: [id])
  authorId Int
}
`));
    expect(g.dangling).toHaveLength(1);
    expect(g.dangling[0]).toMatchObject({ from: 'Post', to: 'User', field: 'author' });
    expect(g.dangling[0].line).toBeGreaterThan(0);
  });
});

describe('analyzeSchemaGraph — false-positive avoidance', () => {
  it('does NOT flag enum-typed fields', () => {
    const g = analyzeSchemaGraph(P(`
enum Role { USER ADMIN }
model User {
  id   Int  @id
  role Role @default(USER)
}
`));
    expect(g.dangling).toEqual([]);
    expect(g.relations).toEqual([]);
  });

  it('does NOT flag composite type fields', () => {
    const g = analyzeSchemaGraph(P(`
type Address { street String  city String }
model User {
  id      Int     @id
  address Address
}
`));
    expect(g.dangling).toEqual([]);
  });

  it('does NOT flag scalar fields or Unsupported() raw types', () => {
    const g = analyzeSchemaGraph(P(`
model Thing {
  id      Int      @id
  name    String
  count   BigInt
  when    DateTime
  data    Json
  raw     Unsupported("polygon")
}
`));
    expect(g.dangling).toEqual([]);
    expect(g.relations).toEqual([]);
  });

  it('resolves a model defined in a SIBLING .prisma file (split schema) — not dangling', () => {
    const g = analyzeSchemaGraph([
      { path: 'prisma/schema/post.prisma', content: 'model Post {\n  id Int @id\n  author User\n}\n' },
      { path: 'prisma/schema/user.prisma', content: 'model User {\n  id Int @id\n}\n' },
    ]);
    expect(g.dangling).toEqual([]);
    expect(g.relations.some((r) => r.from === 'Post' && r.to === 'User')).toBe(true);
  });

  it('ignores a relation on a commented-out line', () => {
    const g = analyzeSchemaGraph(P(`
model Post {
  id Int @id
  // author Ghost @relation(fields: [x], references: [id])
}
`));
    expect(g.dangling).toEqual([]);
  });

  it('returns empty for a repo with no .prisma files', () => {
    expect(analyzeSchemaGraph([{ path: 'src/app.ts', content: 'model X { y Z }' }])).toEqual({ models: [], relations: [], dangling: [] });
    expect(analyzeSchemaGraph([])).toEqual({ models: [], relations: [], dangling: [] });
  });
});

describe('schemaGraphSummary', () => {
  it('is empty when clean, and describes the dangling relation otherwise', () => {
    expect(schemaGraphSummary({ models: [], relations: [], dangling: [] })).toBe('');
    const g = analyzeSchemaGraph(P('model Post {\n  id Int @id\n  author User\n}\n'));
    const line = schemaGraphSummary(g);
    expect(line).toContain('Schema —');
    expect(line).toContain("references 'User'");
    expect(line).toContain('prisma migrate');
  });
});

const SQL = (content: string, path = 'migrations/001_init.sql') => [{ path, content }];

describe('analyzeSqlSchema — valid foreign keys', () => {
  it('links a table-level FOREIGN KEY to a table that exists, no dangling', () => {
    const g = analyzeSqlSchema(SQL(`
CREATE TABLE users (
  id INTEGER PRIMARY KEY
);
CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  author_id INTEGER,
  FOREIGN KEY (author_id) REFERENCES users (id)
);
`));
    expect(g.models.map((m) => m.name)).toEqual(['posts', 'users']);
    expect(g.dangling).toEqual([]);
    expect(g.relations.some((r) => r.from === 'posts' && r.to === 'users')).toBe(true);
  });

  it('links an inline column REFERENCES to a table that exists', () => {
    const g = analyzeSqlSchema(SQL(`
CREATE TABLE users ( id SERIAL PRIMARY KEY );
CREATE TABLE posts ( id SERIAL PRIMARY KEY, author_id INT REFERENCES users(id) );
`));
    expect(g.dangling).toEqual([]);
    expect(g.relations.some((r) => r.from === 'posts' && r.to === 'users')).toBe(true);
  });

  it('matches case-insensitively and strips schema qualifier + quotes (no false dangling)', () => {
    const g = analyzeSqlSchema(SQL(`
CREATE TABLE "Users" ( id INT PRIMARY KEY );
CREATE TABLE posts (
  id INT PRIMARY KEY,
  FOREIGN KEY (author_id) REFERENCES public."USERS" (id)
);
`));
    expect(g.dangling).toEqual([]);
  });

  it('resolves a table defined in a SIBLING .sql file — not dangling', () => {
    const g = analyzeSqlSchema([
      { path: 'migrations/002_posts.sql', content: 'CREATE TABLE posts ( id INT, FOREIGN KEY (uid) REFERENCES users(id) );' },
      { path: 'migrations/001_users.sql', content: 'CREATE TABLE users ( id INT PRIMARY KEY );' },
    ]);
    expect(g.dangling).toEqual([]);
  });
});

describe('analyzeSqlSchema — dangling foreign key (the actionable bug)', () => {
  it('flags a FK to a table no CREATE TABLE defines', () => {
    const g = analyzeSqlSchema(SQL(`
CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  author_id INTEGER,
  FOREIGN KEY (author_id) REFERENCES users (id)
);
`));
    expect(g.dangling).toHaveLength(1);
    expect(g.dangling[0]).toMatchObject({ from: 'posts', to: 'users', field: 'FOREIGN KEY' });
    expect(g.dangling[0].line).toBeGreaterThan(0);
  });

  it('returns empty for a repo with no .sql files', () => {
    expect(analyzeSqlSchema([{ path: 'src/app.ts', content: 'REFERENCES x' }])).toEqual({ models: [], relations: [], dangling: [] });
    expect(analyzeSqlSchema([])).toEqual({ models: [], relations: [], dangling: [] });
  });
});

describe('sqlSchemaSummary', () => {
  it('is empty when clean, and describes the dangling FK otherwise', () => {
    expect(sqlSchemaSummary({ models: [], relations: [], dangling: [] })).toBe('');
    const g = analyzeSqlSchema(SQL('CREATE TABLE posts ( id INT, FOREIGN KEY (a) REFERENCES users(id) );'));
    const line = sqlSchemaSummary(g);
    expect(line).toContain('Schema —');
    expect(line).toContain("references 'users'");
    expect(line).toContain('foreign key');
  });
});
