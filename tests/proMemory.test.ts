/**
 * Tests for ProMemoryStore — Firestore-backed cross-session Pro memory.
 * Under VITEST the store returns null / no-ops so these tests verify the
 * graceful-degradation contract without touching Firestore.
 */
import { describe, it, expect } from 'vitest';
import { proMemoryStore } from '../src/server/pro/ProMemory';

describe('proMemoryStore (VITEST-skip / no-op mode)', () => {
  it('load() returns null when sessionId is empty', async () => {
    const result = await proMemoryStore.load('');
    expect(result).toBeNull();
  });

  it('load() returns null in test environment (Firestore skipped)', async () => {
    const result = await proMemoryStore.load('session-123');
    expect(result).toBeNull();
  });

  it('save() resolves without throwing', async () => {
    await expect(proMemoryStore.save('session-abc', { memorySummary: 'test' })).resolves.not.toThrow();
  });

  it('save() with empty sessionId resolves without throwing', async () => {
    await expect(proMemoryStore.save('', { memorySummary: 'ignored' })).resolves.not.toThrow();
  });

  it('logDecision() resolves without throwing', async () => {
    await expect(
      proMemoryStore.logDecision('session-xyz', 'Using React for frontend')
    ).resolves.not.toThrow();
  });

  it('logDecision() with empty sessionId resolves without throwing', async () => {
    await expect(proMemoryStore.logDecision('', 'some decision')).resolves.not.toThrow();
  });

  it('savePreference() resolves without throwing', async () => {
    await expect(
      proMemoryStore.savePreference('session-abc', 'framework', 'React')
    ).resolves.not.toThrow();
  });

  it('logErrorPattern() resolves without throwing', async () => {
    await expect(
      proMemoryStore.logErrorPattern('session-abc', 'TypeError: cannot read', 'Add null check')
    ).resolves.not.toThrow();
  });
});
