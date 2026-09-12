import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __resetBraveSearch } from '../src/server/lib/braveSearch';
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
      // The search cache is process-wide by design, so one test's paid result would otherwise be
      // handed to the next one for free — and the test would pass for the wrong reason.
      __resetBraveSearch();
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

    // 🔴 THIS TEST'S PREMISE WAS DELIBERATELY CHANGED (2026-09-12), and it is worth saying why rather
    // than quietly rewriting it. It used to assert "a key is set ⇒ Brave is used", which was true when
    // Brave was all-or-nothing. Brave now bills per request (~₹0.44 each), so the engine is chosen by
    // INTENT: a reference lookup — a package version, a framework doc, an error message — asks the free
    // engine first and pays only if it finds nothing, while the chat's live questions still lead with
    // Brave. This is not a downgrade of anything: DuckDuckGo-only IS production's behaviour today,
    // since no key is set there. What changed is that Brave became a rescue on this path, not the lead.
    it('🔒 a REFERENCE lookup (the default) asks the FREE engine first, even with a key set', async () => {
      process.env.BRAVE_API_KEY = 'test-brave-key';
      const client = new WebSearchClient();
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ web: { results: [] } }) }) as any;
      try {
        const results = await client.search(
          'how to center a div in css',
          3,
          async () => '<a class="result__a" href="https://example.com">Centering</a>',
        );
        expect(results.map(r => r.url)).toContain('https://example.com');
        // DuckDuckGo answered, so Brave was never asked — that is the whole saving.
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
        delete process.env.BRAVE_API_KEY;
      }
    });

    it('pays for Brave only when the free engine comes back with nothing', async () => {
      process.env.BRAVE_API_KEY = 'test-brave-key';
      const client = new WebSearchClient();
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ web: { results: [{ title: 'T', url: 'https://brave.example', description: 'D' }] } }),
      }) as any;
      try {
        const results = await client.search('how to center a div in css', 3, async () => '<html></html>');
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('api.search.brave.com'),
          expect.objectContaining({ headers: expect.objectContaining({ 'X-Subscription-Token': 'test-brave-key' }) }),
        );
        expect(results.map(r => r.url)).toContain('https://brave.example');
      } finally {
        global.fetch = originalFetch;
        delete process.env.BRAVE_API_KEY;
      }
    });

    it("🔒 a LIVE question leads with Brave — freshness is what the fee buys", async () => {
      process.env.BRAVE_API_KEY = 'test-brave-key';
      const client = new WebSearchClient();
      let fetcherCalled = false;
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ web: { results: [{ title: 'T', url: 'https://live.example', description: 'D' }] } }),
      }) as any;
      try {
        const results = await client.search(
          'aaj ka gold rate kya hai',
          3,
          async () => { fetcherCalled = true; return '<html></html>'; },
          'live',
        );
        expect(results.map(r => r.url)).toContain('https://live.example');
        expect(fetcherCalled).toBe(false);
      } finally {
        global.fetch = originalFetch;
        delete process.env.BRAVE_API_KEY;
      }
    });

    it('🔒 a LIVE question whose paid engine errors still falls through to the free one', async () => {
      process.env.BRAVE_API_KEY = 'test-key';
      const client = new WebSearchClient();
      let fetcherCalled = false;
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as any;
      try {
        await client.search(
          'aaj ka gold rate kya hai',
          3,
          async () => { fetcherCalled = true; return '<html></html>'; },
          'live',
        );
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
