import { describe, it, expect } from 'vitest';
import {
  normalizeRating,
  buildShareRecord,
  isShareValid,
  buildFeedback,
  SHARE_TTL_MS,
  MAX_HTML,
  MAX_COMMENT,
} from '../src/server/lib/ShareStore';

/** P-COLLAB.3 — pure share/feedback logic (ratings, record building, validity). */

describe('normalizeRating', () => {
  it('maps synonyms to the canonical ratings', () => {
    expect(normalizeRating('approve')).toBe('approve');
    expect(normalizeRating('Approved')).toBe('approve');
    expect(normalizeRating('accept')).toBe('approve');
    expect(normalizeRating('reject')).toBe('reject');
    expect(normalizeRating('decline')).toBe('reject');
    expect(normalizeRating('changes')).toBe('changes');
  });
  it('defaults unknown/empty to a neutral "changes"', () => {
    expect(normalizeRating('')).toBe('changes');
    expect(normalizeRating(undefined)).toBe('changes');
    expect(normalizeRating('meh')).toBe('changes');
  });
});

describe('buildShareRecord', () => {
  it('normalises + size-caps and sets an active, expiring share', () => {
    const rec = buildShareRecord({ token: 'tok', ownerId: 'o1', title: '  My App  ', html: '<h1>hi</h1>', now: 1000 });
    expect(rec.token).toBe('tok');
    expect(rec.ownerId).toBe('o1');
    expect(rec.title).toBe('My App');
    expect(rec.html).toBe('<h1>hi</h1>');
    expect(rec.status).toBe('active');
    expect(rec.createdAt).toBe(1000);
    expect(rec.expiresAt).toBe(1000 + SHARE_TTL_MS);
  });
  it('caps oversized html, defaults an empty title, honours a custom ttl', () => {
    const big = 'x'.repeat(MAX_HTML + 5000);
    const rec = buildShareRecord({ token: 't', ownerId: 'o', title: '', html: big, now: 500, ttlMs: 60000 });
    expect(rec.html.length).toBe(MAX_HTML);
    expect(rec.title).toBe('Shared app');
    expect(rec.expiresAt).toBe(60500);
  });
});

describe('isShareValid', () => {
  it('accepts an active, unexpired share', () => {
    expect(isShareValid({ status: 'active', expiresAt: 2000 }, 1000)).toBe(true);
  });
  it('rejects expired or revoked shares, and null', () => {
    expect(isShareValid({ status: 'active', expiresAt: 500 }, 1000)).toBe(false);
    expect(isShareValid({ status: 'revoked', expiresAt: 9999 }, 1000)).toBe(false);
    expect(isShareValid(null, 1000)).toBe(false);
  });
  it('treats a zero expiry as non-expiring', () => {
    expect(isShareValid({ status: 'active', expiresAt: 0 }, 9_999_999)).toBe(true);
  });
});

describe('buildFeedback', () => {
  it('normalises rating/name and caps the comment', () => {
    const fb = buildFeedback({ rating: 'approve', comment: '  looks great  ', name: '  Priya  ', now: 42 });
    expect(fb).toEqual({ rating: 'approve', comment: 'looks great', name: 'Priya', timestamp: 42 });
  });
  it('defaults an empty name to Anonymous and caps a huge comment', () => {
    const fb = buildFeedback({ rating: 'x', comment: 'y'.repeat(MAX_COMMENT + 100), name: '', now: 0 });
    expect(fb.rating).toBe('changes');
    expect(fb.name).toBe('Anonymous');
    expect(fb.comment.length).toBe(MAX_COMMENT);
  });
});
