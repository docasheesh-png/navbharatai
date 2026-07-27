import { describe, it, expect } from 'vitest';
import { chunkFilesForSync, totalFilesBytes, IMPORT_SYNC_CHUNK_BYTES } from './chunkFilesForSync';

describe('chunkFilesForSync', () => {
  it('returns [] for empty/absent input', () => {
    expect(chunkFilesForSync({})).toEqual([]);
    expect(chunkFilesForSync(null)).toEqual([]);
    expect(chunkFilesForSync(undefined)).toEqual([]);
  });

  it('keeps a small file map in a single chunk', () => {
    const files = { 'a.ts': 'hello', 'b.ts': 'world' };
    const chunks = chunkFilesForSync(files);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(files);
  });

  it('never exceeds maxBytes per chunk for many small files', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 500; i++) files[`file${i}.txt`] = 'x'.repeat(10_000); // ~5MB total
    const chunks = chunkFilesForSync(files, 1_000_000); // 1MB budget
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      let bytes = 0;
      for (const [p, c] of Object.entries(chunk)) bytes += p.length + c.length;
      expect(bytes).toBeLessThanOrEqual(1_000_000 + 10_000); // last file in a chunk may push slightly over its own size
    }
  });

  it('never drops or duplicates a file across chunks', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 200; i++) files[`f${i}.txt`] = 'y'.repeat(50_000);
    const chunks = chunkFilesForSync(files, 500_000);
    const seen: Record<string, string> = {};
    for (const chunk of chunks) {
      for (const [p, c] of Object.entries(chunk)) {
        expect(seen[p]).toBeUndefined();
        seen[p] = c;
      }
    }
    expect(seen).toEqual(files);
  });

  it('gives an oversized single file its own chunk instead of dropping it', () => {
    const files = { 'huge.bin': 'z'.repeat(2_000_000) };
    const chunks = chunkFilesForSync(files, 1_000_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]['huge.bin']).toBe(files['huge.bin']);
  });

  it('respects the default export budget', () => {
    expect(IMPORT_SYNC_CHUNK_BYTES).toBeGreaterThan(0);
    expect(IMPORT_SYNC_CHUNK_BYTES).toBeLessThan(30 * 1024 * 1024);
  });
});

describe('totalFilesBytes', () => {
  it('returns 0 for empty/absent input', () => {
    expect(totalFilesBytes({})).toBe(0);
    expect(totalFilesBytes(null)).toBe(0);
  });

  it('sums content + path bytes across all files', () => {
    const files = { 'a.ts': 'hello', 'b.ts': 'world!' };
    expect(totalFilesBytes(files)).toBe('a.ts'.length + 'hello'.length + 'b.ts'.length + 'world!'.length);
  });
});
