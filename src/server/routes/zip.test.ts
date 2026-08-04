import { describe, it, expect } from 'vitest';
import { isTraversalPath } from './zip';

// SEC Phase 5 — the /api/extract-zip route must reject a path that escapes the extraction root at the
// SOURCE, so a hostile traversal path never reaches the client (defense-in-depth over downstream sinks).
describe('isTraversalPath — zip entry paths that escape the extraction root', () => {
  it('flags parent-dir traversal (the classic ../../etc/passwd)', () => {
    expect(isTraversalPath('../../etc/passwd')).toBe(true);
    expect(isTraversalPath('a/b/../../../secret')).toBe(true);
    expect(isTraversalPath('..\\..\\windows\\system32')).toBe(true); // backslash form normalised
  });
  it('flags absolute and drive paths', () => {
    expect(isTraversalPath('/etc/passwd')).toBe(true);
    expect(isTraversalPath('C:/Windows/System32')).toBe(true);
    expect(isTraversalPath('C:\\Windows')).toBe(true);
  });
  it('allows normal in-tree paths (never blocks a legit import)', () => {
    expect(isTraversalPath('src/App.tsx')).toBe(false);
    expect(isTraversalPath('package.json')).toBe(false);
    expect(isTraversalPath('a/b/c.ts')).toBe(false);
    // a filename that merely CONTAINS dots is fine — only a whole '..' segment is traversal:
    expect(isTraversalPath('src/..hidden/x.ts')).toBe(false);
    expect(isTraversalPath('src/file..name.ts')).toBe(false);
  });
});

// THE 32 MB DEAD ZONE, CLOSED (admin 2026-08-04). The legacy Files-panel import sent the whole zip as
// ONE request, which the platform kills at ~32 MB — while the UI waved through anything under 50 MB.
// The extraction here always STREAMED from a temp file (yauzl), so the fix is pure transport: the
// client can now move the file through the chunked uploader and this route CLAIMS the assembled temp
// file by X-Upload-Id. These are source-contract locks on that wiring.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('extract-zip accepts a chunk-uploaded source (the 5 GB transport)', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./zip.ts', import.meta.url)), 'utf8');

  it('claims the assembled upload instead of reading a request body', () => {
    expect(SRC).toContain("String(req.headers['x-upload-id']");
    expect(SRC).toContain('claimUpload(uploadId, uid)');
    expect(SRC).toContain('if (!claimedSource)'); // the body-read is skipped for a claimed source
  });

  it('a claimed upload requires the VERIFIED uploader — never just a guessed id', () => {
    expect(SRC).toContain('verifyFirebaseToken(req)');
  });

  it('the temp file is always cleaned up, claimed or not', () => {
    // claimUpload transfers ownership: whoever claims the file must delete it. The route's finally
    // block unlinks tmpZip on every path, which covers both sources.
    expect(SRC).toContain('fs.unlinkSync(tmpZip)');
  });

  it('an unknown or expired upload id fails honestly, before any extraction', () => {
    expect(SRC).toContain('Unknown or expired upload');
  });
});

describe('the client half routes large files through chunks (useZipImport)', () => {
  const HOOK = readFileSync(fileURLToPath(new URL('../../hooks/useZipImport.ts', import.meta.url)), 'utf8');

  it('the single-request path is capped UNDER the platform limit — the dead zone cannot return', () => {
    expect(HOOK).toContain('SINGLE_REQUEST_ZIP_BYTES = 25 * 1024 * 1024');
    expect(HOOK).toContain('zipFile.size > SINGLE_REQUEST_ZIP_BYTES');
  });

  it('large files go through the chunked uploader and hand over the upload id', () => {
    expect(HOOK).toContain('uploadFileChunked(zipFile');
    expect(HOOK).toContain("'X-Upload-Id': uploadId");
  });
});
