import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validChunkMeta, uploadOwnedBy, ZIP_CHUNK_BYTES, MAX_ARCHIVE_BYTES } from './zipUpload';

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
    // The invariant moved into lib/workspaceIdentity (audit finding #2) so it is no longer re-typed
    // per route. Locking the shared POLICY is stronger than locking a template literal: this route
    // must use the strictest one — an import WRITES files, so a verified owner is required and the
    // anon capability does not apply.
    expect(SRC).toContain('ownedByVerifiedUid(uid, workspaceId)');
    expect(SRC).toContain("from '../lib/workspaceIdentity'");
  });

  it('commit lands server-side and never ships the file map back through a capped response', () => {
    expect(SRC).toContain('writeWorkspaceFiles(actuator, workspaceId, files)');
    expect(SRC).toContain('mergeWorkspaceFiles(workspaceId, files)');
    expect(SRC).not.toContain('files: extracted.files'); // the old, cap-bound shape
  });

  // HONESTY TRIPWIRE (admin 2026-08-04). The extractor counts every refusal in eight labelled
  // categories, and commit used to return NONE of them — so a media-heavy 1 GB project reported
  // "Imported 400 files" while 3,600 of the user's own files were silently gone. These assertions fail
  // the moment the response goes quiet about that again, in either direction: the raw counts must
  // travel AND the ready-made sentence must be built from the real numbers.
  it('commit reports what it refused — the counts and the archive total both travel to the client', () => {
    expect(SRC).toContain('dropped,');
    expect(SRC).toContain('totalEntries: extracted.totalEntries');
  });

  it('commit ships the honest summary sentence, computed from the REAL kept/total/dropped numbers', () => {
    expect(SRC).toContain('summary: importDropSummary({ kept: written.length, totalEntries: extracted.totalEntries, dropped })');
  });

  it('a file that extracted but could not be landed still counts as not-imported', () => {
    // writeWorkspaceFiles' own `skipped` is folded in: from the user's side a file they do not have is
    // missing regardless of which stage refused it.
    expect(SRC).toContain('overCap: (extracted.dropped?.overCap ?? 0) + skipped.length');
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
    // Every early return AFTER the upload is claimed must delete the temp file first. Scoped to the
    // post-claim region on purpose: returns BEFORE the claim (e.g. form validation) have no temp file
    // to clean, and the 30-minute sweep covers an upload the client never submits.
    // Asserted STRUCTURALLY, not as an exact string — an earlier version of this test pinned literal
    // whitespace and broke when the 413 branch was reformatted, flagging formatting rather than a defect.
    // Scope starts where cleanup becomes POSSIBLE (the helper's definition), not at the claim: the
    // returns above it either predate any temp file (form validation) or fire because the claim
    // itself failed, so there is nothing to delete. Bounding it correctly is the difference between
    // testing the invariant and testing an accident of line order.
    const claimAt = STORE.indexOf('const cleanupUpload =');
    expect(claimAt).toBeGreaterThan(-1);
    // The region ends where the temp file provably stops mattering: the handoff to the shared ingest
    // pipeline, which runs on bytes already in memory. This used to be bounded by `inspectApk`, which
    // moved into that shared function when publish-from-build needed the same pipeline — the
    // invariant did not change, only where the boundary lives. (Verified by reading the route: every
    // return between the claim and the handoff calls cleanupUpload, and the unconditional cleanup is
    // now the LAST statement before the handoff, so nothing after it can leak a temp file.)
    const scanEnd = STORE.indexOf('await ingestApkSubmission(bytes');
    expect(scanEnd).toBeGreaterThan(claimAt);
    const postClaim = STORE.slice(claimAt, scanEnd);
    const earlyReturns = [...postClaim.matchAll(/return res\.status\((\d{3})\)/g)];
    expect(earlyReturns.length).toBeGreaterThan(1); // both the 400 and the 413 paths
    for (const m of earlyReturns) {
      // Check the SAME BLOCK, not "anywhere earlier in the function". Verified by deleting the 413
      // branch's cleanup: the looser version still passed, because the 400 branch's cleanup sat
      // earlier in the string and satisfied it — a test that proved nothing.
      const blockStart = postClaim.lastIndexOf('{', m.index);
      const block = postClaim.slice(blockStart, m.index);
      expect(block).toContain('cleanupUpload()');
    }
  });

  it('the legacy base64 path is kept, so small submissions that worked still work', () => {
    expect(STORE).toContain('decodeUpload(body.apkBase64)');
  });

  it('the APK still passes the real inspection + malware scan (transport changed, safety did not)', () => {
    expect(STORE).toContain('await inspectApk(bytes)');
    expect(STORE).toContain('await scanFile(bytes, facts.sha256)');
  });
});

describe('the 5 GB import (admin 2026-08-04) — real, because commit STREAMS from disk', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./zipUpload.ts', import.meta.url)), 'utf8');

  it('the ceiling is 5 GB', () => {
    expect(MAX_ARCHIVE_BYTES).toBe(5 * 1024 * 1024 * 1024);
  });

  it('THE REGRESSION THAT MADE EVEN 1 GB FICTION: commit must never buffer the whole archive', () => {
    // fs.readFileSync(zip) + jszip held the entire archive in memory — a 1 GB commit needed ~2-3 GB of
    // RAM, so the advertised cap was unreachable regardless of transport. Commit must stream from disk.
    // The path variable is now `archivePath` rather than `u.filePath`, because commit may assemble the
    // archive from the shared chunk objects first (see zipUploadStore.ts — the fix for a multi-chunk
    // upload dying on a second Cloud Run instance). What must never change is that it is a PATH read
    // from disk, never the archive held in memory, so that is what this asserts.
    expect(SRC).toContain('extractZipProjectFromDisk(archivePath)');
    expect(SRC).not.toContain('readFileSync(u.filePath)');
    expect(SRC).not.toContain('readFileSync(u.filePath)');
  });

  it('begin refuses over-ceiling and no-disk-room uploads BEFORE any bytes move', () => {
    // A 5 GB upload that dies at 90% (or fills the instance disk) is the dishonest version of a limit.
    expect(SRC).toContain('declaredBytes > MAX_ARCHIVE_BYTES');
    expect(SRC).toContain('hasSpaceForUpload(free, declaredBytes)');
    expect(SRC).toContain('507');
  });
});
