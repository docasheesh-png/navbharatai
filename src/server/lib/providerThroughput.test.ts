import { describe, it, expect } from 'vitest';
import { runThroughput, parseThroughputInput } from './providerThroughput';
import { providerLoadCorpus } from './providerLoadCorpus';

describe('providerThroughput', () => {
  it('sends unique prompts, retries failures, computes rpm', async () => {
    const corpus = providerLoadCorpus(50), seen = new Set<string>(); let n = 0;
    const r = await runThroughput('surplus', { model: 'm', call: async (p) => {
      if (n++ === 3) throw Object.assign(new Error('x'), { code: 'rate_limit' });
      seen.add(p); const i = Number(/-(\d+)\]/.exec(p)![1]);
      return { text: JSON.stringify(corpus[i].expected), amount: 0.0001, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: null } };
    } }, { requests: 50, concurrency: 10, retries: 1, maxOutputTokens: 16 });
    expect(seen.size).toBe(50); expect(r.ok).toBe(50); expect(r.pass).toBe(50); expect(r.retried).toBe(1); expect(r.errors.rate_limit).toBe(1);
    expect(r.rpm).toBeGreaterThan(0);
  });
  it('validates input', () => {
    expect(parseThroughputInput({ requests: 1000, concurrency: 200 })).toMatchObject({ requests: 1000, concurrency: 200, retries: 1 });
    expect(parseThroughputInput({ requests: 0 })).toBeNull();
  });
});
describe('providerThroughput progress', () => {
  it('reports progress once per finished request including terminal failures', async () => {
    const seen: number[] = [];
    await runThroughput('cheaperinference', { model: 'm', call: async () => { throw Object.assign(new Error('x'), { code: 'TIMEOUT' }); } },
      { requests: 3, concurrency: 3, retries: 0, maxOutputTokens: 8 }, undefined, p => seen.push(p.done));
    expect(seen.sort()).toEqual([1, 2, 3]);
  });
});
