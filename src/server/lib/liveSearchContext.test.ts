import { describe, it, expect } from 'vitest';
import { needsLiveSearch, liveSearchContext } from './liveSearchContext';
import type { SearchResult } from '../AgentV3/WebSearch';

const stubClient = (results: SearchResult[], delayMs = 0) => ({
  search: async (): Promise<SearchResult[]> => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return results;
  },
});

describe('needsLiveSearch — the recency gate (only fetch when the answer needs current facts)', () => {
  it('TRUE for clearly time-sensitive questions (English + Hindi)', () => {
    expect(needsLiveSearch('who is the current India cricket captain')).toBe(true);
    expect(needsLiveSearch('latest iPhone price')).toBe(true);
    expect(needsLiveSearch('today match score')).toBe(true);
    expect(needsLiveSearch('India ka squad 2026')).toBe(true);
    expect(needsLiveSearch('aaj ka gold rate kitna hai')).toBe(true);
    expect(needsLiveSearch('taaza news')).toBe(true);
  });

  it('FALSE for evergreen / non-factual / greeting messages (no needless search)', () => {
    expect(needsLiveSearch('hi')).toBe(false);
    expect(needsLiveSearch('namaste')).toBe(false);
    expect(needsLiveSearch('thank you')).toBe(false);
    expect(needsLiveSearch('write me a poem about the moon')).toBe(false);
    expect(needsLiveSearch('explain how photosynthesis works')).toBe(false);
    expect(needsLiveSearch('make me a todo app')).toBe(false);
  });
});

describe('liveSearchContext — builds a grounding block only when useful', () => {
  it('returns a LIVE WEB RESULTS block with the fetched results for a time-sensitive query', async () => {
    const out = await liveSearchContext('latest India cricket squad', {
      client: stubClient([{ title: 'Squad', url: 'https://x.test', snippet: 'The 2026 squad is ...' }]),
      now: new Date('2026-07-12T00:00:00Z'),
    });
    expect(out).toContain('LIVE WEB RESULTS');
    expect(out).toContain('2026-07-12');
    expect(out).toContain('https://x.test');
    expect(out).toMatch(/PRIMARY source/i);
  });

  it('returns "" when the message does not need live data (no search fired)', async () => {
    let called = false;
    const out = await liveSearchContext('write a haiku', {
      client: { search: async () => { called = true; return []; } },
    });
    expect(out).toBe('');
    expect(called).toBe(false);
  });

  it('returns "" when the search yields nothing', async () => {
    const out = await liveSearchContext('latest news', { client: stubClient([]) });
    expect(out).toBe('');
  });

  it('returns "" (never hangs) when the search exceeds the timeout', async () => {
    const out = await liveSearchContext('latest news', {
      client: stubClient([{ title: 't', url: 'u', snippet: 's' }], 200),
      timeoutMs: 20,
    });
    expect(out).toBe('');
  });
});
