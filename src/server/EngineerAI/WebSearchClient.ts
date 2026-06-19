export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const SEARCH_TIMEOUT_MS = 10_000;
const NPM_TIMEOUT_MS = 8_000;

/**
 * Key-free web search for Engineer AI.
 *
 * No paid search API is required (the user only supplied GROK_API_KEY + E2B_API_KEY):
 *  - General queries → DuckDuckGo HTML SERP (scraped, no key).
 *  - Package queries → npm registry (registry.npmjs.org, no key) — the single most
 *    useful source for an app builder, since wrong versions cause install failures.
 *
 * Everything degrades gracefully: on any network/parse failure it returns an empty
 * list rather than throwing, so the agent simply learns "no results" and moves on.
 */
/** Fetches the raw HTML of a URL. Injected so the caller can run it from inside
 *  the E2B sandbox (open internet) instead of the egress-restricted server. */
export type HtmlFetcher = (url: string) => Promise<string>;

export class WebSearchClient {
  /**
   * @param query       what to look up
   * @param limit       max results
   * @param htmlFetcher optional — if supplied, used to fetch the DuckDuckGo SERP
   *                    (e.g. via a sandbox curl). Falls back to a server-side fetch.
   */
  async search(query: string, limit = 5, htmlFetcher?: HtmlFetcher): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // 1. If the query looks like a package lookup, enrich with authoritative npm data.
    const pkg = this.detectPackage(query);
    if (pkg) {
      const npm = await this.npmInfo(pkg).catch(() => null);
      if (npm) results.push(npm);
    }

    // 2. General web results from DuckDuckGo.
    const web = await this.duckDuckGo(query, limit, htmlFetcher).catch(() => []);
    for (const r of web) {
      if (results.length >= limit) break;
      if (!results.some(existing => existing.url === r.url)) results.push(r);
    }

    return results.slice(0, limit);
  }

  /** Detect a bare-ish npm package query like "npm axios", "axios version", "@scope/pkg". */
  private detectPackage(query: string): string | null {
    const q = query.trim();
    const m = q.match(/(?:npm|package|install|version of)\s+(@?[a-z0-9][\w./-]*)/i);
    if (m) return m[1].replace(/[.,)]+$/, '');
    // A lone token that looks like a package name (no spaces, valid chars)
    if (/^@?[a-z0-9][\w./-]*$/i.test(q) && q.length <= 60) return q;
    return null;
  }

  /** Authoritative package metadata from the public npm registry — no key needed. */
  async npmInfo(pkg: string): Promise<SearchResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NPM_TIMEOUT_MS);
    try {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      const latest = data['dist-tags']?.latest || 'unknown';
      const desc = data.description || '';
      const home = data.homepage || `https://www.npmjs.com/package/${pkg}`;
      return {
        title: `npm: ${data.name}@${latest}`,
        url: home,
        snippet: `${desc} — latest version ${latest}. Install: npm install ${data.name}`,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Scrape DuckDuckGo's HTML endpoint (no key, no JS required). */
  private async duckDuckGo(query: string, limit: number, htmlFetcher?: HtmlFetcher): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    // Prefer the injected fetcher (sandbox curl, open internet); fall back to server fetch.
    if (htmlFetcher) {
      try {
        const html = await htmlFetcher(url);
        return this.parseDuckDuckGo(html || '', limit);
      } catch {
        return [];
      }
    }

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
      const html = await res.text();
      return this.parseDuckDuckGo(html, limit);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /** Parse result blocks from DuckDuckGo HTML SERP markup. */
  private parseDuckDuckGo(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];
    // Each result anchor: <a ... class="result__a" href="LINK">TITLE</a>
    const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    // Snippets: <a class="result__snippet" ...>SNIPPET</a>
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
}

/** DuckDuckGo wraps target URLs as //duckduckgo.com/l/?uddg=<encoded>. Unwrap them. */
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

/** Strip HTML tags + decode the few entities DuckDuckGo emits. */
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
