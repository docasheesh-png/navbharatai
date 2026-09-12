import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSearch } from '../src/server/AgentV3/WebSearch';
import { __resetBraveSearch } from '../src/server/lib/braveSearch';

// Regression lock for the "free chat me Brave ka istemal kanjusi se" cost rule (admin 2026-09-12):
// a cost-conscious (cheap: true) search must run DuckDuckGo first — even for a 'live' chat question,
// which otherwise leads with Brave — and spend a Brave lookup only when DuckDuckGo genuinely comes
// back empty. A paid/default 'live' search keeps the Brave-first order.

const DDG_HTML_WITH_RESULTS = `
  <a class="result__a" href="https://example.com/a">Result A</a>
  <a class="result__snippet">Snippet A</a>
`;
const DDG_HTML_EMPTY = '<html><body>no results</body></html>';

function mockFetch({ ddgHtml, braveResults }: { ddgHtml: string; braveResults?: unknown[] }) {
  return vi.fn(async (url: string) => {
    if (url.includes('html.duckduckgo.com')) {
      return { ok: true, text: async () => ddgHtml } as any;
    }
    if (url.includes('api.search.brave.com')) {
      return { ok: true, json: async () => ({ web: { results: braveResults ?? [] } }) } as any;
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any;
  });
}

describe('WebSearch — cost-conscious (cheap) provider order', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.BRAVE_API_KEY;
    __resetBraveSearch();
  });
  afterEach(() => {
    delete process.env.BRAVE_API_KEY;
    global.fetch = originalFetch;
    __resetBraveSearch();
  });

  it('cheap + live intent: DuckDuckGo answers → Brave is never called, even with a key configured', async () => {
    process.env.BRAVE_API_KEY = 'test-brave-key';
    const fetchMock = mockFetch({ ddgHtml: DDG_HTML_WITH_RESULTS });
    global.fetch = fetchMock as any;

    const results = await new WebSearch().search('cheap query one', 5, 'live', true);

    expect(results.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('api.search.brave.com'), expect.anything());
  });

  it('cheap + live intent: DuckDuckGo empty → falls back to Brave as a last resort', async () => {
    process.env.BRAVE_API_KEY = 'test-brave-key';
    const fetchMock = mockFetch({
      ddgHtml: DDG_HTML_EMPTY,
      braveResults: [{ title: 'Brave result', url: 'https://brave.example/two', description: 'from brave' }],
    });
    global.fetch = fetchMock as any;

    const results = await new WebSearch().search('cheap query two', 5, 'live', true);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('api.search.brave.com'), expect.anything());
    expect(results.some((r) => r.url === 'https://brave.example/two')).toBe(true);
  });

  it('cheap with no Brave key configured: DuckDuckGo only, no Brave call attempted', async () => {
    const fetchMock = mockFetch({ ddgHtml: DDG_HTML_EMPTY });
    global.fetch = fetchMock as any;

    await new WebSearch().search('cheap query three', 5, 'live', true);

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('api.search.brave.com'), expect.anything());
  });

  it('default (paid) live order is unchanged: Brave leads when a key is configured, DuckDuckGo not called', async () => {
    process.env.BRAVE_API_KEY = 'test-brave-key';
    const fetchMock = mockFetch({
      ddgHtml: DDG_HTML_WITH_RESULTS,
      braveResults: [{ title: 'Brave result', url: 'https://brave.example/four', description: 'from brave' }],
    });
    global.fetch = fetchMock as any;

    const results = await new WebSearch().search('cheap query four', 5, 'live');

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('html.duckduckgo.com'), expect.anything());
    expect(results.some((r) => r.url === 'https://brave.example/four')).toBe(true);
  });
});
