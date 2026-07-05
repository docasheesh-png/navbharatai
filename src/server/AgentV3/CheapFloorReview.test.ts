import { describe, it, expect } from 'vitest';
import { nextReviewAction, selectReviewer, cheapBounceCap, MAX_CHEAP_BOUNCES } from './CheapFloorReview';

describe('nextReviewAction', () => {
  it('a passing review is accepted immediately (no spend)', () => {
    expect(nextReviewAction(true, 0)).toBe('accept');
    expect(nextReviewAction(true, 5)).toBe('accept');
  });

  // THE admin rule: GLM/KIMI gets EXACTLY ONE self-repair bounce, then it must go to Sonnet — never
  // bounce to the weak model again (that was the 51-fallback grind).
  it('first failure → GLM/KIMI self-repairs once', () => {
    expect(nextReviewAction(false, 0)).toBe('cheap_repair');
  });

  it('still failing AFTER the one bounce → Sonnet repairs (never bounce to GLM/KIMI again)', () => {
    expect(nextReviewAction(false, 1)).toBe('sonnet_repair');
    expect(nextReviewAction(false, 2)).toBe('sonnet_repair');
  });

  it('the default cap is exactly 1 bounce', () => {
    expect(MAX_CHEAP_BOUNCES).toBe(1);
    // Simulate the loop: fail → cheap_repair (0 used) → fail → sonnet_repair (1 used).
    let used = 0;
    expect(nextReviewAction(false, used)).toBe('cheap_repair'); used++;
    expect(nextReviewAction(false, used)).toBe('sonnet_repair');
  });

  it('honours a custom cap', () => {
    expect(nextReviewAction(false, 1, 2)).toBe('cheap_repair'); // 2nd bounce allowed when cap=2
    expect(nextReviewAction(false, 2, 2)).toBe('sonnet_repair');
    expect(nextReviewAction(false, 0, 0)).toBe('sonnet_repair'); // cap 0 → straight to Sonnet
  });
});

describe('selectReviewer', () => {
  it('picks Grok when a Grok key is present (the admin default)', () => {
    expect(selectReviewer({ grokKey: 'xai-abc' })).toBe('grok');
  });

  it('falls back to Sonnet when AGENTV3_REVIEWER=sonnet (explicit override)', () => {
    expect(selectReviewer({ reviewer: 'sonnet', grokKey: 'xai-abc' })).toBe('sonnet');
    expect(selectReviewer({ reviewer: 'SONNET', grokKey: 'xai-abc' })).toBe('sonnet');
  });

  it('falls back to Sonnet when there is NO Grok key (unconfigured env = today’s behaviour)', () => {
    expect(selectReviewer({})).toBe('sonnet');
    expect(selectReviewer({ grokKey: '   ' })).toBe('sonnet');
    expect(selectReviewer({ grokKey: '' })).toBe('sonnet');
  });
});

describe('cheapBounceCap', () => {
  it('defaults to MAX_CHEAP_BOUNCES on absent/invalid values', () => {
    expect(cheapBounceCap(undefined)).toBe(MAX_CHEAP_BOUNCES);
    expect(cheapBounceCap('')).toBe(MAX_CHEAP_BOUNCES);
    expect(cheapBounceCap('abc')).toBe(MAX_CHEAP_BOUNCES);
    expect(cheapBounceCap('99')).toBe(MAX_CHEAP_BOUNCES); // out of [0,3] range → default
    expect(cheapBounceCap('-1')).toBe(MAX_CHEAP_BOUNCES);
  });

  it('accepts an explicit in-range override', () => {
    expect(cheapBounceCap('0')).toBe(0);
    expect(cheapBounceCap('2')).toBe(2);
    expect(cheapBounceCap('3')).toBe(3);
  });
});
