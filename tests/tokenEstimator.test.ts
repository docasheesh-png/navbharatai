import { describe, it, expect } from 'vitest';
import {
  modelContextLimit,
  estimateTokens,
  estimateMessagesTokens,
  contextUsage,
} from '../src/server/AgentV3/TokenEstimator';

/** P-PE.4 — pre-call token estimator (pure). */

describe('TokenEstimator — modelContextLimit', () => {
  it('maps known model families', () => {
    expect(modelContextLimit('claude-opus-4')).toBe(200_000);
    expect(modelContextLimit('gpt-4o')).toBe(128_000);
    expect(modelContextLimit('grok-2')).toBe(131_072);
    expect(modelContextLimit('mystery-model')).toBe(200_000); // default
  });
});

describe('TokenEstimator — estimateTokens', () => {
  it('is 0 for empty and grows with length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
    expect(estimateTokens('a'.repeat(400))).toBeGreaterThan(estimateTokens('a'.repeat(40)));
  });
  it('is in a sane ballpark (~chars/4)', () => {
    const t = estimateTokens('x'.repeat(4000)); // ~1000 tokens by chars
    expect(t).toBeGreaterThan(500);
    expect(t).toBeLessThan(2000);
  });
});

describe('TokenEstimator — estimateMessagesTokens', () => {
  it('sums string + structured content with overhead', () => {
    const msgs = [
      { role: 'user', content: 'hello there' },
      { role: 'assistant', content: [{ text: 'hi back' }, 'extra'] },
    ];
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(0);
  });
  it('tolerates non-array input', () => {
    expect(estimateMessagesTokens(null)).toBe(0);
  });
});

describe('TokenEstimator — contextUsage', () => {
  it('flags nearLimit + overLimit against the model window', () => {
    const small = contextUsage(1000, 'claude-opus-4');
    expect(small.nearLimit).toBe(false);
    expect(small.ratio).toBeLessThan(0.1);

    const near = contextUsage(170_000, 'claude-opus-4'); // 85% of 200k
    expect(near.nearLimit).toBe(true);
    expect(near.overLimit).toBe(false);

    const over = contextUsage(210_000, 'claude-opus-4');
    expect(over.overLimit).toBe(true);
  });
  it('respects a custom warn ratio', () => {
    expect(contextUsage(100_000, 'claude-opus-4', 0.4).nearLimit).toBe(true); // 50% ≥ 40%
  });
});
