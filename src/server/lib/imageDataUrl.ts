// Reading a picture the user attached, as a data URL — the one reader every image surface uses.
//
// The image generator's edit path and free chat's "change my photo" both receive the user's picture
// inside the request, so both need the same two answers before anything is called: is this really a
// picture, and is it small enough to send on. One definition, so the two can never disagree.

/** The largest attachment accepted, by decoded BYTES rather than by string length. */
export const MAX_INIT_IMAGE_BYTES = 8 * 1024 * 1024;

/** Strip a data-URL header and report the raw base64 + its mime. Returns null for anything else. */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || '').trim());
  if (!m) return null;
  const base64 = m[2].replace(/\s+/g, '');
  if (!base64) return null;
  return { mimeType: m[1].toLowerCase(), base64 };
}

/** Roughly how many bytes a base64 string decodes to — bounded without decoding it. */
export function base64Bytes(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((len * 3) / 4) - pad;
}

export function initImageTooLarge(dataUrl: string): boolean {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return false;
  return base64Bytes(parsed.base64) > MAX_INIT_IMAGE_BYTES;
}
