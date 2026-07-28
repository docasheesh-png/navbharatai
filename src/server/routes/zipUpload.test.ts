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

// claimUpload — the seam that let the Nav App Store stop base64-ing a 150 MB APK into a JSON body.
describe('claimUpload contract', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./zipUpload.ts', import.meta.url)), 'utf8');
  const STORE = readFileSync(fileURLToPath(new URL('./navStore.ts', import.meta.url)), 'utf8');

  it('transfers ownership so the temp file cannot be claimed twice', () => {
    expect(SRC).toContain('pending.delete(uploadId); // ownership transfers to the caller');
  });

  it('only the uploading user can claim (reuses the same ownership check)', () => {
    expect(SRC).toContain('if (!uploadOwnedBy(u, uid)) return null;');
  });

  it('the store prefers the chunked upload and still deletes the temp file on every path', () => {
    expect(STORE).toContain('claimUpload(body.uploadId, me?.uid ?? null)');
    // cleanup must run before EACH early return, not only on success
    expect(STORE).toContain('cleanupUpload(); return res.status(400)');
    expect(STORE).toContain('cleanupUpload();\n      return res.status(413)');
  });

  it('the legacy base64 path is kept, so small submissions that worked still work', () => {
    expect(STORE).toContain('decodeUpload(body.apkBase64)');
  });

  it('the APK still passes the real inspection + malware scan (transport changed, safety did not)', () => {
    expect(STORE).toContain('await inspectApk(bytes)');
    expect(STORE).toContain('await scanFile(bytes, facts.sha256)');
  });
});
