import { describe, it, expect, beforeEach, vi } from 'vitest';
import { safeLocalJson } from '../src/lib/safeLocalJson';

// Minimal in-memory localStorage for the test environment.
function installStore(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
}

describe('safeLocalJson', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('parses a valid stored value', () => {
    installStore({ k: '{"a":1,"b":[2,3]}' });
    expect(safeLocalJson('k', { a: 0, b: [] as number[] })).toEqual({ a: 1, b: [2, 3] });
  });

  it('returns the fallback for a missing key', () => {
    installStore({});
    expect(safeLocalJson('missing', ['default'])).toEqual(['default']);
  });

  it('REGRESSION: returns the fallback for a CORRUPT value instead of throwing (no crash loop)', () => {
    // A truncated / non-JSON value that a raw JSON.parse would throw on during render.
    installStore({ k: '{"a":1,' });
    expect(() => safeLocalJson('k', { a: 0 })).not.toThrow();
    expect(safeLocalJson('k', { a: 0 })).toEqual({ a: 0 });
    installStore({ k: 'not json at all' });
    expect(safeLocalJson('k', null)).toBeNull();
  });

  it('treats an empty string as absent', () => {
    installStore({ k: '' });
    expect(safeLocalJson('k', 42)).toBe(42);
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(safeLocalJson('k', 'fallback')).toBe('fallback');
  });
});
