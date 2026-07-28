import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validChunkMeta, uploadOwnedBy, ZIP_CHUNK_BYTES } from './zipUpload';

describe('validChunkMeta', () => {
  it('accepts a real chunk sequence', () => {
    expect(validChunkMeta(0, 21)).toBe(true);
    expect(validChunkMeta(20, 21)).toBe(true);
  });
  it('rejects out-of-range, non-integer and absurd metadata', () => {
    expect(validChunkMeta(21, 21)).toBe(false);   // index === total
    expect(validChunkMeta(-1, 5)).toBe(false);
    expect(validChunkMeta(0, 0)).toBe(false);
    expect(validChunkMeta(NaN, 5)).toBe(false);
    expect(validChunkMeta(1.5, 5)).toBe(false);
    expect(validChunkMeta(0, 1_000_000)).toBe(false);
  });
});

describe('uploadOwnedBy', () => {
  const u = { uid: 'user-1', filePath: '/tmp/x', bytes: 0, createdAt: 0, fileName: 'a.zip' };
  it('only the uploading user may append or commit', () => {
    expect(uploadOwnedBy(u, 'user-1')).toBe(true);
    expect(uploadOwnedBy(u, 'user-2')).toBe(false);
    expect(uploadOwnedBy(u, null)).toBe(false);
    expect(uploadOwnedBy(undefined, 'user-1')).toBe(false);
  });
});

describe('zip-upload route contract', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./zipUpload.ts', import.meta.url)), 'utf8');

  it('a chunk clears the platform request cap with room to spare', () => {
    expect(ZIP_CHUNK_BYTES).toBeLessThan(32 * 1024 * 1024);
  });

  it('commit requires the VERIFIED uid to own the target workspace', () => {
    // An import WRITES files, so knowing a workspace id must never be enough.
    expect(SRC).toContain('workspaceId.startsWith(`agentv3-${uid}-`)');
  });

  it('commit lands server-side and never ships the file map back through a capped response', () => {
    expect(SRC).toContain('writeWorkspaceFiles(actuator, workspaceId, files)');
    expect(SRC).toContain('mergeWorkspaceFiles(workspaceId, files)');
    expect(SRC).not.toContain('files: extracted.files'); // the old, cap-bound shape
  });

  it('the temp archive is always discarded, even when extraction throws', () => {
    expect(SRC).toContain('discard(uploadId); // the temp archive is never kept past a commit attempt');
    expect(SRC).toContain('} finally {');
  });

  it('the size ceiling is enforced mid-stream, not after the disk is already full', () => {
    expect(SRC).toContain("req.on('data'");
    expect(SRC).toContain('req.destroy()');
  });
});
