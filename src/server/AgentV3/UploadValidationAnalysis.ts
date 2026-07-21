// AgentV3 — File-upload MIME/type-validation analysis (additive evaluate dimension).
//
// A real, deterministic scan for a distinct, high-value backend security gap no other analyzer covers: a
// file-upload endpoint that accepts ANY file type because it configures the upload middleware with no MIME
// / file-type restriction. An unrestricted upload lets a user submit an executable, an HTML/SVG payload
// (stored-XSS), or an oversized file — a classic path to stored-XSS, malware hosting, and (with a bad
// static-serve) RCE. The one-attribute defence is a `fileFilter` that allowlists expected MIME types.
//
// Scope: multer — by far the dominant Express upload middleware, and the one with a clean, unambiguous
// signal. Detection is HIGH PRECISION (never nag a correct app):
//   • Fires only when a `multer(` call is present in a backend file.
//   • Skips it when the file shows ANY sign of type validation — a `fileFilter` option OR any `mimetype`/
//     `mimeType` reference (a manual MIME check counts) — so an app that validates a different way is never
//     flagged.
//   • `multer()` with no options, or options lacking a `fileFilter`, in a file with no MIME check ⇒ the one
//     real finding. Frontend, tests and vendored trees are excluded.
// Read-only, dependency-free, never throws. Advisory (severity 'medium') — it lowers the score and tells the
// builder to add a `fileFilter`; it never blocks a build.

export interface UploadValidationIssue {
  file: string;
  library: 'multer';
  /** What protection is missing. */
  missing: 'file-type-filter';
  severity: 'medium';
  kind: 'upload-no-mime-validation';
}

/** Backend source files where upload middleware is wired. */
const BACKEND_EXT = /\.(ts|js|mjs|cjs)$/i;
/** Frontend / generated / vendored / test trees never host the server's upload route. */
const SKIP_PATH =
  /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)|\.(tsx|jsx|vue|svelte|astro)$/i;

/** A `multer(...)` call — the upload middleware being configured. */
const MULTER_CALL_RE = /\bmulter\s*\(/;
/** A `fileFilter` option (multer's built-in MIME/type gate) present anywhere in the file ⇒ validated. */
const FILE_FILTER_RE = /\bfileFilter\b/;
/** Any MIME reference (a manual `file.mimetype === …` allowlist counts as validation) ⇒ validated. */
const MIMETYPE_RE = /\bmime[_]?type\b/i;

/**
 * Scan one backend file for an unrestricted multer upload. Returns a single issue iff the file configures
 * multer but shows no file-type validation (no `fileFilter`, no `mimetype` check); otherwise []. Pure.
 */
export function scanUploadValidation(path: string, code: string): UploadValidationIssue[] {
  if (typeof code !== 'string' || !code) return [];
  if (!MULTER_CALL_RE.test(code)) return []; // no multer upload configured here
  if (FILE_FILTER_RE.test(code) || MIMETYPE_RE.test(code)) return []; // some type validation is present
  return [{ file: path, library: 'multer', missing: 'file-type-filter', severity: 'medium', kind: 'upload-no-mime-validation' }];
}

/** Scan a whole project's backend files. Returns [] when no unrestricted upload endpoint is found. Pure. */
export function scanProjectUploadValidation(files: Record<string, string>): UploadValidationIssue[] {
  const out: UploadValidationIssue[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!BACKEND_EXT.test(path) || SKIP_PATH.test(path)) continue;
    out.push(...scanUploadValidation(path, content));
  }
  return out;
}

/** A concise, honest upload-validation report for the agent. Pure. */
export function uploadValidationSummary(issues: UploadValidationIssue[]): string {
  if (issues.length === 0) return 'Upload-validation scan: ✓ No unrestricted file-upload endpoints.';
  const body = issues.map((x) => `  - [${x.severity}] ${x.file} — multer upload with no fileFilter / MIME check`);
  return [
    `Upload-validation scan: ${issues.length} file-upload endpoint(s) accept ANY file type (multer with no fileFilter) — a path to stored-XSS / malware hosting. Add a fileFilter that allowlists expected MIME types (and a limits.fileSize cap).`,
    ...body,
  ].join('\n');
}
