// AgentV3 — Web Search tool (ported from Engineer AI's WebSearchClient, made self-contained and
// strict-typed so v5.0 owns it and it survives deletion of the old engines).
//
// Lets the agent look up package versions, framework docs and error meanings instead of being
// blind to anything outside the workspace. Priority:
//   Which engine is asked FIRST depends on the caller's `intent` (see `searchOrder()` in
//   `lib/braveSearch.ts`, the ONE Brave client shared with Engineer AI — so the cache, the coalescing
//   and the meter that keep its per-request bill down exist in exactly one place):
//     • `reference` (the DEFAULT, and what the agent's own lookups are) — DuckDuckGo first, since a
//       package version or an error message does not need a paid engine and nobody is watching a
//       spinner during a build. Brave is asked only if DuckDuckGo finds nothing.
//     • `live` (the chat's grounding) — Brave first, DuckDuckGo as the free rescue.
//   With no BRAVE_API_KEY set, DuckDuckGo is the only engine — which is production's behaviour today.
// npm registry is queried for package-name lookups regardless of provider.
//
// Everything degrades gracefully: on any network/parse failure it returns an empty list rather
// than throwing, so the agent simply learns "no results" and moves on.

import { braveSearch, searchOrder, noteFreeServed, noteRescue, type SearchIntent } from '../lib/braveSearch';

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
  /**
   * Run a search and return up to `limit` de-duplicated results.
   *
   * `intent` decides which engine is asked first — see `searchOrder()`. It defaults to `reference`
   * (free engine first) because the agent's own lookups are stable technical queries nobody is
   * waiting on; the chat's grounding passes `live`, which is the class Brave is paid for.
   */
  async search(query: string, limit = 5, intent: SearchIntent = 'reference'): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // 1. Package-style queries get authoritative npm metadata.
    const pkg = this.detectPackage(query);
    if (pkg) {
      const npm = await this.npmInfo(pkg).catch(() => null);
      if (npm) results.push(npm);
    }

    // 2. Web results: free engine first unless this is a live question — see `searchOrder()`.
    const web = await this.routedWeb(query, limit, intent);

    for (const r of web) {
      if (results.length >= limit) break;
      if (!results.some((existing) => existing.url === r.url)) results.push(r);
    }
    return results.slice(0, limit);
  }

  /**
   * Ask the engines in the order `searchOrder()` gives, stopping at the first that finds anything.
   *
   * 🔒 An engine that THROWS and an engine that returns nothing are treated the same on purpose: from
   * the caller's chair both mean "this one did not answer", and the next engine is free to try. What
   * must never happen is returning nothing while an untried engine was available.
   */
  private async routedWeb(query: string, limit: number, intent: SearchIntent): Promise<SearchResult[]> {
    const braveKey = process.env.BRAVE_API_KEY;
    const order = searchOrder(intent, !!braveKey);
    let last: SearchResult[] = [];
    for (let i = 0; i < order.length; i++) {
      const engine = order[i];
      const got =
        engine === 'brave' && braveKey
          ? await braveSearch(query, limit, braveKey).catch(() => [])
          : await this.duckDuckGo(query, limit).catch(() => []);
      if (got.length) {
        if (i > 0) noteRescue();
        else if (engine === 'duck' && braveKey) noteFreeServed();
        return got;
      }
      last = got;
    }
    return last;
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
