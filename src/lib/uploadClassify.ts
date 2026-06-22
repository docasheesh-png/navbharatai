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

export type ZipSizeBucket = 'too-large' | 'github' | 'ok';

/**
 * Bucket a ZIP by size:
 * - > 500 MB → 'too-large' (rejected)
 * - > 50 MB  → 'github'    (suggest GitHub import instead)
 * - else     → 'ok'        (import directly)
 */
export function classifyZipSize(sizeBytes: number): ZipSizeBucket {
  const sizeMB = sizeBytes / (1024 * 1024);
  if (sizeMB > 500) return 'too-large';
  if (sizeMB > 50) return 'github';
  return 'ok';
}
