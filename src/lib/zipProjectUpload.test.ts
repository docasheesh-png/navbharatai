import { describe, it, expect } from 'vitest';
import { chunkCount, chunkRange, DEFAULT_ZIP_CHUNK_BYTES } from './zipProjectUpload';

// The slicing maths behind the 161 MB import. A wrong range silently corrupts the assembled
// archive (the server just appends what it's given), so these are the load-bearing pure bits.
describe('chunkCount / chunkRange', () => {
  it('covers a file exactly, with no gap and no overlap', () => {
    const size = 161 * 1024 * 1024 + 12345; // a real-world odd size
    const cb = DEFAULT_ZIP_CHUNK_BYTES;
    const n = chunkCount(size, cb);
    let cursor = 0;
    for (let i = 0; i < n; i++) {
      const { start, end } = chunkRange(i, cb, size);
      expect(start).toBe(cursor); // no gap, no overlap
      expect(end).toBeGreaterThan(start);
      cursor = end;
    }
    expect(cursor).toBe(size); // the last chunk lands exactly on the end
  });

  it('never exceeds the chunk budget (every request must clear the platform cap)', () => {
    const size = 100 * 1024 * 1024;
    const cb = 8 * 1024 * 1024;
    for (let i = 0; i < chunkCount(size, cb); i++) {
      const { start, end } = chunkRange(i, cb, size);
      expect(end - start).toBeLessThanOrEqual(cb);
    }
  });

  it('handles a file smaller than one chunk', () => {
    expect(chunkCount(10, 8 * 1024 * 1024)).toBe(1);
    expect(chunkRange(0, 8 * 1024 * 1024, 10)).toEqual({ start: 0, end: 10 });
  });

  it('always posts at least one chunk, even for an empty file', () => {
    expect(chunkCount(0, 1024)).toBe(1);
    expect(chunkRange(0, 1024, 0)).toEqual({ start: 0, end: 0 });
  });

  it('clamps a past-the-end index instead of returning a negative range', () => {
    expect(chunkRange(99, 10, 25)).toEqual({ start: 25, end: 25 });
  });

  it('the default chunk stays well under the ~32MB platform request cap', () => {
    expect(DEFAULT_ZIP_CHUNK_BYTES).toBeLessThan(32 * 1024 * 1024);
  });
});
