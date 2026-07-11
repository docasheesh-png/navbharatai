import { describe, it, expect } from 'vitest';
import {
  updateIsAvailable,
  parseReviewState,
  emptyReviewState,
  registerAppOpen,
  shouldRequestReview,
  REVIEW_MIN_OPENS,
  REVIEW_MIN_AGE_MS,
  REVIEW_REPROMPT_MS,
  type ReviewPromptState,
} from '../src/lib/mobileEngagement';

describe('updateIsAvailable — Play In-App Update availability', () => {
  it('is true ONLY for UPDATE_AVAILABLE (2)', () => {
    expect(updateIsAvailable(2)).toBe(true);
  });
  it('is false for UNKNOWN(0), NOT_AVAILABLE(1), IN_PROGRESS(3)', () => {
    expect(updateIsAvailable(0)).toBe(false);
    expect(updateIsAvailable(1)).toBe(false);
    expect(updateIsAvailable(3)).toBe(false);
  });
  it('is false for null/undefined (web / no info)', () => {
    expect(updateIsAvailable(null)).toBe(false);
    expect(updateIsAvailable(undefined)).toBe(false);
  });
});

describe('parseReviewState — defensive load from localStorage', () => {
  it('returns the empty state for null/empty/garbage (never throws)', () => {
    expect(parseReviewState(null)).toEqual(emptyReviewState());
    expect(parseReviewState('')).toEqual(emptyReviewState());
    expect(parseReviewState('not json{')).toEqual(emptyReviewState());
    expect(parseReviewState('42')).toEqual(emptyReviewState()); // valid JSON, wrong shape
  });
  it('round-trips a valid state', () => {
    const s: ReviewPromptState = { openCount: 5, firstOpenAtMs: 1000, lastPromptedAtMs: 2000 };
    expect(parseReviewState(JSON.stringify(s))).toEqual(s);
  });
  it('sanitizes negative / non-finite fields to safe defaults', () => {
    expect(parseReviewState('{"openCount":-3,"firstOpenAtMs":0,"lastPromptedAtMs":"x"}')).toEqual(emptyReviewState());
  });
});

describe('registerAppOpen — one app open', () => {
  it('increments the counter and stamps first-open once', () => {
    const s0 = emptyReviewState();
    const s1 = registerAppOpen(s0, 1000);
    expect(s1).toEqual({ openCount: 1, firstOpenAtMs: 1000, lastPromptedAtMs: null });
    const s2 = registerAppOpen(s1, 5000);
    expect(s2.openCount).toBe(2);
    expect(s2.firstOpenAtMs).toBe(1000); // preserved, not overwritten
  });
  it('preserves an existing lastPromptedAtMs', () => {
    const s = registerAppOpen({ openCount: 4, firstOpenAtMs: 10, lastPromptedAtMs: 99 }, 200);
    expect(s.lastPromptedAtMs).toBe(99);
  });
});

describe('shouldRequestReview — when to show the native rating card', () => {
  const OLD = 0;                         // first-open long ago
  const NOW = OLD + REVIEW_MIN_AGE_MS + 1000;

  it('true once opens ≥ threshold, aged past the minimum, never prompted', () => {
    const s: ReviewPromptState = { openCount: REVIEW_MIN_OPENS, firstOpenAtMs: OLD, lastPromptedAtMs: null };
    expect(shouldRequestReview(s, NOW)).toBe(true);
  });
  it('false before enough opens', () => {
    const s: ReviewPromptState = { openCount: REVIEW_MIN_OPENS - 1, firstOpenAtMs: OLD, lastPromptedAtMs: null };
    expect(shouldRequestReview(s, NOW)).toBe(false);
  });
  it('false before the app is old enough (no first-run nag)', () => {
    const s: ReviewPromptState = { openCount: 10, firstOpenAtMs: NOW - 1000, lastPromptedAtMs: null };
    expect(shouldRequestReview(s, NOW)).toBe(false);
  });
  it('false with a null firstOpenAtMs', () => {
    const s: ReviewPromptState = { openCount: 10, firstOpenAtMs: null, lastPromptedAtMs: null };
    expect(shouldRequestReview(s, NOW)).toBe(false);
  });
  it('false within the reprompt window, true again once it passes', () => {
    const base: ReviewPromptState = { openCount: 10, firstOpenAtMs: OLD, lastPromptedAtMs: NOW - 1000 };
    expect(shouldRequestReview(base, NOW)).toBe(false);
    const later = NOW + REVIEW_REPROMPT_MS + 1;
    expect(shouldRequestReview({ ...base }, later)).toBe(true);
  });
});
