import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  braveSearch,
  braveMeter,
  cacheKey,
  cacheTtlMs,
  braveCacheEnabled,
  braveApiKey,
  searchOrder,
  __resetBraveSearch,
  VOLATILE_TTL_MS,
  STANDARD_TTL_MS,
  MAX_CACHE_ENTRIES,
} from '../src/server/lib/braveSearch';

/**
 * EVERY SEARCH IS ₹0.44, SO THE ONLY HONEST SAVING IS NOT REPEATING ONE.
 *
 * Brave's Search plan bills per REQUEST. These tests pin the two things that make the bill smaller —
 * coalescing identical in-flight calls and a short cache — and, far more importantly, the three things
 * that stop that saving from being bought with a wrong answer: a fast-moving query expires in a minute,
 * an empty or failed response is never remembered, and an outage still reaches the caller as a throw so
 * the free DuckDuckGo fallback still fires.
 */

const okResponse = (results: Array<{ title: string; url: string; description: string }>) => ({
  ok: true,
  json: async () => ({ web: { results } }),
});
const ONE = [{ title: 'T', url: 'https://example.com', description: 'D' }];

describe('braveApiKey — a key entered by hand must not silently not-work', () => {
  it('🔒 trims, because a pasted key carries a trailing space or newline and the header would be rejected', () => {
    expect(braveApiKey({ BRAVE_API_KEY: ' BSA-token ' } as never)).toBe('BSA-token');
    expect(braveApiKey({ BRAVE_API_KEY: 'BSA-token\n' } as never)).toBe('BSA-token');
    expect(braveApiKey({ BRAVE_API_KEY: '\tBSA-token' } as never)).toBe('BSA-token');
  });

  it('🔒 whitespace-only is UNSET, not a key — otherwise every search buys a guaranteed rejection', () => {
    expect(braveApiKey({ BRAVE_API_KEY: '   ' } as never)).toBeUndefined();
    expect(braveApiKey({ BRAVE_API_KEY: '' } as never)).toBeUndefined();
    expect(braveApiKey({} as never)).toBeUndefined();
  });

  it('leaves a real key untouched', () => {
    expect(braveApiKey({ BRAVE_API_KEY: 'BSA-abc_123' } as never)).toBe('BSA-abc_123');
  });
});

describe('searchOrder — free first where it is safe, paid first where it matters', () => {
  it('no key ⇒ the free engine is the only engine, exactly as production behaves today', () => {
    expect(searchOrder('live', false)).toEqual(['duck']);
    expect(searchOrder('reference', false)).toEqual(['duck']);
  });

  it('🔒 a REFERENCE lookup asks the FREE engine first — a build is not watching a spinner', () => {
    expect(searchOrder('reference', true)).toEqual(['duck', 'brave']);
  });

  it('🔒 a LIVE question asks the PAID engine first — this is the class it is bought for', () => {
    expect(searchOrder('live', true)).toEqual(['brave', 'duck']);
  });

  it('every order ends with a second engine to rescue the first, so neither being down leaves nothing', () => {
    expect(searchOrder('live', true)).toHaveLength(2);
    expect(searchOrder('reference', true)).toHaveLength(2);
  });
});

describe('cacheTtlMs — the freshness trade, made explicit and small', () => {
  it('gives the tick-by-tick things one minute', () => {
    for (const q of ['ind vs aus score', 'live match update', 'nifty today', 'bitcoin price now'])
      expect(cacheTtlMs(q), q).toBe(VOLATILE_TTL_MS);
  });

  it('gives everything else ten minutes — ten-minute-old results are not stale to a human', () => {
    for (const q of ['aaj ka gold rate', 'latest iphone price', 'weather in mumbai', 'react 19 release notes'])
      expect(cacheTtlMs(q), q).toBe(STANDARD_TTL_MS);
  });

  it('survives rubbish rather than throwing into a live chat turn', () => {
    expect(cacheTtlMs(undefined as never)).toBe(STANDARD_TTL_MS);
    expect(cacheTtlMs(null as never)).toBe(STANDARD_TTL_MS);
  });
});

describe('cacheKey — one search is one search, however it was typed', () => {
  it('collapses case and spacing, because Brave does not distinguish them either', () => {
    expect(cacheKey('Aaj Ka Gold Rate', 5)).toBe(cacheKey('  aaj ka   gold rate ', 5));
  });

  it('🔒 keeps count in the key — three results cannot serve a request for ten', () => {
    expect(cacheKey('x', 3)).not.toBe(cacheKey('x', 10));
  });

  it('does not merge two different questions', () => {
    expect(cacheKey('gold rate', 5)).not.toBe(cacheKey('silver rate', 5));
  });
});

describe('braveCacheEnabled — on unless explicitly turned off', () => {
  it('defaults ON, because a repeat call costs money for nothing', () => {
    expect(braveCacheEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });
  it('off is the kill switch, in any casing', () => {
    expect(braveCacheEnabled({ BRAVE_SEARCH_CACHE: 'off' } as never)).toBe(false);
    expect(braveCacheEnabled({ BRAVE_SEARCH_CACHE: ' OFF ' } as never)).toBe(false);
  });
});

describe('braveSearch — paying once for the same question', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetBraveSearch();
    delete process.env.BRAVE_SEARCH_CACHE;
    fetchMock = vi.fn().mockResolvedValue(okResponse(ONE));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetBraveSearch();
  });

  it('calls Brave with the documented request shape — the header IS the credential', async () => {
    await braveSearch('react hooks', 3, 'k1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('api.search.brave.com/res/v1/web/search'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Subscription-Token': 'k1' }) }),
    );
    expect(fetchMock.mock.calls[0][0]).toContain('count=3');
  });

  it('a repeat of the same question inside the window is FREE', async () => {
    const a = await braveSearch('aaj ka gold rate', 5, 'k');
    const b = await braveSearch('AAJ KA GOLD RATE', 5, 'k');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    expect(braveMeter()).toMatchObject({ calls: 1, cacheHits: 1, saved: 1, savedPct: 50 });
  });

  it('🔒 two users asking at the SAME moment share one live call — and no staleness at all', async () => {
    let release!: (v: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const p1 = braveSearch('trending topic', 5, 'k');
    const p2 = braveSearch('trending topic', 5, 'k');
    release(okResponse(ONE));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(braveMeter()).toMatchObject({ calls: 1, coalesced: 1 });
  });

  it('a different question, or a different result count, is a different search', async () => {
    await braveSearch('gold rate', 5, 'k');
    await braveSearch('silver rate', 5, 'k');
    await braveSearch('gold rate', 10, 'k');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('🔒 a fast-moving query is re-searched after a minute, an ordinary one is not', async () => {
    const t0 = Date.now();
    const clock = vi.spyOn(Date, 'now');

    clock.mockReturnValue(t0);
    await braveSearch('ind vs aus score', 5, 'k');
    await braveSearch('aaj ka gold rate', 5, 'k');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    clock.mockReturnValue(t0 + VOLATILE_TTL_MS + 1);
    await braveSearch('ind vs aus score', 5, 'k'); // expired — the score has moved
    await braveSearch('aaj ka gold rate', 5, 'k'); // still fresh
    expect(fetchMock).toHaveBeenCalledTimes(3);

    clock.mockReturnValue(t0 + STANDARD_TTL_MS + 1);
    await braveSearch('aaj ka gold rate', 5, 'k'); // now expired too
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  // 🔴 REGRESSION. This is the test that caught a real bug during development: the in-flight entry was
  // cleared in a detached `.finally()`, one microtask AFTER the caller's continuation, so the second
  // call coalesced onto an already-settled promise and was handed the empty result we had deliberately
  // refused to cache. The fix was an explicit `settled` flag, not an earlier `delete`.
  it('🔒 an EMPTY response is never remembered — one blocked minute must not become ten', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([]));
    expect(await braveSearch('obscure thing', 5, 'k')).toEqual([]);
    fetchMock.mockResolvedValueOnce(okResponse(ONE));
    expect(await braveSearch('obscure thing', 5, 'k')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('🔒 a failure THROWS — that contract is what keeps the free DuckDuckGo fallback alive', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(braveSearch('x', 5, 'k')).rejects.toThrow(/429/);
  });

  it('🔒 a rejected key is LOUD in the admin log, once — a silent fallback is how a bad key hides', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    await expect(braveSearch('a', 5, 'k')).rejects.toThrow();
    await expect(braveSearch('b', 5, 'k')).rejects.toThrow();
    expect(warn).toHaveBeenCalledTimes(1); // once per status, not once per search
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('BRAVE_API_KEY');
    expect(line).toContain('403');
    // It must also say the users are fine, so the log is actionable rather than alarming.
    expect(line).toMatch(/nothing is broken for users/i);
  });

  it('🔒 a failure is not cached either — the next question retries rather than inheriting an outage', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(braveSearch('y', 5, 'k')).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(okResponse(ONE));
    expect(await braveSearch('y', 5, 'k')).toHaveLength(1);
  });

  it('with the kill switch off, every call reaches Brave exactly as before this module existed', async () => {
    process.env.BRAVE_SEARCH_CACHE = 'off';
    await braveSearch('same', 5, 'k');
    await braveSearch('same', 5, 'k');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    delete process.env.BRAVE_SEARCH_CACHE;
  });

  it('the cache is bounded, so a busy day cannot grow the heap without end', async () => {
    for (let i = 0; i < MAX_CACHE_ENTRIES + 25; i++) await braveSearch(`q${i}`, 5, 'k');
    // The oldest entries were evicted, so the very first query must be bought again.
    const before = fetchMock.mock.calls.length;
    await braveSearch('q0', 5, 'k');
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });
});

describe('wiring — ONE client, and both callers still fall back to the free path', () => {
  const v3 = readFileSync(join(process.cwd(), 'src/server/AgentV3/WebSearch.ts'), 'utf8');
  const eng = readFileSync(join(process.cwd(), 'src/server/EngineerAI/WebSearchClient.ts'), 'utf8');

  it('🔒 the duplicated private copies are gone — one door is what makes one cache possible', () => {
    for (const [name, src] of [['AgentV3', v3], ['EngineerAI', eng]] as const) {
      expect(src, name).toContain("from '../lib/braveSearch'");
      expect(src, name).not.toContain('private async braveSearch(');
      expect(src, name).not.toContain('api.search.brave.com');
    }
  });

  it('🔒 both callers route through searchOrder, so neither engine failing leaves the caller with nothing', () => {
    for (const [name, src] of [['AgentV3', v3], ['EngineerAI', eng]] as const) {
      expect(src, name).toContain('const order = searchOrder(intent, !!braveKey);');
      // A throw is swallowed to [] so the loop can try the OTHER engine — never so the caller gets [].
      expect(src, name).toContain('await braveSearch(query, limit, braveKey).catch(() => [])');
      expect(src, name).toContain('if (i > 0) noteRescue();');
    }
  });

  it('🔒 nobody reads the raw env any more — the trim lives in one place or it lives nowhere', () => {
    for (const [name, src] of [['AgentV3', v3], ['EngineerAI', eng]] as const) {
      expect(src, name).toContain('const braveKey = braveApiKey();');
      expect(src, name).not.toContain('process.env.BRAVE_API_KEY');
    }
  });

  it("🔒 only the chat's grounding asks for the paid engine first — everything else defaults to free", () => {
    const live = readFileSync(join(process.cwd(), 'src/server/lib/liveSearchContext.ts'), 'utf8');
    expect(live).toContain("client.search(query, limit, 'live')");
    for (const [name, src] of [['AgentV3', v3], ['EngineerAI', eng]] as const)
      expect(src, name).toContain("intent: SearchIntent = 'reference'");
  });
});
