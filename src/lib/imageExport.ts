// Helpers for exporting a generated image (copy-to-clipboard / download / share).
//
// The AI Image Generator returns each image as a data URL (data:<mime>;base64,<...>). The old
// Copy/Download buttons treated that string as a LINK — Copy did clipboard.writeText(dataUrl) (pasting
// a giant base64 string, not the picture) and Download was an <a href={dataUrl} download> that just
// opens the image in a tab on the native WebView instead of saving it (admin bug 2026-07-22). These
// pure helpers turn the data URL into a real Blob/File so the component can put the actual IMAGE on the
// clipboard and trigger a real download / native share sheet. Kept dependency-free + unit-tested.

/** Convert a `data:<mime>[;base64],<data>` URL into a Blob. Throws on a malformed / non-data URL. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl || '');
  if (!match) throw new Error('Not a data URL');
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = !!match[2];
  const raw = match[3];
  let bytes: Uint8Array;
  if (isBase64) {
    const binary = atob(raw);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    const decoded = decodeURIComponent(raw);
    bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/** Extract the raw base64 payload from a `data:<mime>;base64,<...>` URL (for a native file write).
 *  Throws on a non-base64 / non-data URL so callers can fall back to reading the Blob instead. */
export function dataUrlToBase64(dataUrl: string): string {
  const match = /^data:[^;,]*;base64,([\s\S]*)$/.exec(dataUrl || '');
  if (!match) throw new Error('Not a base64 data URL');
  return match[1];
}

/** The file extension for an image mime type (defaults to png). */
export function extForMime(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('svg')) return 'svg';
  return 'png';
}

/**
 * A safe, descriptive download filename from the prompt + mime, e.g.
 * imageFilename('Modern App Logo!', 'image/png') → 'navbharat-modern-app-logo.png'.
 * Falls back to 'navbharat-image.<ext>' when the prompt has no usable characters.
 */
export function imageFilename(prompt: string, mime = 'image/png'): string {
  const slug = (prompt || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `navbharat-${slug || 'image'}.${extForMime(mime)}`;
}
