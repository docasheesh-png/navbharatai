import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSucceeded, compareBench, selectBenchPrompts, validateBenchFixture, wilson, type BenchResultFile, type BenchRun } from './benchHarness';
import type { BuildMetrics } from '../BakeoffMetrics';

const fixture = validateBenchFixture(JSON.parse(readFileSync(join(__dirname, '../../../../scripts/fixtures/reliability-bench-prompts.json'), 'utf8')));

describe('reliability bench fixture', () => {
  it('has 50 prompts and a 15-prompt smoke set, in all three languages and complexities', () => {
    expect(fixture.prompts).toHaveLength(50);
    const smoke = selectBenchPrompts(fixture, 'smoke');
    expect(smoke).toHaveLength(15);
    for (const set of [fixture.prompts, smoke]) {
      expect(new Set(set.map((p) => p.lang))).toEqual(new Set(['hindi', 'hinglish', 'english']));
      expect(new Set(set.map((p) => p.complexity))).toEqual(new Set(['simple', 'medium', 'complex']));
    }
    expect(selectBenchPrompts(fixture, 'full', ['snake-hinglish']).map((p) => p.id)).toEqual(['snake-hinglish']);
  });

  it('rejects a broken fixture', () => {
    expect(() => validateBenchFixture({ prompts: [{ id: 'a', lang: 'x', complexity: 'simple', smoke: true, prompt: 'build a thing please' }] })).toThrow(/bad lang/);
  });
});

const M = (over: Partial<BuildMetrics> = {}): BuildMetrics => ({ filesCreated: 5, ok: true, readinessScore: 80, billedUsd: 0, toolCalls: 10, toolErrors: 0, providerFallbacks: 0, geminiTrap: false, errored: false, ...over });

describe('success + comparison', () => {
  it('success is strict', () => {
    expect(buildSucceeded(M())).toBe(true);
    expect(buildSucceeded(M({ filesCreated: 0 }))).toBe(false);
    expect(buildSucceeded(M({ geminiTrap: true }))).toBe(false);
    expect(buildSucceeded(M({ readinessScore: 40 }))).toBe(false);
    expect(buildSucceeded(M({ readinessScore: null }))).toBe(true);
  });

  it('Wilson interval is honest about small n', () => {
    const w = wilson(10, 15);
    expect(w.low).toBeGreaterThan(0.38);
    expect(w.high).toBeLessThan(0.89);
  });

  it('compares, lists fixed/broke, and refuses to call an overlap a win', () => {
    const run = (id: string, success: boolean): BenchRun => ({ id, lang: 'hinglish', complexity: 'simple', attempt: 1, seconds: 1, metrics: M({ ok: success }), success });
    const file = (label: string, runs: BenchRun[]): BenchResultFile => ({ label, set: 'smoke', baseUrl: '', startedAt: '', flags: [], runs });
    const base = file('base', [run('a', false), run('b', true), run('c', true)]);
    const cand = file('cand', [run('a', true), run('b', false), run('c', true)]);
    const cmp = compareBench(base, cand);
    expect(cmp.fixed).toEqual(['a']);
    expect(cmp.broke).toEqual(['b']);
    expect(cmp.verdict).toMatch(/Not distinguishable/);
  });
});
