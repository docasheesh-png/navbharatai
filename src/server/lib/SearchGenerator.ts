// U-4 (verified recipe modules) — full-text search generator (Algolia + Meilisearch).
//
// Content-heavy apps (catalogs, docs, marketplaces) need real search. This emits a server-side indexer
// (uses the admin/write key) and a client search() (uses a search-only key), Bring-Your-Own keys (pasted
// into .env; the admin key stays server-side; NavBharatAI never stores them). PURE builders; complete correct
// code (no TODO stubs — the real-features rule). Unit-tested.

export type SearchProvider = 'algolia' | 'meilisearch';

export interface SearchConfig {
  provider: SearchProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

const ALGOLIA_SERVER = `import { algoliasearch } from 'algoliasearch';

// Bring-Your-Own Algolia keys — the ADMIN key writes/indexes and stays server-side ONLY.
const client = algoliasearch(process.env.ALGOLIA_APP_ID as string, process.env.ALGOLIA_ADMIN_KEY as string);

// Index (add or update) records into a search index. Call after creating/updating your data.
export async function indexRecords(indexName: string, records: Array<Record<string, unknown>>): Promise<void> {
  await client.saveObjects({ indexName, objects: records });
}
`;

const ALGOLIA_CLIENT = `import { algoliasearch } from 'algoliasearch';

// The SEARCH-only key is safe in the browser (never the admin key). Set them as VITE_ vars.
const client = algoliasearch(import.meta.env.VITE_ALGOLIA_APP_ID as string, import.meta.env.VITE_ALGOLIA_SEARCH_KEY as string);

// Search an index. Returns the hits (each is your indexed record).
export async function search(indexName: string, query: string): Promise<Array<Record<string, unknown>>> {
  const { results } = await client.search({ requests: [{ indexName, query }] });
  return (results[0] as { hits: Array<Record<string, unknown>> }).hits;
}
`;

const MEILI_SERVER = `import { MeiliSearch } from 'meilisearch';

// Bring-Your-Own Meilisearch host + key — the write/admin key stays server-side ONLY.
const client = new MeiliSearch({ host: process.env.MEILISEARCH_HOST as string, apiKey: process.env.MEILISEARCH_API_KEY });

// Index (add or update) documents into an index. Meilisearch infers the schema; ensure each doc has an id.
export async function indexRecords(indexName: string, records: Array<Record<string, unknown>>): Promise<void> {
  await client.index(indexName).addDocuments(records);
}
`;

const MEILI_CLIENT = `import { MeiliSearch } from 'meilisearch';

// Use a SEARCH-only key in the browser (never the admin key). Set them as VITE_ vars.
const client = new MeiliSearch({
  host: import.meta.env.VITE_MEILISEARCH_HOST as string,
  apiKey: import.meta.env.VITE_MEILISEARCH_SEARCH_KEY as string,
});

// Search an index. Returns the hits (each is your indexed document).
export async function search(indexName: string, query: string): Promise<Array<Record<string, unknown>>> {
  const res = await client.index(indexName).search(query);
  return res.hits as Array<Record<string, unknown>>;
}
`;

function envBlock(pairs: Array<[string, string]>): string {
  return pairs.map(([k, note]) => `# ${note}\n${k}=`).join('\n') + '\n';
}

/** Generate a working BYO full-text search integration for a provider. Deterministic; unknown → throws. */
export function generateSearchIntegration(provider: SearchProvider): SearchConfig {
  switch (provider) {
    case 'algolia':
      return {
        provider,
        dependencies: [{ name: 'algoliasearch', version: '^5' }],
        envKeys: ['ALGOLIA_APP_ID', 'ALGOLIA_ADMIN_KEY', 'VITE_ALGOLIA_APP_ID', 'VITE_ALGOLIA_SEARCH_KEY'],
        files: {
          'src/server/search.ts': ALGOLIA_SERVER,
          'src/lib/search.ts': ALGOLIA_CLIENT,
          [ENV_EXAMPLE]: envBlock([
            ['ALGOLIA_APP_ID', 'Algolia application id'],
            ['ALGOLIA_ADMIN_KEY', 'Algolia ADMIN key — indexes/writes, server-side ONLY'],
            ['VITE_ALGOLIA_APP_ID', 'Algolia app id for the browser'],
            ['VITE_ALGOLIA_SEARCH_KEY', 'Algolia SEARCH-only key (safe to expose)'],
          ]),
        },
        instructions: 'On the server call indexRecords(indexName, records) whenever your data changes. On the client call search(indexName, query). The ADMIN key never leaves the server; the browser uses the search-only key. Your keys stay in YOUR env.',
      };
    case 'meilisearch':
      return {
        provider,
        dependencies: [{ name: 'meilisearch', version: '^0.44' }],
        envKeys: ['MEILISEARCH_HOST', 'MEILISEARCH_API_KEY', 'VITE_MEILISEARCH_HOST', 'VITE_MEILISEARCH_SEARCH_KEY'],
        files: {
          'src/server/search.ts': MEILI_SERVER,
          'src/lib/search.ts': MEILI_CLIENT,
          [ENV_EXAMPLE]: envBlock([
            ['MEILISEARCH_HOST', 'Meilisearch host URL, e.g. https://ms.example.com'],
            ['MEILISEARCH_API_KEY', 'Meilisearch write/admin key — server-side ONLY'],
            ['VITE_MEILISEARCH_HOST', 'Meilisearch host for the browser'],
            ['VITE_MEILISEARCH_SEARCH_KEY', 'Meilisearch SEARCH-only key (safe to expose)'],
          ]),
        },
        instructions: 'On the server call indexRecords(indexName, records) (each doc needs an id). On the client call search(indexName, query). The write key never leaves the server; the browser uses a search-only key. Your keys stay in YOUR env.',
      };
    default:
      throw new Error(`Unknown search provider: ${provider}`);
  }
}

/** Valid-provider guard for the tool layer. */
export function isSearchProvider(v: unknown): v is SearchProvider {
  return v === 'algolia' || v === 'meilisearch';
}
