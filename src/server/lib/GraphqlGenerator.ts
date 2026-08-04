// Roadmap "BUILD NOW #8" — GraphQL backend recipe (graphql-yoga, framework-agnostic).
//
// The audit's Backend gap included "GraphQL" — the app could only scaffold REST. This emits a REAL,
// runnable GraphQL API built on graphql-yoga (the modern, dependency-light server that mounts on any Node
// http server OR Express with one line). It ships a schema-first setup with a working example (a Query, a
// typed object, and a Mutation with input validation) so the developer sees the exact pattern and extends
// it — not an empty stub. GraphiQL is on in dev for instant exploration. No API key needed (it is your own
// API surface). PURE builder → the caller writes the files. Real, complete code — no TODO stubs.

export interface GraphqlConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const SCHEMA = `import { createSchema } from 'graphql-yoga';

// Schema-first GraphQL. Define your types in the SDL (typeDefs) and back each field with a resolver. This
// example ships a working Query + a typed object + a Mutation with an input — replace it with your domain.
export const schema = createSchema({
  typeDefs: /* GraphQL */ \`
    type Query {
      "Liveness check — returns 'ok'."
      health: String!
      "List items (demo data — swap for your DB)."
      items: [Item!]!
      "Fetch one item by id, or null if it does not exist."
      item(id: ID!): Item
    }

    type Mutation {
      "Create an item. Returns the created item."
      addItem(input: AddItemInput!): Item!
    }

    type Item {
      id: ID!
      name: String!
      createdAt: String!
    }

    input AddItemInput {
      name: String!
    }
  \`,
  resolvers: {
    Query: {
      health: () => 'ok',
      items: () => store,
      item: (_parent: unknown, args: { id: string }) => store.find((i) => i.id === args.id) ?? null,
    },
    Mutation: {
      addItem: (_parent: unknown, args: { input: { name: string } }) => {
        const name = String(args.input?.name ?? '').trim();
        // GraphQL surfaces a thrown error as a proper errors[] entry — validate real input, never trust it.
        if (!name) throw new Error('name is required');
        const item = { id: String(store.length + 1), name, createdAt: new Date().toISOString() };
        store.push(item);
        return item;
      },
    },
  },
});

// Demo in-memory store — replace with your database (Prisma/Drizzle/pg). Kept module-local on purpose.
interface Item { id: string; name: string; createdAt: string; }
const store: Item[] = [
  { id: '1', name: 'First item', createdAt: new Date().toISOString() },
];
`;

const SERVER = `import { createYoga } from 'graphql-yoga';
import { schema } from './schema';

// A ready-to-mount GraphQL handler. graphql-yoga speaks the fetch API, so it mounts on plain Node http,
// Express, Fastify, Bun, Deno, and edge runtimes. GraphiQL (the in-browser explorer) is enabled in dev only.
export const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  graphiql: process.env.NODE_ENV !== 'production',
});

// --- Mounting ---
// Express:   import { yoga } from './server/graphql/yoga'; app.use(yoga.graphqlEndpoint, yoga);
// Node http: import { createServer } from 'node:http'; createServer(yoga).listen(4000);
// Then POST to /graphql, e.g. { "query": "{ health items { id name } }" }.
`;

const INSTRUCTIONS =
  'GraphQL API wired at server/graphql/schema.ts + server/graphql/yoga.ts (graphql + graphql-yoga). It is a ' +
  'REAL runnable API with an example Query (health/items/item), a typed Item, and an addItem Mutation with ' +
  'input validation — extend the SDL + resolvers with your domain and swap the demo in-memory store for your ' +
  'DB. Mount it in one line: Express — app.use(yoga.graphqlEndpoint, yoga); or plain Node — ' +
  'createServer(yoga).listen(4000). GraphiQL (the in-browser explorer) is on in dev at /graphql; a thrown ' +
  'resolver error surfaces as a proper GraphQL errors[] entry. No API key needed — this is your own API.';

export function generateGraphqlIntegration(): GraphqlConfig {
  return {
    files: {
      'server/graphql/schema.ts': SCHEMA,
      'server/graphql/yoga.ts': SERVER,
    },
    dependencies: [
      { name: 'graphql', version: '^16.9.0' },
      { name: 'graphql-yoga', version: '^5.7.0' },
    ],
    instructions: INSTRUCTIONS,
  };
}
