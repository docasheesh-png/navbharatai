// AgentV3 — File-upload MIME/type-validation analysis (additive evaluate dimension).
//
// A real, deterministic scan for a distinct, high-value backend security gap no other analyzer covers: a
// file-upload endpoint that accepts ANY file type because it configures the upload middleware with no MIME
// / file-type restriction. An unrestricted upload lets a user submit an executable, an HTML/SVG payload
// (stored-XSS), or an oversized file — a classic path to stored-XSS, malware hosting, and (with a bad
// static-serve) RCE. The one-attribute defence is a `fileFilter` that allowlists expected MIME types.
//
// Scope: the three dominant Node upload middlewares — `multer`, `formidable`, and `express-fileupload`.
// None applies any MIME/type restriction unless the developer adds one (multer via a `fileFilter` option;
// formidable / express-fileupload via a manual `file.mimetype` check), so an upload configured without one
// accepts any file type on ALL three. Detection is HIGH PRECISION (never nag a correct app):
//   • Fires only when one of the upload middlewares is actually configured in a backend file.
//   • Skips it when the file shows ANY sign of type validation — a `fileFilter` option OR any `mimetype`/
//     `mimeType` reference (a manual MIME check counts) — so an app that validates a different way is never
//     flagged.
//   • An upload call in a file with no MIME check ⇒ the one real finding (one per file). Frontend, tests and
//     vendored trees are excluded.
// Read-only, dependency-free, never throws. Advisory (severity 'medium') — it lowers the score and tells the
// builder to add a MIME/type allowlist; it never blocks a build.

export type UploadLibrary = 'multer' | 'formidable' | 'express-fileupload';

export interface UploadValidationIssue {
  file: string;
  library: UploadLibrary;
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

// Each upload middleware's configuration signal. Ordered most-specific first; the FIRST match names the lib.
const UPLOAD_LIBS: Array<{ library: UploadLibrary; re: RegExp }> = [
  // multer(...) — the multer middleware being configured.
  { library: 'multer', re: /\bmulter\s*\(/ },
  // formidable(...) or `new IncomingForm(...)` — the formidable parser being created.
  { library: 'formidable', re: /\bformidable\s*\(|new\s+IncomingForm\s*\(/ },
  // fileUpload(...) — the express-fileupload middleware being mounted.
  { library: 'express-fileupload', re: /\bfileUpload\s*\(/ },
];

/** A `fileFilter` option (multer's built-in MIME/type gate) present anywhere in the file ⇒ validated. */
const FILE_FILTER_RE = /\bfileFilter\b/;
/** Any MIME reference (a manual `file.mimetype === …` allowlist counts as validation) ⇒ validated. */
const MIMETYPE_RE = /\bmime[_]?type\b/i;

/**
 * Scan one backend file for an unrestricted file upload. Returns a single issue iff the file configures one
 * of the upload middlewares but shows no file-type validation (no `fileFilter`, no `mimetype` check);
 * otherwise []. Pure. The reported `library` is the first middleware detected.
 */
export function scanUploadValidation(path: string, code: string): UploadValidationIssue[] {
  if (typeof code !== 'string' || !code) return [];
  const lib = UPLOAD_LIBS.find((l) => l.re.test(code));
  if (!lib) return []; // no upload middleware configured here
  if (FILE_FILTER_RE.test(code) || MIMETYPE_RE.test(code)) return []; // some type validation is present
  return [{ file: path, library: lib.library, missing: 'file-type-filter', severity: 'medium', kind: 'upload-no-mime-validation' }];
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
  const body = issues.map((x) => `  - [${x.severity}] ${x.file} — ${x.library} upload with no MIME/type check`);
  return [
    `Upload-validation scan: ${issues.length} file-upload endpoint(s) accept ANY file type (no MIME/type validation) — a path to stored-XSS / malware hosting. Restrict allowed types: a multer fileFilter that allowlists expected MIME types, or a file.mimetype allowlist check for formidable / express-fileupload (and cap the file size).`,
    ...body,
  ].join('\n');
}
