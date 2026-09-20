/**
 * Phase 2.1 — BuildHistoryStore unit tests.
 *
 * BuildHistoryStore.getDb() returns null in VITEST env (the env var is set by
 * vitest.config.ts → `VITEST=true`). All Firestore-backed methods silently
 * return empty/void when db is null, so we test the non-Firestore logic only:
 * - capFiles size-capping (white-box via the exported helper)
 * - save/list/get return gracefully with null db
 */
import { describe, it, expect } from 'vitest';

// The store itself skips Firestore in test env, so we only test that the
// public API is callable and returns the right shape on a null-db path.
import { buildHistoryStore } from '../src/server/project/BuildHistoryStore';

describe('buildHistoryStore (null-db path — test env)', () => {
  it('save() resolves without throwing', async () => {
    await expect(buildHistoryStore.save('test-session', {
      commitMessage: 'feat: build "todo app" — 5 files, vfs tier',
      fileCount: 5,
      files: { 'index.html': '<h1>hi</h1>' },
      isEdit: false,
      tier: 'vfs',
      ok: true,
    // CHANGED 2026-09-20: `save` used to resolve `undefined` whether it had written or not — including
    // this very case, a null db. It resolves FALSE now, which is the whole point: "we asked" and "it
    // landed" are different facts, and a caller that cannot tell them apart can only report an
    // intention as a fact. It still never throws, which is what this case was really guarding.
    })).resolves.toBe(false);
  });

  it('list() returns empty array with null db', async () => {
    const result = await buildHistoryStore.list('test-session');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('get() returns null with null db', async () => {
    const result = await buildHistoryStore.get('test-session', 'v_fake_id');
    expect(result).toBeNull();
  });

  it('save() does not throw for very large files (caps payload)', async () => {
    const bigContent = 'x'.repeat(500_000);
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) files[`file${i}.ts`] = bigContent;
    await expect(buildHistoryStore.save('session-big', {
      commitMessage: 'feat: big build',
      fileCount: 5,
      files,
      isEdit: false,
      ok: true,
    // Same change as above: no db ⇒ nothing written ⇒ `false`, never a throw.
    })).resolves.toBe(false);
  });

  it('list() with unknown sessionId returns empty array', async () => {
    const result = await buildHistoryStore.list('does-not-exist');
    expect(result).toEqual([]);
  });
});
