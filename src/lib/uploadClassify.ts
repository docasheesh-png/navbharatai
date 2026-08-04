/**
 * Upload classification helpers — pure logic extracted from App.tsx.
 * Decides whether an uploaded file is a ZIP, whether it's text vs binary,
 * and which size bucket a ZIP falls into (drives the upload-size modal).
 */

const TEXT_EXT_RE = /\.(html|htm|css|scss|js|ts|jsx|tsx|json|md|txt|xml|svg|yaml|yml|py|php|vue|svelte)$/i;

/** True when a file looks like a ZIP archive (by name or MIME type). */
export function isZipFile(name: string, mimeType: string = ''): boolean {
  return (
    name.toLowerCase().endsWith('.zip') ||
    mimeType === 'application/zip' ||
    mimeType === 'application/x-zip-compressed'
  );
}

/** True when a filename has a known text extension (read as text, not base64). */
export function isTextFile(name: string): boolean {
  return TEXT_EXT_RE.test(name);
}

export type ZipSizeBucket = 'too-large' | 'ok';

/** The import ceiling, shared with the server's chunked uploader (MAX_ARCHIVE_BYTES). */
export const ZIP_IMPORT_MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

/**
 * Bucket a ZIP by size — 5 GB is the one honest gate.
 *
 * The old buckets were fiction twice over (2026-08-04 audit): "under 50 MB → ok" waved files into a
 * single-request transport the platform kills at ~32 MB (a silent dead zone), and "50-500 MB → go use
 * GitHub" was an excuse dressed as guidance. The transport is chunked now (useZipImport), so everything
 * up to the server's real ceiling simply imports.
 */
export function classifyZipSize(sizeBytes: number): ZipSizeBucket {
  return sizeBytes > ZIP_IMPORT_MAX_BYTES ? 'too-large' : 'ok';
}
