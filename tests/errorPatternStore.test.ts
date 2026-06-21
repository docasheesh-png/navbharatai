import { describe, it, expect } from 'vitest';
import { errorPatternStore } from '../src/server/project/ErrorPatternStore';

describe('ErrorPatternStore (VITEST-skip mode)', () => {
  it('saveHints() does not throw in test environment', async () => {
    await expect(errorPatternStore.saveHints('session-1', ['hint1', 'hint2'])).resolves.not.toThrow();
  });

  it('saveHints() with empty array does not throw', async () => {
    await expect(errorPatternStore.saveHints('session-2', [])).resolves.not.toThrow();
  });

  it('getHints() returns empty array in test environment (no Firestore)', async () => {
    const hints = await errorPatternStore.getHints('session-1');
    expect(Array.isArray(hints)).toBe(true);
    expect(hints).toHaveLength(0);
  });

  it('clearHints() does not throw in test environment', async () => {
    await expect(errorPatternStore.clearHints('session-1')).resolves.not.toThrow();
  });
});
