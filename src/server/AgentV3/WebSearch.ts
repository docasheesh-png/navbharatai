// AgentV3 — Web Search tool (ported from Engineer AI's WebSearchClient, made self-contained and
// strict-typed so v3.0 owns it and it survives deletion of the old engines).
//
// Lets the agent look up package versions, framework docs and error meanings instead of being
// blind to anything outside the workspace. Priority:
//   1. Brave Search API — if BRAVE_API_KEY is set (higher-quality results).
//   2. DuckDuckGo HTML SERP — key-free fallback, always available.
// npm registry is queried for package-name lookups regardless of provider.
//
// Everything degrades gracefully: on any network/parse failure it returns an empty list rather
// than throwing, so the agent simply learns "no results" and moves on.

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** The injected tool function the dispatcher calls: returns a formatted, agent-readable string. */
export type WebSearchFn = (query: string, limit: number) => Promise<string>;

const SEARCH_TIMEOUT_MS = 10_000;
const NPM_TIMEOUT_MS = 8_000;

export class WebSearch {
  /** Run a search and return up to `limit` de-duplicated results. */
  async search(query: string, limit = 5): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // 1. Package-style queries get authoritative npm metadata.
    const pkg = this.detectPackage(query);
    if (pkg) {
      const npm = await this.npmInfo(pkg).catch(() => null);
      if (npm) results.push(npm);
    }

    // 2. Web results: Brave if configured, else DuckDuckGo.
    const braveKey = process.env.BRAVE_API_KEY;
    const web = braveKey
      ? await this.braveSearch(query, limit, braveKey).catch(() => this.duckDuckGo(query, limit).catch(() => []))
      : await this.duckDuckGo(query, limit).catch(() => []);

    for (const r of web) {
      if (results.length >= limit) break;
      if (!results.some((existing) => existing.url === r.url)) results.push(r);
    }
    return results.slice(0, limit);
  }

  private detectPackage(query: string): string | null {
    const q = query.trim();
    const m = q.match(/(?:npm|package|install|version of)\s+(@?[a-z0-9][\w./-]*)/i);
    if (m) return m[1].replace(/[.,)]+$/, '');
    if (/^@?[a-z0-9][\w./-]*$/i.test(q) && q.length <= 60) return q;
    return null;
  }

  async npmInfo(pkg: string): Promise<SearchResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NPM_TIMEOUT_MS);
    try {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        name?: string;
        description?: string;
        homepage?: string;
        'dist-tags'?: { latest?: string };
      };
      const latest = data['dist-tags']?.latest || 'unknown';
      const name = data.name || pkg;
      const desc = data.description || '';
      const home = data.homepage || `https://www.npmjs.com/package/${name}`;
      return {
        title: `npm: ${name}@${latest}`,
        url: home,
        snippet: `${desc} — latest version ${latest}. Install: npm install ${name}`,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Brave Search API — throws on error so the caller can fall back to DuckDuckGo. */
  private async braveSearch(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': apiKey },
      });
      if (!res.ok) throw new Error(`Brave Search: HTTP ${res.status}`);
      const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
      const items = data?.web?.results || [];
      return items.slice(0, limit).map((item) => ({
        title: String(item.title || ''),
        url: String(item.url || ''),
        snippet: String(item.description || ''),
      }));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Scrape DuckDuckGo's HTML endpoint (no key, no JS). */
  private async duckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!res.ok) return [];
      return parseDuckDuckGo(await res.text(), limit);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Parse result blocks from DuckDuckGo HTML SERP markup. Exported for unit testing. */
export function parseDuckDuckGo(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(stripHtml(sm[1]));

  let lm: RegExpExecArray | null;
  let i = 0;
  while ((lm = linkRe.exec(html)) !== null && results.length < limit) {
    const url = decodeDdgLink(lm[1]);
    const title = stripHtml(lm[2]);
    if (!url || !title) { i++; continue; }
    results.push({ title, url, snippet: snippets[i] || '' });
    i++;
  }
  return results;
}

function decodeDdgLink(href: string): string {
  try {
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (href.startsWith('//')) return `https:${href}`;
    return href;
  } catch {
    return href;
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Format results into a compact, agent-readable block. Exported for testing. */
export function formatSearchResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) return `No web results for "${query}".`;
  const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`.trimEnd());
  return `Web results for "${query}":\n\n${lines.join('\n\n')}`;
}

/** The default tool function the route injects into the dispatcher. */
export function makeWebSearch(): WebSearchFn {
  const client = new WebSearch();
  return async (query: string, limit: number): Promise<string> => {
    const results = await client.search(query, Math.max(1, Math.min(limit || 5, 10)));
    return formatSearchResults(query, results);
  };
}
