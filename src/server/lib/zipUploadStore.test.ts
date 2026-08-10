import { describe, it, expect } from 'vitest';
import { chunkObjectPath, sharedUploadsEnabled } from './zipUploadStore';

// A 161 MB import failed with "Unknown or expired upload." because the in-flight upload lived in a
// module-level Map and a temp file on ONE Cloud Run instance, while its ~21 chunk requests were routed
// independently. The chunks now become separate objects that any instance can write, and the ordering
// of those objects IS the byte order of the assembled archive — so the naming below is not cosmetic.

describe('chunk object naming decides the archive’s byte order', () => {
  it('zero-pads so lexicographic order IS numeric order', () => {
    // The bug this prevents is nastier than a failed upload: unpadded, "10" sorts before "2", the parts
    // are concatenated in the wrong order, and the user gets a corrupt zip reported as a damaged file.
    const paths = [0, 1, 2, 9, 10, 11, 100, 640].map((i) => chunkObjectPath('u1', i));
    expect([...paths].sort()).toEqual(paths);
  });

  it('keeps every upload in its own folder, so two imports never mix parts', () => {
    expect(chunkObjectPath('upload-a', 3)).toContain('zip-uploads/upload-a/');
    expect(chunkObjectPath('upload-b', 3)).toContain('zip-uploads/upload-b/');
    expect(chunkObjectPath('upload-a', 3)).not.toBe(chunkObjectPath('upload-b', 3));
  });

  it('is stable, so re-sending a chunk overwrites it rather than duplicating bytes', () => {
    // Idempotence is what makes a retried chunk safe. An append-based design would have inserted the
    // repeat into the middle of the archive instead.
    expect(chunkObjectPath('u1', 7)).toBe(chunkObjectPath('u1', 7));
  });

  it('names a part per chunk index', () => {
    expect(chunkObjectPath('u1', 0)).toBe('zip-uploads/u1/000000.part');
    expect(chunkObjectPath('u1', 640)).toBe('zip-uploads/u1/000640.part');
  });
});

describe('when the shared path is unavailable', () => {
  it('reports itself off under test, so the single-instance path is what runs here', () => {
    // Locally and in CI there is exactly one instance, so the original in-memory path is correct there
    // — and this keeps the change from altering behaviour in the environments the tests run in.
    expect(sharedUploadsEnabled()).toBe(false);
  });
});
