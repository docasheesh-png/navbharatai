import { describe, it, expect } from 'vitest';
import { generateGraphqlIntegration } from './GraphqlGenerator';

describe('generateGraphqlIntegration', () => {
  const c = generateGraphqlIntegration();
  const schema = c.files['server/graphql/schema.ts'];
  const server = c.files['server/graphql/yoga.ts'];

  it('emits a schema + a mountable yoga handler on the graphql + graphql-yoga deps', () => {
    expect(schema).toContain("import { createSchema } from 'graphql-yoga'");
    expect(server).toContain("import { createYoga } from 'graphql-yoga'");
    expect(server).toContain('export const yoga = createYoga(');
    expect(c.dependencies.map((d) => d.name).sort()).toEqual(['graphql', 'graphql-yoga']);
  });

  it('ships a REAL example schema (Query + typed object + Mutation with input), not an empty stub', () => {
    expect(schema).toContain('type Query');
    expect(schema).toContain('type Mutation');
    expect(schema).toContain('addItem(input: AddItemInput!): Item!');
    expect(schema).toContain('input AddItemInput');
    expect(schema).not.toMatch(/TODO|FIXME/);
  });

  it('validates mutation input (throws → surfaces as a GraphQL error), never trusts raw input', () => {
    expect(schema).toContain("throw new Error('name is required')");
  });

  it('enables GraphiQL only in dev (off in production)', () => {
    expect(server).toContain("graphiql: process.env.NODE_ENV !== 'production'");
  });

  it('writes only the two server files and needs no env key', () => {
    expect(Object.keys(c.files).sort()).toEqual(['server/graphql/schema.ts', 'server/graphql/yoga.ts']);
    expect((c as { envKeys?: unknown }).envKeys).toBeUndefined();
    expect(c.instructions.toLowerCase()).toContain('graphql');
  });
});
