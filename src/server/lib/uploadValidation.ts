// P-DATA.6 — Hardened upload validation (size + type enforcement).
//
// Attachments were parsed for text with only a per-document CHARACTER cap — a huge base64 blob or a
// disallowed/dangerous file type was still decoded and processed. This adds strict, pure validation
// (decoded-size ceiling + an allowlist of supported types) applied at the shared attachment choke
// point, so every AI surface (Free/Pro chat, SDA, v5.0) rejects oversized/unsupported files honestly
// instead of trying to read them. Pure → unit-tested. (Malware scanning needs an external service
// (ClamAV/VirusTotal) and is intentionally out of scope here — noted in the roadmap.)

/** Max DECODED attachment size we will process (15 MB). Bigger files are rejected, not truncated. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Supported extensions (documents + code/text + archives + images/pdf handled by the vision path). */
const ALLOWED_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|php|c|h|cpp|cc|cs|swift|sh|bash|sql|env|ini|toml|log|srt|vtt|docx?|xlsx?|pptx?|zip|pdf|png|jpe?g|gif|webp|bmp|svg)$/i;

/** Supported MIME prefixes/types. */
const ALLOWED_MIME =
  /^(text\/|image\/|application\/(json|xml|x-yaml|javascript|x-sh|x-httpd-php|sql|pdf|zip|x-zip-compressed|vnd\.openxmlformats-officedocument\.|vnd\.ms-excel|vnd\.ms-powerpoint|msword))/i;

/** Pure: decoded byte length of a base64 string (ignores padding + whitespace). */
export function base64DecodedBytes(base64: string): number {
  const s = String(base64 || '').replace(/\s+/g, '').replace(/=+$/, '');
  return Math.floor((s.length * 3) / 4);
}

/** Pure: is this attachment a supported type (by MIME or extension)? */
export function isSupportedAttachment(name: string, type: string): boolean {
  return ALLOWED_MIME.test(String(type || '')) || ALLOWED_EXT.test(String(name || ''));
}

export interface UploadValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Pure: validate one attachment's size + type. Returns { ok:false, reason } for an oversized or
 * unsupported file so the caller can skip it with an honest note (never silently process it).
 */
export function validateAttachment(att: { name?: string; type?: string; base64?: string }): UploadValidationResult {
  const name = att?.name || '';
  const type = att?.type || '';
  if (!att?.base64) return { ok: false, reason: 'empty file' };
  const bytes = base64DecodedBytes(att.base64);
  if (bytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: `too large (${Math.round(bytes / (1024 * 1024))} MB > ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit)` };
  }
  if (!isSupportedAttachment(name, type)) {
    return { ok: false, reason: 'unsupported file type' };
  }
  return { ok: true };
}
