import { describe, it, expect } from 'vitest';
import { isChunkLoadError, shouldReloadForStaleChunk } from '../src/lib/chunkReload';

describe('isChunkLoadError', () => {
  it('detects the real production messages', () => {
    expect(isChunkLoadError('Failed to fetch dynamically imported module: https://x/assets/y.js')).toBe(true);
    expect(isChunkLoadError('error loading dynamically imported module')).toBe(true);
    expect(isChunkLoadError('Importing a module script failed.')).toBe(true);
    expect(isChunkLoadError('Loading chunk 42 failed')).toBe(true);
    expect(isChunkLoadError('ChunkLoadError: ...')).toBe(true);
    expect(isChunkLoadError('Unable to preload CSS for /assets/x.css')).toBe(true);
  });
  it('reads the message off an Error-like object', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isChunkLoadError({ message: 'Loading chunk 3 failed' })).toBe(true);
  });
  it('ignores unrelated errors', () => {
    expect(isChunkLoadError('TypeError: x is not a function')).toBe(false);
    expect(isChunkLoadError('')).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('shouldReloadForStaleChunk', () => {
  it('reloads when there was no prior reload (fresh recovery per deploy)', () => {
    expect(shouldReloadForStaleChunk(1_000_000, null)).toBe(true);
  });
  it('does NOT reload within the cooldown (no reload loop on a broken build)', () => {
    expect(shouldReloadForStaleChunk(1_000_000, 1_000_000 - 5_000)).toBe(false);
  });
  it('reloads again once the cooldown has passed', () => {
    expect(shouldReloadForStaleChunk(1_000_000, 1_000_000 - 40_000)).toBe(true);
  });
});
