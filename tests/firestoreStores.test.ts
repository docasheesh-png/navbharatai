/**
 * Tests for Firestore-backed stores (logStore, metricsStore, ProBuildSession).
 * Under VITEST all stores skip Firestore and return null / empty / no-op.
 * These tests verify the graceful-degradation contract for every public method.
 */
import { describe, it, expect } from 'vitest';
import { logStore } from '../src/server/lib/logStore';
import { metricsStore } from '../src/server/lib/metricsStore';
import { proBuildSessionStore } from '../src/server/pro/ProBuildSession';

// ── logStore ─────────────────────────────────────────────────────────────────

describe('logStore (VITEST-skip / no-op mode)', () => {
  it('append() does not throw', () => {
    expect(() =>
      logStore.append({ level: 'info', event: 'test_event', message: 'hello' })
    ).not.toThrow();
  });

  it('append() with all optional fields does not throw', () => {
    expect(() =>
      logStore.append({
        level: 'error',
        event: 'build_failed',
        traceId: 'trace-1',
        workspaceId: 'ws-1',
        message: 'Build failed',
        meta: { reason: 'syntax error' },
      })
    ).not.toThrow();
  });

  it('query() returns empty array in test environment', async () => {
    const result = await logStore.query({ level: 'error' });
    expect(result).toEqual([]);
  });

  it('query() with no filters returns empty array', async () => {
    const result = await logStore.query();
    expect(result).toEqual([]);
  });
});

// ── metricsStore ──────────────────────────────────────────────────────────────

describe('metricsStore (VITEST-skip / no-op mode)', () => {
  it('save() resolves without throwing', async () => {
    await expect(metricsStore.save()).resolves.not.toThrow();
  });

  it('list() returns empty array in test environment', async () => {
    const result = await metricsStore.list();
    expect(result).toEqual([]);
  });

  it('list(7) returns empty array in test environment', async () => {
    const result = await metricsStore.list(7);
    expect(result).toEqual([]);
  });
});

// ── proBuildSessionStore ──────────────────────────────────────────────────────

describe('proBuildSessionStore (VITEST-skip / no-op mode)', () => {
  it('save() resolves without throwing', async () => {
    await expect(
      proBuildSessionStore.save('session-1', {
        ok: true,
        files: { 'index.ts': 'export {}' },
        fileCount: 1,
        savedAt: Date.now(),
      })
    ).resolves.not.toThrow();
  });

  it('save() with empty sessionId resolves without throwing', async () => {
    await expect(
      proBuildSessionStore.save('', { ok: false, files: {}, fileCount: 0, savedAt: 0 })
    ).resolves.not.toThrow();
  });

  it('load() returns null in test environment', async () => {
    const result = await proBuildSessionStore.load('session-1');
    expect(result).toBeNull();
  });

  it('load() with empty sessionId returns null', async () => {
    const result = await proBuildSessionStore.load('');
    expect(result).toBeNull();
  });
});
