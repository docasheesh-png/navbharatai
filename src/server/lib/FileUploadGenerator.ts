// U-4 (verified recipe modules) — file-upload validation by MAGIC BYTES (dependency-free).
//
// Every app that accepts uploads (avatars, product photos, documents) needs to validate them — but the
// client-supplied filename, extension and Content-Type are all attacker-controlled: a malicious .php or an
// HTML-with-<script> can be renamed "photo.jpg" and declared image/jpeg. The only trustworthy signal is the
// file's actual CONTENT. This recipe ships a real validator that sniffs the leading "magic bytes" to detect
// the true type (PNG/JPEG/GIF/WebP/PDF/MP4/ZIP), enforces a type allowlist and a size cap, and returns an
// honest {ok, type, error}. Dependency-free (reads the Buffer directly), no env keys. PURE builder; correct
// and complete — no TODO stubs (the real-features rule). Unit-tested.

export interface UploadConfig {
  files: Record<string, string>;
  instructions: string;
}

const UPLOAD_SERVER = `// Detect a file's TRUE type from its leading bytes (its "magic number"), ignoring the client-supplied
// filename/extension/Content-Type, which are all forgeable. Returns a canonical type string or null when the
// content matches none of the known signatures. Covers the common web upload types; extend SIGNATURES for more.
export type DetectedType = 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'mp4' | 'zip';

export function detectFileType(buf: Buffer): DetectedType | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  // GIF: "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  // PDF: "%PDF"
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf';
  // WebP: "RIFF"...."WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  // MP4/ISO-BMFF: bytes 4-7 == "ftyp"
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  // ZIP (also docx/xlsx/pptx): 50 4B 03 04
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  return null;
}

export interface UploadCheck {
  ok: boolean;
  type: DetectedType | null;
  error?: string;
}

// Validate an uploaded file buffer against a type allowlist and a size cap, using the REAL detected type.
// Reject BEFORE you write the file to disk / object storage. Example:
//   const check = validateUpload(req.file.buffer, { allowed: ['png', 'jpeg', 'webp'], maxBytes: 5 * 1024 * 1024 });
//   if (!check.ok) return res.status(400).json({ error: check.error });
export function validateUpload(
  buf: Buffer,
  opts: { allowed: DetectedType[]; maxBytes: number },
): UploadCheck {
  if (buf.length === 0) return { ok: false, type: null, error: 'Empty file.' };
  if (buf.length > opts.maxBytes) {
    return { ok: false, type: null, error: 'File too large (max ' + opts.maxBytes + ' bytes).' };
  }
  const type = detectFileType(buf);
  if (!type) {
    return { ok: false, type: null, error: 'Unrecognized or unsupported file type.' };
  }
  if (!opts.allowed.includes(type)) {
    return { ok: false, type, error: 'File type "' + type + '" is not allowed.' };
  }
  return { ok: true, type };
}
`;

const INSTRUCTIONS =
  'File-upload validation wired at server/lib/upload.ts (no dependency — reads the Buffer directly). Import ' +
  'validateUpload(buffer, { allowed: ["png","jpeg","webp"], maxBytes }) and run it on every uploaded file ' +
  'BEFORE saving it, returning 400 if !ok. It detects the TRUE type from the file content (magic bytes), not ' +
  'the client-supplied filename/extension/Content-Type (all forgeable), so a renamed .php or script cannot ' +
  'slip through as an image. Use detectFileType(buffer) if you just need the real type. Pair with the image ' +
  'recipe to resize AFTER validating. No API key needed.';

export function generateFileUploadIntegration(): UploadConfig {
  return {
    files: { 'server/lib/upload.ts': UPLOAD_SERVER },
    instructions: INSTRUCTIONS,
  };
}
