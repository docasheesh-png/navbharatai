import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isValidWebhookUrl, normalizeEvents, WEBHOOK_EVENTS,
  listWebhooks, addWebhook, removeWebhook, fireWebhooks,
} from '../src/server/WebhookManager';

/**
 * P-PME.9 — webhook manager. Pure validation is fully tested; the Firestore CRUD is VITEST-skipped
 * (no DB) and asserted to degrade gracefully without throwing.
 */
afterEach(() => vi.restoreAllMocks());

describe('WebhookManager — isValidWebhookUrl', () => {
  it('accepts http/https URLs only', () => {
    expect(isValidWebhookUrl('https://hooks.slack.com/x')).toBe(true);
    expect(isValidWebhookUrl('http://localhost:3000/hook')).toBe(true);
    expect(isValidWebhookUrl('ftp://x')).toBe(false);
    expect(isValidWebhookUrl('not a url')).toBe(false);
    expect(isValidWebhookUrl('')).toBe(false);
    expect(isValidWebhookUrl(42)).toBe(false);
    expect(isValidWebhookUrl(null)).toBe(false);
  });
});

describe('WebhookManager — normalizeEvents', () => {
  it('keeps only known events', () => {
    expect(normalizeEvents(['BUILD_COMPLETE', 'NONSENSE'])).toEqual(['BUILD_COMPLETE']);
  });
  it('dedupes', () => {
    expect(normalizeEvents(['BUILD_FAILED', 'BUILD_FAILED'])).toEqual(['BUILD_FAILED']);
  });
  it('defaults to ALL events when none valid / not an array', () => {
    expect(normalizeEvents([])).toEqual([...WEBHOOK_EVENTS]);
    expect(normalizeEvents(['junk'])).toEqual([...WEBHOOK_EVENTS]);
    expect(normalizeEvents(undefined)).toEqual([...WEBHOOK_EVENTS]);
  });
});

describe('WebhookManager — CRUD/fire degrade gracefully without a DB (VITEST)', () => {
  it('listWebhooks returns [] ', async () => {
    expect(await listWebhooks('u1')).toEqual([]);
  });
  it('addWebhook rejects an invalid URL before touching the DB', async () => {
    const r = await addWebhook('u1', 'not-a-url', [], '2026-01-01T00:00:00Z');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/valid http/i);
  });
  it('addWebhook reports DB unavailable for a valid URL under VITEST', async () => {
    const r = await addWebhook('u1', 'https://hook.test/x', ['BUILD_COMPLETE'], '2026-01-01T00:00:00Z');
    expect(r.ok).toBe(false); // no DB in tests
    expect(r.error).toMatch(/database/i);
  });
  it('removeWebhook returns false with no DB', async () => {
    expect(await removeWebhook('u1', 'abc')).toBe(false);
  });
  it('fireWebhooks is a no-op (0 attempted) with no registered hooks', async () => {
    expect(await fireWebhooks('u1', 'BUILD_COMPLETE', { a: 1 })).toEqual({ attempted: 0, succeeded: 0 });
  });
});
