import { describe, it, expect } from 'vitest';
import { runThroughput, parseThroughputInput, gradeAnswer, shouldRetryThroughput, THROUGHPUT_MIN_OUTPUT_TOKENS } from './providerThroughput';
import { throughputCorpus as providerLoadCorpus } from './providerThroughput';

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
    expect(parseThroughputInput({ requests: 1000, concurrency: 200 })).toMatchObject({ requests: 1000, concurrency: 200, retries: 2 });
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
describe('providerThroughput empty-response DNA (prod 05004)', () => {
  it('defaults to provider output budget and clamps tiny caps that starve reasoning models', () => {
    expect(parseThroughputInput({ requests: 100, concurrency: 50 })!.maxOutputTokens).toBeUndefined();
    expect(parseThroughputInput({ requests: 100, maxOutputTokens: 64 })!.maxOutputTokens).toBe(THROUGHPUT_MIN_OUTPUT_TOKENS);
    expect(parseThroughputInput({ requests: 100, maxOutputTokens: 2048 })!.maxOutputTokens).toBe(2048);
    expect(parseThroughputInput({ requests: 100, maxOutputTokens: 0 })).toBeNull();
  });
  it('grades real answers with think blocks, fences, prose lines and bare strings', () => {
    expect(gradeAnswer('<think>hmm</think>\n42', 42)).toBe(true);
    expect(gradeAnswer('```json\n[1,2]\n```', [1, 2])).toBe(true);
    expect(gradeAnswer('Sure.\n"A"', 'A')).toBe(true);
    expect(gradeAnswer('A', 'A')).toBe(true);
    expect(gradeAnswer('43', 42)).toBe(false);
  });
  it('retries blank/transient failures but never auth/config', () => {
    expect(shouldRetryThroughput('empty_response:200')).toBe(true);
    expect(shouldRetryThroughput('EMPTY_RESPONSE')).toBe(true);
    expect(shouldRetryThroughput('rate_limit:429')).toBe(true);
    expect(shouldRetryThroughput('authentication:401')).toBe(false);
    expect(shouldRetryThroughput('CONFIGURATION')).toBe(false);
  });
  it('recovers a blank 200 on retry and counts unique prompts under concurrency', async () => {
    const corpus = providerLoadCorpus(200), seen = new Set<string>(), blanked = new Set<number>();
    const r = await runThroughput('surplus', { model: 'm', call: async (p) => {
      const i = Number(/-(\d+)\]/.exec(p)![1]); seen.add(p);
      if (i % 3 === 0 && !blanked.has(i)) { blanked.add(i); throw Object.assign(new Error('x'), { code: 'empty_response', httpStatus: 200 }); }
      return { text: JSON.stringify(corpus[i].expected), amount: 0, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: null } };
    } }, { requests: 200, concurrency: 100, retries: 1 });
    expect(seen.size).toBe(200); expect(r.ok).toBe(200); expect(r.pass).toBe(200); expect(r.errors['empty_response:200']).toBe(blanked.size);
  }, 30_000);
  it('does not retry auth failures', async () => {
    let calls = 0;
    const r = await runThroughput('surplus', { model: 'm', call: async () => { calls++; throw Object.assign(new Error('x'), { code: 'authentication', httpStatus: 401 }); } },
      { requests: 2, concurrency: 2, retries: 3 });
    expect(calls).toBe(2); expect(r.retried).toBe(0); expect(r.fail).toBe(2);
  });
});
describe('providerThroughput DNA (prod 05006)', () => {
  it('counts genuine short answers in human shape, still rejects wrong ones', () => {
    expect(gradeAnswer('Answer: 42', 42)).toBe(true);
    expect(gradeAnswer('{"result": 42}', 42)).toBe(true);
    expect(gradeAnswer('**42**', 42)).toBe(true);
    expect(gradeAnswer('"42"', 42)).toBe(true);
    expect(gradeAnswer('The sorted list is [-5, 1, 3].', [-5, 1, 3])).toBe(true);
    expect(gradeAnswer('{"answer":"A"}', 'A')).toBe(true);
    expect(gradeAnswer('A.', 'A')).toBe(true);
    expect(gradeAnswer('Answer: 41', 42)).toBe(false);
    expect(gradeAnswer('[3, 1, -5]', [-5, 1, 3])).toBe(false);
    expect(gradeAnswer('B', 'A')).toBe(false);
  });
  it('retries 404/5xx provider blips but never 401/403', () => {
    expect(shouldRetryThroughput('provider:404')).toBe(true);
    expect(shouldRetryThroughput('provider:503')).toBe(true);
    expect(shouldRetryThroughput('provider:401')).toBe(false);
    expect(shouldRetryThroughput('provider:403')).toBe(false);
  });
  it('backs off concurrency on 429 and still completes every request', async () => {
    let inFlight = 0, peak = 0; const corpus = providerLoadCorpus(120);
    const r = await runThroughput('cheaperinference', { model: 'm', call: async (p) => {
      inFlight++; peak = Math.max(peak, inFlight);
      try {
        await new Promise(res => setTimeout(res, 5));
        if (inFlight > 20) throw Object.assign(new Error('x'), { code: 'RATE_LIMIT', retryAfterMs: 50 });
        const i = Number(/-(\d+)\]/.exec(p)![1]);
        return { text: JSON.stringify(corpus[i].expected), amount: 0, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: null } };
      } finally { inFlight--; }
    } }, { requests: 120, concurrency: 100, retries: 1 });
    expect(r.ok).toBe(120); expect(r.pass).toBe(120); expect(r.minConcurrency).toBeLessThan(100);
    expect(r.mismatchSamples).toEqual([]);
  }, 30_000);
});
describe('providerThroughput exam corpus v2 (prod 05007)', () => {
  it('is single-step, unique per ordinal, and self-consistent with the grader', () => {
    const c = providerLoadCorpus(1000);
    expect(new Set(c.map(q => q.id)).size).toBe(1000);
    for (const q of c) {
      expect(gradeAnswer(JSON.stringify(q.expected), q.expected)).toBe(true);
      expect(gradeAnswer(String(Array.isArray(q.expected) ? JSON.stringify(q.expected) : q.expected), q.expected)).toBe(true);
    }
    expect(gradeAnswer('The answer is 42.', 42)).toBe(true);
    expect(gradeAnswer('APPLE', 'APPLE')).toBe(true);
    expect(gradeAnswer('apple', 'APPLE')).toBe(false);
  });
});
