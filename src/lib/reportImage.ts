// Getting a screenshot small enough to send with a report — without refusing the user's picture.
//
// A phone screenshot is 1–4 MB. The report route caps the attachment (see SCREENSHOT_MAX_CHARS), so
// the choice is: refuse the picture, or fit it. Refusing is how "Add screenshot" becomes a button that
// only works for people who already know how to resize an image — which is nobody the report system
// is for. This shrinks it instead, and only gives up when even the smallest version will not fit.
//
// The ladder is the same idea as the app-icon fitter (`appIcon.ts`), but the goal is different and so
// the numbers are: an icon must stay crisp at small size, while a screenshot must stay READABLE —
// text in a screenshot is the whole point of attaching it. So it keeps a much larger long edge and
// spends the budget on dimensions rather than quality.

import { SCREENSHOT_MAX_CHARS } from './userReport';

/** The long edge tried, in order. 1600 keeps phone text legible; below 900 it stops being useful. */
export const REPORT_WIDTHS = [1600, 1280, 1024, 900] as const;

/** JPEG quality per attempt — readable text degrades badly under 0.6, so the ladder stops there. */
export const REPORT_QUALITY = [0.82, 0.75, 0.68, 0.6] as const;

export interface ReportImageResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

/** Anything a phone or a laptop actually produces when you take a screenshot. */
const ACCEPTED = /^image\/(png|jpeg|jpg|webp|heic|heif)$/i;

/**
 * Decide the next attempt from the ladder. Pure, so the shrinking policy is testable without a canvas
 * — the part that decides is the part that can be wrong.
 */
export function reportAttempts(): Array<{ maxEdge: number; quality: number }> {
  const out: Array<{ maxEdge: number; quality: number }> = [];
  for (let i = 0; i < REPORT_WIDTHS.length; i++) {
    out.push({ maxEdge: REPORT_WIDTHS[i], quality: REPORT_QUALITY[i] });
  }
  return out;
}

/** Walk the ladder until it fits. `encode` is injected so this is testable with no browser. */
export async function fitReportImage(
  encode: (attempt: { maxEdge: number; quality: number }) => Promise<string>,
  maxChars = SCREENSHOT_MAX_CHARS,
  attempts = reportAttempts(),
): Promise<ReportImageResult> {
  let sawSomething = false;
  for (const attempt of attempts) {
    let out = '';
    try {
      out = await encode(attempt);
    } catch {
      continue; // one encoding failing must not lose the rest of the ladder
    }
    if (!out.startsWith('data:image/')) continue;
    sawSomething = true;
    if (out.length < maxChars) return { ok: true, dataUrl: out };
  }
  return {
    ok: false,
    error: sawSomething
      ? 'That screenshot is very large. Try cropping it to just the problem area.'
      : 'That image could not be read on this device.',
  };
}

/** Browser encoder: draw the image at a bounded long edge and encode as JPEG. */
function canvasEncoder(dataUrl: string) {
  let loaded: Promise<HTMLImageElement> | null = null;
  const load = () => (loaded ??= new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = dataUrl;
  }));

  return async ({ maxEdge, quality }: { maxEdge: number; quality: number }) => {
    const img = await load();
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (!longest) throw new Error('decode failed');
    const scale = Math.min(1, maxEdge / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    // A screenshot on a transparent PNG background would go black without this.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  };
}

/** Read a picked screenshot and shrink it until the report route will accept it. */
export async function compressForReport(file: File | Blob): Promise<ReportImageResult> {
  const type = (file as File).type || '';
  if (!ACCEPTED.test(type)) return { ok: false, error: 'Please choose a screenshot (PNG or JPG).' };
  // 20 MB is far above any screenshot; past that it is a photo or a video frame and reading it into
  // memory on a cheap phone is its own problem.
  if (file.size > 20 * 1024 * 1024) return { ok: false, error: 'That file is too big to attach.' };

  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
  if (!dataUrl.startsWith('data:image/')) return { ok: false, error: 'That file could not be read as an image.' };
  return await fitReportImage(canvasEncoder(dataUrl));
}
