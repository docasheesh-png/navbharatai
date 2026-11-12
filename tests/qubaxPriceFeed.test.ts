import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectQubaxPrices, decimalNanoUsd, normalizeQubaxPriceSource, QUBAX_PRICE_FEED_FETCH_MS, QUBAX_PRICE_FEED_MAX_BYTES,
  QUBAX_PRICE_SOURCES, validQubaxPriceSnapshot } from '../src/server/lib/qubaxPriceFeed';
import { selectQubaxCandidate } from '../src/server/lib/qubaxSelector';
import { QUBAX_PRICE_FEED_DNS_MS, qubaxPriceFeedDispatcher, qubaxPriceFeedLookup, qubaxPriceFeedPublicIp } from '../src/server/lib/qubaxPriceFeedNetwork';
import { feedFetch, feedHeaders, FEED_NOW as NOW, marketFixture, openaiFixture, zaiFixture } from './qubaxPriceFeedFixtures';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const normalize = (raw = marketFixture(), headers = feedHeaders(), start = NOW, end = NOW) => normalizeQubaxPriceSource('qubax', raw, headers, start, end);
describe('Qubax public price observation parsing', () => {
  it.each([['0', 0], ['0.000000001', 1], ['0.1', 100_000_000], ['0.0000037', 3_700], ['1e-7', 100], ['1.2300000000', 1_230_000_000], ['9007199.254740991', Number.MAX_SAFE_INTEGER]])('parses %s exactly', (input, expected) => {
    expect(decimalNanoUsd(input)).toBe(expected);
  });
  it.each(['-1', 'NaN', 'Infinity', '1e999', '0.0000000001', '9007199.254740992', '01', '1,000', ' 1', '1.'])('rejects inexact/invalid rate %s', input => {
    expect(() => decimalNanoUsd(input)).toThrow('QUBAX_PRICE_FEED_UNAVAILABLE');
  });
  it('keeps unknown prices, excludes media units, and ignores advertised discounts', () => {
    const s = normalize();
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]).toMatchObject({ inputNanoUsd: 3_700, outputNanoUsd: 100_000_000, cacheReadNanoUsd: null, allFeesIncluded: null, revision: null, tokenizer: null });
    expect(s.rows[1].inputNanoUsd).toBeNull();
    expect(s.rows[0].discountHundredths).toBe(9_999);
    expect(JSON.stringify(s)).not.toMatch(/discount_pct|benchmark|99\.99|fixture-image/);
    expect(s).toMatchObject({ parser: 'qubax-public-price-parser-v1', sourceUpdatedAtMs: NOW, expiresAtMs: NOW + 300_000, bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  it('uses source-aware JSON lexemes instead of first rounding them to floating point', () => {
    expect(normalize(marketFixture().replace('0.0000037', '1e-7')).rows[0].inputNanoUsd).toBe(100);
    expect(normalize(marketFixture().replace('0.0000037', '9007199.2547409911')).rows[0].inputNanoUsd).toBeNull();
    expect(normalize(marketFixture().replace('0.0000037', '"0.0000037"')).rows[0].inputNanoUsd).toBeNull();
  });
  it.each(['"input_per_1m"', '"input_per_\\u0031m"'])('rejects duplicate JSON member %s before parse loses the ambiguity', key => {
    const raw = marketFixture().replace('"input_per_1m":', `${key}:9,"input_per_1m":`);
    expect(() => normalize(raw)).toThrow();
    expect(() => normalize(marketFixture().replace('"object":"list"', '"object":"list","object":"list"'))).toThrow();
    expect(() => normalize(marketFixture().replace('"data":', '"extra":{"nested":{"same":1,"same":2}},"data":'))).toThrow();
  });
  it('bounds raw JSON nesting and excludes zero-context entries without asserting capacity', () => {
    const raw = JSON.parse(marketFixture()); raw.data.push({ ...raw.data[0], id: 'zero-context', context_length: 0 });
    expect(normalize(JSON.stringify(raw)).rows).toHaveLength(2);
    const nested = '"extra":' + '['.repeat(33) + '0' + ']'.repeat(33) + ',';
    expect(() => normalize(marketFixture().replace('"data":', `${nested}"data":`))).toThrow();
  });
  it.each(['2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z'])('rejects normalized invalid calendar stamp %s', stamp => {
    const at = Date.parse(stamp), raw = JSON.parse(marketFixture(at)); raw.updated_at = stamp;
    expect(() => normalizeQubaxPriceSource('qubax', JSON.stringify(raw), feedHeaders('qubax', at), at, at)).toThrow();
  });
  it.each(['missing-stamp', 'future', 'pagination'])('rejects %s market', reason => {
    const raw = JSON.parse(marketFixture());
    if (reason === 'missing-stamp') delete raw.updated_at;
    if (reason === 'future') raw.updated_at = new Date(NOW + 1).toISOString();
    if (reason === 'pagination') raw.next_cursor = 'next';
    expect(() => normalize(JSON.stringify(raw))).toThrow();
  });
  it('skips a bad row and still publishes the rest of the market', () => {
    const raw = JSON.parse(marketFixture());
    raw.data.push(raw.data[0]);
    raw.data.push({ ...raw.data[0], id: 'bad-context', context_length: 0.5 });
    raw.data.push({ ...raw.data[0], id: 'negative', input_per_1m: -1 });
    raw.data[0] = { ...raw.data[0] }; delete raw.data[0].input_per_1m;
    const rows = normalize(JSON.stringify(raw)).rows;
    expect(rows.map(row => row.sourceModelLabel)).toEqual(['fixture-text', 'fixture-multimodal', 'negative']);
    expect(rows[0].inputNanoUsd).toBeNull();
    expect(rows[2].inputNanoUsd).toBeNull();
  });
  it.each(['missing-date', 'future-date', 'negative-age', 'stale-warning'])('rejects %s rather than renewing it', reason => {
    const h = feedHeaders();
    if (reason === 'missing-date') h.delete('date');
    if (reason === 'future-date') h.set('date', new Date(NOW + 1_000).toUTCString());
    if (reason === 'negative-age') h.set('age', '-1');
    if (reason === 'stale-warning') h.set('warning', '110 cache "Response is stale"');
    expect(() => normalize(marketFixture(), h)).toThrow();
  });
  it('treats a successful Qubax fetch as fresh even when the CDN age is old', () => {
    const h = feedHeaders(); h.set('age', '7288');
    expect(normalize(marketFixture(NOW - 30_000), h).expiresAtMs).toBe(NOW + 300_000);
    expect(() => normalize(marketFixture(), h, NOW, NOW - 1)).toThrow();
  });
  it('keeps OpenAI standard context/cache dimensions and excludes batch prices', () => {
    const s = normalizeQubaxPriceSource('openai', openaiFixture, feedHeaders('openai'), NOW, NOW);
    expect(s.rows).toHaveLength(3);
    expect(s.rows[0]).toMatchObject({ sourceModelLabel: 'gpt-fixture', contextBand: 'short', serviceTier: 'standard', inputNanoUsd: 2_000_000_000, cacheWrite12hNanoUsd: 5_000_000_000 });
    expect(s.rows[1]).toMatchObject({ contextBand: 'long', inputNanoUsd: 4_000_000_000 });
    expect(s.rows[2]).toMatchObject({ inputNanoUsd: 200_000_000, cacheReadNanoUsd: null });
  });
  it('keeps Z.AI cache storage conditional and leaves fees/tier unknown', () => {
    const s = normalizeQubaxPriceSource('zai', zaiFixture, feedHeaders('zai'), NOW, NOW);
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]).toMatchObject({ inputNanoUsd: 1_400_000_000, cacheReadNanoUsd: 260_000_000, cacheStorage: 'limited-time-free', serviceTier: 'unspecified', allFeesIncluded: null });
    expect(s.rows[1]).toMatchObject({ cacheReadNanoUsd: null, cacheStorage: 'unknown' });
  });
  it.each(['header', 'currency', 'duplicate', 'qualifier', 'precision'])('rejects changed/ambiguous official schema: %s', reason => {
    let raw = zaiFixture;
    if (reason === 'header') raw = raw.replace('Cached Input Storage', 'Storage');
    if (reason === 'currency') raw = raw.replace('USD', 'EUR');
    if (reason === 'duplicate') raw = raw.replace('GLM-Fixture-Previous', 'GLM-Fixture');
    if (reason === 'qualifier') raw = raw.replace('$1.4', '$1.4 promotional');
    if (reason === 'precision') raw = raw.replace('$1.4', '$1.4000000001');
    expect(() => normalizeQubaxPriceSource('zai', raw, feedHeaders('zai'), NOW, NOW)).toThrow();
    expect(() => normalizeQubaxPriceSource('openai', openaiFixture.replace('Short context input', 'Input'), feedHeaders('openai'), NOW, NOW)).toThrow();
  });
});

describe('bounded independent public GET collection', () => {
  it('fetches exactly allowlisted sources without credentials or inference and never grants dispatch', async () => {
    const transport = feedFetch(), snapshot = await collectQubaxPrices(transport, () => NOW);
    expect(transport.mock.calls.map(([url]) => url)).toEqual(Object.values(QUBAX_PRICE_SOURCES));
    for (const [, init] of transport.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' });
      expect((init as RequestInit & { dispatcher: unknown }).dispatcher).toBe(qubaxPriceFeedDispatcher);
      expect(init?.headers).not.toHaveProperty('Authorization');
      expect(init?.body).toBeUndefined();
    }
    expect(snapshot.canDispatch).toBe(false);
    expect(snapshot.proofStatus).toBe('unreviewed');
    expect(validQubaxPriceSnapshot(snapshot, NOW)).toBe(true);
    expect(validQubaxPriceSnapshot(snapshot, NOW + 300_000)).toBe(false);
    expect(selectQubaxCandidate(snapshot, { inputTokens: 100, outputTokens: 100 }, NOW)).toBeNull();
  });
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.0.2.1', '198.51.100.2', '203.0.113.3', '::1',
    '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:127.0.0.1', 'ff02::1', '2001:db8::1', '2002:7f00:1::', '3fff::1'])('blocks DNS rebinding to %s at the connection boundary', ip => {
    let answer = '1.1.1.1';
    const resolve = vi.fn((_host, _options, cb) => cb(null, [{ address: answer, family: answer.includes(':') ? 6 : 4 }]));
    const lookup = qubaxPriceFeedLookup(resolve), first = vi.fn(), rebound = vi.fn();
    lookup('api.qubax.ai', {}, first);
    expect(first).toHaveBeenCalledWith(null, '1.1.1.1', 4);
    answer = ip;
    lookup('api.qubax.ai', {}, rebound);
    expect(rebound.mock.calls[0][0].code).toBe('ESSRFBLOCKED');
  });
  it('permits public v4/global v6 and rejects mixed DNS answers, malformed addresses and resolution failures', () => {
    expect(qubaxPriceFeedPublicIp('2606:4700:4700::1111')).toBe(true);
    expect(qubaxPriceFeedPublicIp('8.8.8.8')).toBe(true);
    expect(qubaxPriceFeedPublicIp('not-an-ip')).toBe(false);
    const all = vi.fn(), mixed = vi.fn(), errored = vi.fn();
    qubaxPriceFeedLookup((_h, _o, cb) => cb(null, [{ address: '8.8.8.8', family: 4 }]))('api.qubax.ai', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
    qubaxPriceFeedLookup((_h, _o, cb) => cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '::ffff:7f00:1', family: 6 }]))('api.qubax.ai', {}, mixed);
    expect(mixed.mock.calls[0][0].code).toBe('ESSRFBLOCKED');
    const error = new Error('DNS unavailable');
    qubaxPriceFeedLookup((_h, _o, cb) => cb(error))('api.qubax.ai', {}, errored);
    expect(errored).toHaveBeenCalledWith(error);
  });
  it('bounds noncooperative DNS per host without releasing its slot at timeout', async () => {
    vi.useFakeTimers();
    let complete: (...args: any[]) => void = () => {};
    const resolver = vi.fn((_host, _options, cb) => { complete = cb; }), lookup = qubaxPriceFeedLookup(resolver);
    const first = vi.fn(), blocked = vi.fn(), recovered = vi.fn();
    lookup('api.qubax.ai', {}, first);
    await vi.advanceTimersByTimeAsync(QUBAX_PRICE_FEED_DNS_MS);
    expect(first.mock.calls[0][0].code).toBe('ETIMEDOUT');
    lookup('API.QUBAX.AI.', {}, blocked);
    expect(blocked.mock.calls[0][0].code).toBe('EAGAIN');
    expect(resolver).toHaveBeenCalledTimes(1);
    complete(null, [{ address: '1.1.1.1', family: 4 }]);
    expect(first).toHaveBeenCalledTimes(1);
    lookup('api.qubax.ai', {}, recovered);
    expect(resolver).toHaveBeenCalledTimes(2);
    complete(null, [{ address: '1.1.1.1', family: 4 }]);
    expect(recovered).toHaveBeenCalledWith(null, '1.1.1.1', 4);
    const throws = vi.fn();
    qubaxPriceFeedLookup(() => { throw new Error('resolver failed'); })('api.qubax.ai', {}, throws);
    expect(throws.mock.calls[0][0].code).toBe('ENOTFOUND');
  });
  it.each(['http', 'content-type', 'redirect', 'url', 'too-large', 'missing-body', 'utf8'])('fails entire generation for %s', async reason => {
    const transport = feedFetch();
    const headers = feedHeaders();
    let response: Response;
    if (reason === 'http') response = new Response('private error must not escape', { status: 503, headers });
    else if (reason === 'missing-body') response = new Response(null, { headers });
    else if (reason === 'utf8') response = new Response(new Uint8Array([0xff]), { headers });
    else {
      if (reason === 'content-type') headers.set('content-type', 'text/html');
      if (reason === 'too-large') headers.set('content-length', String(QUBAX_PRICE_FEED_MAX_BYTES + 1));
      response = new Response(marketFixture(), { headers });
      if (reason === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
      if (reason === 'url') Object.defineProperty(response, 'url', { value: 'http://127.0.0.1/internal' });
    }
    transport.mockResolvedValueOnce(response);
    await expect(collectQubaxPrices(transport, () => NOW)).rejects.toThrow('QUBAX_PRICE_FEED_UNAVAILABLE');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('limits actual streamed bytes even without Content-Length', async () => {
    const transport = feedFetch();
    transport.mockResolvedValueOnce(new Response(' '.repeat(QUBAX_PRICE_FEED_MAX_BYTES + 1), { headers: feedHeaders() }));
    await expect(collectQubaxPrices(transport, () => NOW)).rejects.toThrow('QUBAX_PRICE_FEED_UNAVAILABLE');
  });
  it.each(['fetch', 'body', 'cancel'])('bounds stalled %s, including implementations that ignore abort', async stage => {
    vi.useFakeTimers();
    const transport = feedFetch();
    let settle = () => {}, settleRead = () => {};
    if (stage === 'fetch') transport.mockImplementationOnce(() => new Promise<Response>(resolve => { settle = () => resolve(new Response(marketFixture(), { headers: feedHeaders() })); }));
    else {
      let reads = 0;
      const reader = { read: vi.fn(() => stage === 'body' ? new Promise<any>(resolve => { settleRead = () => resolve({ done: true }); })
        : Promise.resolve(reads++ === 0 ? { done: false, value: new TextEncoder().encode(marketFixture()) } : { done: true })),
        cancel: vi.fn(() => new Promise<void>(resolve => { settle = resolve; })), releaseLock: vi.fn() };
      const response = new Response(marketFixture(), { headers: feedHeaders() });
      Object.defineProperty(response, 'body', { value: { getReader: () => reader } });
      transport.mockResolvedValueOnce(response);
    }
    const run = collectQubaxPrices(transport, () => NOW);
    const result = stage === 'cancel' ? expect(run).resolves.toMatchObject({ canDispatch: false }) : expect(run).rejects.toThrow('QUBAX_PRICE_FEED_UNAVAILABLE');
    void result.catch(() => {}); // Keep assertion failures observed while advancing the virtual clock.
    await vi.advanceTimersByTimeAsync(QUBAX_PRICE_FEED_FETCH_MS + 1);
    await result;
    const second = feedFetch();
    await expect(collectQubaxPrices(second, () => NOW)).rejects.toThrow('QUBAX_PRICE_FEED_UNAVAILABLE');
    expect(second).not.toHaveBeenCalled();
    settleRead(); settle(); await vi.advanceTimersByTimeAsync(0);
    await expect(collectQubaxPrices(second, () => NOW)).resolves.toMatchObject({ canDispatch: false });
  });
  it('rejects tampered/stale persisted observations', async () => {
    const original = await collectQubaxPrices(feedFetch(), () => NOW);
    for (const edit of [
      (s: any) => { s.canDispatch = true; }, (s: any) => { s.proofStatus = 'approved'; },
      (s: any) => { s.sources[0].url = 'https://evil.example'; }, (s: any) => { s.sources[0].rows[0].revision = 'assumed'; },
      (s: any) => { s.sources[0].rows[0].allFeesIncluded = true; }, (s: any) => { s.sources[0].rows[0].inputNanoUsd = -1; },
      (s: any) => { s.sources[0].expiresAtMs += 1; }, (s: any) => { s.sources[0].sourceUpdatedAtMs = null; },
      (s: any) => { s.sources[0].rows.push(s.sources[0].rows[0]); }, (s: any) => { s.extra = 'x'.repeat(750_001); },
    ]) {
      const snapshot = structuredClone(original); edit(snapshot); expect(validQubaxPriceSnapshot(snapshot, NOW)).toBe(false);
    }
  });
  it('has no reviewed-catalog, approval, inference transport or Builder imports', () => {
    for (const file of ['qubaxPriceFeed.ts', 'qubaxPriceFeedStore.ts', 'qubaxPriceFeedRuntime.ts']) {
      const raw = readFileSync(new URL(`../src/server/lib/${file}`, import.meta.url), 'utf8');
      expect(raw).not.toMatch(/from ['"].*(?:qubaxSelector|qubax['"]|SurplusRegistry|InferenceGateway|Builder)/);
      expect(raw).not.toMatch(/method: ['"]POST|QUBAX_API_KEY|chat\/completions/);
    }
  });
});
