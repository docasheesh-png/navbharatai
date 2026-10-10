import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Server } from 'node:http';
import { validChunkMeta, uploadOwnedBy, ZIP_CHUNK_BYTES, MAX_ARCHIVE_BYTES, registerZipUploadRoutes } from './zipUpload';
import { setDb } from '../lib/db';
import { WORKSPACE_BUILD_LEASE_COLLECTION, BUILD_RUNNING_ELSEWHERE_CODE } from '../AgentV3/workspaceBuildLease';

const zipWrites = vi.hoisted(() => ({ paths: [] as string[] }));

vi.mock('../lib/authMiddleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authMiddleware')>();
  return {
    ...actual,
    verifyFirebaseToken: async () => 'user1',
    verifyFirebaseIdentity: async () => ({ uid: 'user1', email: 'user1@example.com', emailVerified: true }),
  };
});

vi.mock('./actuatorFactory', () => ({
  buildActuator: () => ({
    ensureWorkspace: async () => {},
    writeFile: async (_ws: string, path: string) => { zipWrites.paths.push(path); },
    listFiles: async () => [] as string[],
    readFile: async () => { throw new Error('ENOENT'); },
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  }),
}));

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

// claimUpload — the chunked-upload seam. It hands a fully-assembled temp file to a caller ONCE, only to
// the user who uploaded it. It powers the large-zip IMPORT path (routes/zip.ts). (The Nav App Store no
// longer uses it: its device-upload route was removed on 2026-08-16 — the store now carries only apps
// NavBharatAI built, published straight from the build with no file to upload.)
describe('claimUpload contract', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./zipUpload.ts', import.meta.url)), 'utf8');

  it('transfers ownership so the temp file cannot be claimed twice', () => {
    expect(SRC).toContain('pending.delete(uploadId); // ownership transfers to the caller');
  });

  it('only the uploading user can claim (reuses the same ownership check)', () => {
    expect(SRC).toContain('if (!uploadOwnedBy(u, uid)) return null;');
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

describe('zip commit takes the build lease', () => {
  const prevPhone = process.env.AGENTV3_IMPORT_REQUIRES_PHONE;
  const prevLease = process.env.AGENTV3_WORKSPACE_LEASE;
  let server: Server | null = null;
  let dirs: string[] = [];

  afterEach(() => {
    process.env.AGENTV3_IMPORT_REQUIRES_PHONE = prevPhone;
    if (prevLease === undefined) delete process.env.AGENTV3_WORKSPACE_LEASE;
    else process.env.AGENTV3_WORKSPACE_LEASE = prevLease;
    setDb(null);
    zipWrites.paths.length = 0;
    if (server) { server.close(); server = null; }
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  it('a busy lease returns 409 and the actuator receives no writes', async () => {
    process.env.AGENTV3_IMPORT_REQUIRES_PHONE = 'off';
    delete process.env.AGENTV3_WORKSPACE_LEASE;
    const app = express();
    app.use(express.json());
    registerZipUploadRoutes(app);
    const port = await new Promise<number>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => {
        server = s;
        resolve((s.address() as { port: number }).port);
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const begin = await fetch(`${base}/api/zip-upload/begin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify({ fileName: 'project.zip', fileSize: 128 }),
    });
    expect(begin.status).toBe(200);
    const { uploadId } = await begin.json() as { uploadId: string };
    const srcDir = mkdtempSync(join(tmpdir(), 'nbai-zip-src-'));
    dirs.push(srcDir);
    writeFileSync(join(srcDir, 'App.tsx'), 'export const a = 1;\n');
    const archive = join(tmpdir(), `nbai-zip-${uploadId}.zip`);
    execFileSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2],"src/App.tsx"); z.close()', archive, join(srcDir, 'App.tsx')]);

    const workspaceId = 'agentv3-user1-sessionpr12';
    const key = `${WORKSPACE_BUILD_LEASE_COLLECTION}/${workspaceId}`;
    const docs = new Map<string, Record<string, unknown>>();
    docs.set(key, { token: 'held-by-other', owner: 'other-instance', heartbeatAt: Date.now(), userId: 'user1' });
    setDb({
      collection: (name: string) => ({ doc: (id: string) => `${name}/${id}` }),
      runTransaction: async (fn: (tx: {
        get(ref: unknown): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
        set(ref: unknown, value: Record<string, unknown>): void;
        delete(ref: unknown): void;
      }) => Promise<unknown>) => fn({
        get: async (ref) => ({ exists: docs.has(ref as string), data: () => docs.get(ref as string) }),
        set: (ref, v) => { docs.set(ref as string, v); },
        delete: (ref) => { docs.delete(ref as string); },
      }),
    } as never);

    const commit = await fetch(`${base}/api/zip-upload/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify({ uploadId, workspaceId }),
    });
    expect(commit.status).toBe(409);
    const body = await commit.json() as { code?: string };
    expect(body.code).toBe(BUILD_RUNNING_ELSEWHERE_CODE);
    expect(zipWrites.paths).toEqual([]);
  });
});
