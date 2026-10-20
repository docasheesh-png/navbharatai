// Turning whatever picture the admin picks into the ONE shape an ad uses: 1200 × 300 (4:1), cropped from
// the middle, saved as a JPEG small enough to store (admin house ads, 2026-10-20).
//
// WHY THE BROWSER DOES THIS AND NOT THE SERVER. The preview the admin looks at is the file that will be
// stored, byte for byte — so what they approve is what users see. A server-side resize would make the preview
// a guess. It also keeps the upload small (a phone photo is 4–8 MB) and keeps an image library off the server.
//
// The geometry and the size check are pure and unit-tested; only `cropToAdBanner` touches the DOM.

import {
  HOUSE_AD_IMAGE_WIDTH, HOUSE_AD_IMAGE_HEIGHT, HOUSE_AD_IMAGE_MAX_BYTES, HOUSE_AD_IMAGE_MIMES,
} from './houseAds';

/** The largest ORIGINAL picture we will even try to read. Bigger is a mistake, not an ad. */
export const HOUSE_AD_SOURCE_MAX_BYTES = 12 * 1024 * 1024;

export interface CropRect { sx: number; sy: number; sw: number; sh: number }

/**
 * The part of a `srcW × srcH` picture that fills a `dstW × dstH` frame without stretching: the biggest
 * centred rectangle with the frame's shape. A wider picture loses its sides, a taller one its top and bottom.
 */
export function coverCrop(srcW: number, srcH: number, dstW: number, dstH: number): CropRect {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;
  if (srcRatio > dstRatio) {
    const sw = Math.round(srcH * dstRatio);
    return { sx: Math.round((srcW - sw) / 2), sy: 0, sw, sh: srcH };
  }
  const sh = Math.round(srcW / dstRatio);
  return { sx: 0, sy: Math.round((srcH - sh) / 2), sw: srcW, sh };
}

/** Decoded size of a base64 data URL, without decoding it. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** The JPEG qualities tried, best first. The first one that fits is kept. */
export const JPEG_QUALITIES: readonly number[] = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42];

export type CropOutcome = { ok: true; dataUrl: string; bytes: number } | { ok: false; error: string };

/** Pick a source file's problem in words, before any pixel is read. null = fine to try. */
export function sourceFileProblem(file: { type: string; size: number }): string | null {
  if (!(HOUSE_AD_IMAGE_MIMES as readonly string[]).includes(file.type)) return 'Choose a JPG, PNG or WebP picture.';
  if (file.size > HOUSE_AD_SOURCE_MAX_BYTES) return 'That picture is too large. Choose one under 12 MB.';
  return null;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}

/** Crop the picked file to 1200 × 300 and compress it until it fits the stored-size limit. */
export async function cropToAdBanner(file: File): Promise<CropOutcome> {
  const problem = sourceFileProblem(file);
  if (problem) return { ok: false, error: problem };
  let img: HTMLImageElement;
  try { img = await loadImage(file); } catch { return { ok: false, error: 'That picture could not be read. Try another one.' }; }
  if (!img.naturalWidth || !img.naturalHeight) return { ok: false, error: 'That picture could not be read. Try another one.' };

  const canvas = document.createElement('canvas');
  canvas.width = HOUSE_AD_IMAGE_WIDTH;
  canvas.height = HOUSE_AD_IMAGE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, error: 'This browser cannot prepare the picture.' };
  // A JPEG has no transparency: paint white first so a transparent PNG does not turn black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const { sx, sy, sw, sh } = coverCrop(img.naturalWidth, img.naturalHeight, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  for (const q of JPEG_QUALITIES) {
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    const bytes = dataUrlBytes(dataUrl);
    if (bytes > 0 && bytes <= HOUSE_AD_IMAGE_MAX_BYTES) return { ok: true, dataUrl, bytes };
  }
  return { ok: false, error: 'That picture is too detailed to fit. Try a simpler picture.' };
}
