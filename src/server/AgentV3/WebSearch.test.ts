import { describe, it, expect } from 'vitest';
import { parseDuckDuckGo, formatSearchResults, type SearchResult } from './WebSearch';
import { roleConfig } from './AgentRegistry';
import { CATALOG_TOOL_NAMES, defaultToolCatalog, catalogForTools } from './ToolCatalog';

describe('parseDuckDuckGo', () => {
  const html = `
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvitejs.dev%2Fconfig%2F">Vite Config</a>
    <a class="result__snippet">The vite.config.ts reference &amp; server.host option.</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnpmjs.com%2Fzod">zod npm</a>
    <a class="result__snippet">TypeScript-first schema validation.</a>
  `;

  it('extracts titles, decodes the wrapped uddg url, and pairs snippets', () => {
    const r = parseDuckDuckGo(html, 5);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ title: 'Vite Config', url: 'https://vitejs.dev/config/', snippet: 'The vite.config.ts reference & server.host option.' });
    expect(r[1].url).toBe('https://npmjs.com/zod');
  });

  it('respects the limit and returns [] for empty html', () => {
    expect(parseDuckDuckGo(html, 1)).toHaveLength(1);
    expect(parseDuckDuckGo('', 5)).toEqual([]);
  });
});

describe('formatSearchResults', () => {
  it('renders a numbered block', () => {
    const results: SearchResult[] = [{ title: 'A', url: 'https://a.com', snippet: 'first' }];
    const out = formatSearchResults('q', results);
    expect(out).toContain('Web results for "q"');
    expect(out).toContain('1. A');
    expect(out).toContain('https://a.com');
  });
  it('is honest when there are no results', () => {
    expect(formatSearchResults('nothing', [])).toBe('No web results for "nothing".');
  });
});

describe('web_search tool registration', () => {
  it('is a known catalog tool and in the architect tool-set', () => {
    expect((CATALOG_TOOL_NAMES as readonly string[]).includes('web_search')).toBe(true);
    expect(roleConfig('architect').tools).toContain('web_search');
  });
  it('has a definition that catalogForTools includes for the architect', () => {
    expect(defaultToolCatalog().some((t) => t.name === 'web_search')).toBe(true);
    const archDefs = catalogForTools(roleConfig('architect').tools);
    expect(archDefs.some((t) => t.name === 'web_search')).toBe(true);
  });
});
