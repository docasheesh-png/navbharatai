import { describe, it, expect } from 'vitest';
import {
  buildShareRecord,
  buildFeedback,
  isShareValid,
  normalizeRating,
  shouldOffloadToStorage,
  effectiveMaxHtml,
  INLINE_HTML_LIMIT,
  MAX_HTML,
  MAX_TITLE,
} from './ShareStore';

describe('ShareStore — pure logic', () => {
  describe('shouldOffloadToStorage — inline vs Cloud Storage split', () => {
    it('keeps a small snapshot inline even when a bucket exists', () => {
      expect(shouldOffloadToStorage(INLINE_HTML_LIMIT - 1, true)).toBe(false);
      expect(shouldOffloadToStorage(INLINE_HTML_LIMIT, true)).toBe(false);
    });

    it('offloads a large snapshot to Storage once a bucket exists', () => {
      expect(shouldOffloadToStorage(INLINE_HTML_LIMIT + 1, true)).toBe(true);
      expect(shouldOffloadToStorage(MAX_HTML, true)).toBe(true);
    });

    it('never offloads when no bucket is configured (route rejects oversize first)', () => {
      expect(shouldOffloadToStorage(INLINE_HTML_LIMIT + 1, false)).toBe(false);
      expect(shouldOffloadToStorage(MAX_HTML, false)).toBe(false);
    });
  });

  describe('effectiveMaxHtml — the honest ceiling the route enforces', () => {
    it('is the inline limit with no bucket, the full cap with one', () => {
      expect(effectiveMaxHtml(false)).toBe(INLINE_HTML_LIMIT);
      expect(effectiveMaxHtml(true)).toBe(MAX_HTML);
    });

    it('lifts the ceiling well above the old ~600 KB Firestore-field limit', () => {
      // The whole point of the storage path: image-rich apps that used to be rejected can now share.
      expect(MAX_HTML).toBeGreaterThan(INLINE_HTML_LIMIT);
      expect(effectiveMaxHtml(true)).toBeGreaterThanOrEqual(2_000_000);
    });
  });

  describe('buildShareRecord', () => {
    it('caps html at the overall MAX_HTML safety valve (never above)', () => {
      const huge = 'x'.repeat(MAX_HTML + 5000);
      const rec = buildShareRecord({ token: 't', ownerId: 'u', html: huge, now: 1000 });
      expect(rec.html.length).toBe(MAX_HTML);
    });

    it('keeps a mid-band snapshot (700 KB) intact — the band the old 600 KB cap wrongly blocked', () => {
      const midband = 'y'.repeat(700_000);
      const rec = buildShareRecord({ token: 't', ownerId: 'u', html: midband, now: 1000 });
      expect(rec.html.length).toBe(700_000);
    });

    it('defaults an empty title and caps a long one', () => {
      expect(buildShareRecord({ token: 't', ownerId: 'u', html: 'a', now: 1 }).title).toBe('Shared app');
      const long = buildShareRecord({ token: 't', ownerId: 'u', title: 'z'.repeat(500), html: 'a', now: 1 });
      expect(long.title.length).toBe(MAX_TITLE);
    });

    it('sets an active status and a future expiry', () => {
      const rec = buildShareRecord({ token: 't', ownerId: 'u', html: 'a', now: 1000, ttlMs: 5000 });
      expect(rec.status).toBe('active');
      expect(rec.expiresAt).toBe(6000);
    });
  });

  describe('isShareValid', () => {
    it('rejects missing / revoked / expired, accepts an active unexpired share', () => {
      expect(isShareValid(null, 1000)).toBe(false);
      expect(isShareValid({ status: 'revoked', expiresAt: 9999 }, 1000)).toBe(false);
      expect(isShareValid({ status: 'active', expiresAt: 500 }, 1000)).toBe(false);
      expect(isShareValid({ status: 'active', expiresAt: 9999 }, 1000)).toBe(true);
    });
  });

  describe('normalizeRating + buildFeedback', () => {
    it('normalizes rating synonyms and defaults unknown to changes', () => {
      expect(normalizeRating('approved')).toBe('approve');
      expect(normalizeRating('decline')).toBe('reject');
      expect(normalizeRating('???')).toBe('changes');
    });

    it('caps comment/name and defaults an empty name', () => {
      const fb = buildFeedback({ rating: 'approve', comment: 'c'.repeat(5000), name: '', now: 42 });
      expect(fb.comment.length).toBe(2000);
      expect(fb.name).toBe('Anonymous');
      expect(fb.timestamp).toBe(42);
    });
  });
});
