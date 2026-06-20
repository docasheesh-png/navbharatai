import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSearchClient } from '../src/server/EngineerAI/WebSearchClient';

describe('WebSearchClient', () => {
  describe('npm package detection', () => {
    it('detects "npm axios" as a package query', async () => {
      const client = new WebSearchClient();
      // npmInfo makes a real network call — mock it for unit tests
      const spy = vi.spyOn(client, 'npmInfo').mockResolvedValue({
        title: 'npm: axios@1.7.0',
        url: 'https://www.npmjs.com/package/axios',
        snippet: 'Promise based HTTP client — latest version 1.7.0. Install: npm install axios',
      });
      const results = await client.search('npm axios', 5, async () => '<html></html>');
      expect(spy).toHaveBeenCalledWith('axios');
      expect(results.some(r => r.title.includes('axios'))).toBe(true);
    });

    it('does not treat a plain sentence as a package name', async () => {
      const client = new WebSearchClient();
      const spy = vi.spyOn(client, 'npmInfo').mockResolvedValue(null);
      await client.search('how to center a div in css', 5, async () => '<html></html>');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('Brave Search vs DuckDuckGo selection', () => {
    beforeEach(() => {
      delete process.env.BRAVE_API_KEY;
    });
    afterEach(() => {
      delete process.env.BRAVE_API_KEY;
    });

    it('uses DuckDuckGo when BRAVE_API_KEY is not set', async () => {
      const client = new WebSearchClient();
      // htmlFetcher is only called for DuckDuckGo
      let fetcherCalled = false;
      const results = await client.search(
        'react hooks tutorial',
        3,
        async (_url: string) => { fetcherCalled = true; return '<html></html>'; },
      );
      expect(fetcherCalled).toBe(true);
      expect(Array.isArray(results)).toBe(true);
    });

    it('does not call the htmlFetcher when BRAVE_API_KEY is set (uses Brave instead)', async () => {
      process.env.BRAVE_API_KEY = 'test-brave-key';
      const client = new WebSearchClient();
      let fetcherCalled = false;

      // Mock fetch for Brave Search (returns empty results — just checks routing)
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ web: { results: [] } }),
      }) as any;

      try {
        await client.search('react hooks', 3, async (_url: string) => {
          fetcherCalled = true;
          return '<html></html>';
        });
        expect(fetcherCalled).toBe(false);
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('api.search.brave.com'),
          expect.objectContaining({ headers: expect.objectContaining({ 'X-Subscription-Token': 'test-brave-key' }) }),
        );
      } finally {
        global.fetch = originalFetch;
        delete process.env.BRAVE_API_KEY;
      }
    });

    it('falls back to DuckDuckGo when Brave returns an error', async () => {
      process.env.BRAVE_API_KEY = 'test-key';
      const client = new WebSearchClient();
      let fetcherCalled = false;

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as any;

      try {
        await client.search('test query', 3, async (_url: string) => {
          fetcherCalled = true;
          return '<html></html>';
        });
        // Brave failed → should have fallen back to DuckDuckGo (htmlFetcher)
        expect(fetcherCalled).toBe(true);
      } finally {
        global.fetch = originalFetch;
        delete process.env.BRAVE_API_KEY;
      }
    });
  });

  describe('DuckDuckGo HTML parsing', () => {
    it('returns empty array for empty HTML', async () => {
      const client = new WebSearchClient();
      // Use a multi-word query so it is not detected as an npm package name
      const results = await client.search('how to center a div in css', 5, async () => '');
      expect(results).toEqual([]);
    });

    it('deduplicates results by URL', async () => {
      const client = new WebSearchClient();
      const sameUrlHtml = `
        <a class="result__a" href="https://example.com">Result 1</a>
        <a class="result__a" href="https://example.com">Result 1 duplicate</a>
      `;
      const results = await client.search('how to center a div', 5, async () => sameUrlHtml);
      const urls = results.map(r => r.url);
      expect(new Set(urls).size).toBe(urls.length);
    });
  });
});
