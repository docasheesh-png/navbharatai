import { describe, it, expect } from 'vitest';
import { generateSearchIntegration, isSearchProvider } from './SearchGenerator';

describe('generateSearchIntegration — Algolia', () => {
  const c = generateSearchIntegration('algolia');

  it('server indexer uses the ADMIN key; client search uses the SEARCH-only key', () => {
    expect(c.files['src/server/search.ts']).toContain('ALGOLIA_ADMIN_KEY');
    expect(c.files['src/server/search.ts']).toContain('saveObjects');
    expect(c.files['src/lib/search.ts']).toContain('VITE_ALGOLIA_SEARCH_KEY');
    expect(c.files['src/lib/search.ts']).toContain('export async function search');
    expect(c.dependencies).toEqual([{ name: 'algoliasearch', version: '^5' }]);
  });

  it('the admin key is NOT referenced from the browser module (secret stays server-side)', () => {
    expect(c.files['src/lib/search.ts']).not.toContain('ADMIN_KEY');
  });
});

describe('generateSearchIntegration — Meilisearch', () => {
  const c = generateSearchIntegration('meilisearch');

  it('server indexer + client search with a search-only browser key', () => {
    expect(c.files['src/server/search.ts']).toContain('addDocuments');
    expect(c.files['src/server/search.ts']).toContain('MEILISEARCH_API_KEY');
    expect(c.files['src/lib/search.ts']).toContain('VITE_MEILISEARCH_SEARCH_KEY');
    expect(c.files['src/lib/search.ts']).toContain('.search(query)');
    expect(c.dependencies).toEqual([{ name: 'meilisearch', version: '^0.44' }]);
  });
});

describe('safety + guards', () => {
  it('blanks secret values in .env.example, no TODO/stub in the server code', () => {
    for (const p of ['algolia', 'meilisearch'] as const) {
      const cfg = generateSearchIntegration(p);
      for (const k of cfg.envKeys) expect(cfg.files['.env.example']).toContain(`${k}=`);
      expect(cfg.files['src/server/search.ts']).not.toMatch(/TODO|FIXME|not implemented|your-code-here/i);
    }
  });

  it('isSearchProvider guards; unknown → throws', () => {
    expect(isSearchProvider('algolia')).toBe(true);
    expect(isSearchProvider('meilisearch')).toBe(true);
    for (const v of ['elastic', '', null]) expect(isSearchProvider(v)).toBe(false);
    // @ts-expect-error invalid
    expect(() => generateSearchIntegration('elastic')).toThrow();
  });
});
