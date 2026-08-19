// Getting a real app icon out of the user, on a phone, without a file manager.
//
// WHY (admin 2026-07-27): the APK Builder only offered a dozen emoji. An emoji is fine as a preview
// but it is not an app icon — Play requires a 512×512 PNG, and an emoji rendered by whatever font the
// build machine happens to have is not that. So the user needs three real ways in: a picture from
// their device, the image AI Image Gen just put on their clipboard, or a trip to AI Image Gen to make
// one. This module holds the parts of that which are worth testing on their own.
//
// The checks below are the honest ones, done BEFORE the icon travels anywhere: Play rejects a
// non-square icon and anything under 512×512, and finding that out at upload time is far kinder than
// finding it out from a store rejection days later.

/** Play Store's minimum, and the size Capacitor's asset generator expects as its source. */
export const MIN_ICON_PX = 512;

/** Anything larger is refused before it is sent — a 20 MB photo is never an app icon. */
export const MAX_ICON_BYTES = 5 * 1024 * 1024;

export interface IconCheck {
  ok: boolean;
  /** Present when ok — a data: URL ready to store and send. */
  dataUrl?: string;
  width?: number;
  height?: number;
  /** Present when ok is false — what is wrong, in words the user can act on. */
  error?: string;
  /** True when the icon is usable but not ideal (e.g. smaller than Play wants). */
  warning?: string;
}

/** The image types both browsers and the Android asset pipeline handle. */
const ACCEPTED = /^image\/(png|jpeg|jpg|webp)$/i;

export function isAcceptedImageType(type: string): boolean {
  return ACCEPTED.test(type || '');
}

/**
 * Validate an already-decoded icon.
 *
 * Split out from the reading so it can be tested without a DOM: the size rules are the part that
 * actually decides whether the user's app gets rejected by Play.
 */
export function judgeIcon(width: number, height: number, bytes: number): IconCheck {
  if (bytes > MAX_ICON_BYTES) {
    return { ok: false, error: `That image is ${(bytes / 1024 / 1024).toFixed(1)} MB. Please pick one under 5 MB.` };
  }
  if (!width || !height) {
    return { ok: false, error: 'That file could not be read as an image.' };
  }
  if (width !== height) {
    return {
      ok: false,
      error: `An app icon must be a perfect square, but this one is ${width}×${height}. Crop it square and try again.`,
    };
  }
  if (width < MIN_ICON_PX) {
    return {
      ok: true,
      width,
      height,
      warning: `This icon is ${width}×${width}. The Play Store needs at least ${MIN_ICON_PX}×${MIN_ICON_PX}, so it will look blurry — a bigger one is worth using.`,
    };
  }
  return { ok: true, width, height };
}

/**
 * Read a picked or pasted image, check it, and return it as a data URL.
 *
 * Browser-only (it decodes with an Image), which is why the judgement above is separate.
 */
export async function readIconFile(file: File | Blob): Promise<IconCheck> {
  const type = (file as File).type || '';
  if (!isAcceptedImageType(type)) {
    return { ok: false, error: 'Please choose a PNG, JPG or WebP image.' };
  }
  if (file.size > MAX_ICON_BYTES) {
    return { ok: false, error: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please pick one under 5 MB.` };
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  }).catch(() => '');

  if (!dataUrl.startsWith('data:image/')) {
    return { ok: false, error: 'That file could not be read as an image.' };
  }

  const dims = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });

  const verdict = judgeIcon(dims.w, dims.h, file.size);
  return verdict.ok ? { ...verdict, dataUrl } : verdict;
}

/**
 * Pull an image off the clipboard — the one AI Image Gen puts there as a real PNG.
 *
 * Reports the two failure modes separately because they need different actions: a browser that will
 * not allow clipboard reads at all, versus a clipboard that simply holds no picture. Split out from
 * `readIconFromClipboard` so the store's icon rules and the APK's icon rules can share ONE clipboard
 * reader instead of growing a second copy that drifts (rule 4, step 2).
 */
export interface ClipboardImage {
  ok: boolean;
  /** Present when ok. */
  blob?: Blob;
  /** Present when ok is false — what to do about it, in words the user can act on. */
  error?: string;
}

export async function readImageBlobFromClipboard(): Promise<ClipboardImage> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clip || typeof clip.read !== 'function') {
    return { ok: false, error: 'This browser will not let a page read the clipboard. Save the image and use Upload instead.' };
  }
  try {
    const items = await clip.read();
    for (const item of items) {
      const type = item.types.find((t) => isAcceptedImageType(t));
      if (!type) continue;
      return { ok: true, blob: await item.getType(type) };
    }
    return { ok: false, error: 'There is no picture on the clipboard. Copy your icon from AI Image Gen first.' };
  } catch {
    // A denied permission and a genuinely empty clipboard look identical here, so the message covers both.
    return { ok: false, error: 'Could not read the clipboard. Allow clipboard access, or save the image and use Upload.' };
  }
}

/** Take the image the user copied and judge it by the Play Store's rules (APK Builder). */
export async function readIconFromClipboard(): Promise<IconCheck> {
  const clip = await readImageBlobFromClipboard();
  if (!clip.ok || !clip.blob) return { ok: false, error: clip.error || 'There is no picture on the clipboard.' };
  return await readIconFile(clip.blob);
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE LISTING ICONS — the same three ways in, a different size rule
//
// WHY A SECOND POLICY (admin 2026-08-19: "add app icon ke sath 2 option aur — make icon, paste"):
// the App Mart listing icon travels inside the publish REQUEST as a data URL, and the publish route
// refuses one at/over 200,000 characters. A picture straight out of AI Image Gen is a 1024×1024 PNG —
// comfortably over that. So "Paste" would have been a button that always answered "too large", which
// is exactly the dead-end this repo forbids.
//
// The fix is not a bigger error message, it is to FIT the image: draw it square, shrink, and step down
// the encoding until it fits. Nothing is refused for being big or the wrong shape any more — the icon
// is simply made into one. The APK path keeps its stricter rules (Play really does reject a non-square
// or under-512 icon, and cropping someone's app icon behind their back there would be worse than
// telling them).
// ─────────────────────────────────────────────────────────────────────────────

/** The publish route refuses at 200,000 chars; stop short so a rounding difference can never trip it. */
export const STORE_ICON_MAX_CHARS = 190_000;

/** The square the listing icon is drawn into — Play's minimum, and plenty for a store card. */
export const STORE_ICON_PX = 512;

/**
 * The ladder tried in order until the encoded icon fits. PNG first (crisp edges, transparency — what a
 * generated icon usually wants), then JPEG at falling quality/size, which is what actually gets a
 * detailed AI illustration under the cap.
 */
export interface IconEncodeAttempt {
  px: number;
  mime: 'image/png' | 'image/jpeg';
  quality?: number;
}
export const STORE_ICON_ATTEMPTS: readonly IconEncodeAttempt[] = [
  { px: STORE_ICON_PX, mime: 'image/png' },
  { px: STORE_ICON_PX, mime: 'image/jpeg', quality: 0.9 },
  { px: 384, mime: 'image/jpeg', quality: 0.85 },
  { px: 256, mime: 'image/jpeg', quality: 0.8 },
  { px: 192, mime: 'image/jpeg', quality: 0.7 },
];

/**
 * Walk the ladder until an encoding fits under `maxChars`.
 *
 * The encoder is a parameter so this — the part that decides — is testable without a canvas, and so
 * the same decision runs everywhere instead of being re-implemented per screen.
 */
export async function fitIconToLimit(
  encode: (attempt: IconEncodeAttempt) => Promise<string>,
  maxChars = STORE_ICON_MAX_CHARS,
  attempts: readonly IconEncodeAttempt[] = STORE_ICON_ATTEMPTS,
): Promise<IconCheck> {
  let lastLength = 0;
  for (const attempt of attempts) {
    let out = '';
    try {
      out = await encode(attempt);
    } catch {
      continue; // one encoding failing (e.g. no JPEG support) must not lose the whole ladder
    }
    if (!out.startsWith('data:image/')) continue;
    lastLength = out.length;
    if (out.length < maxChars) return { ok: true, dataUrl: out, width: attempt.px, height: attempt.px };
  }
  return {
    ok: false,
    error: lastLength
      ? 'That picture is too detailed to use as an icon. Try a simpler image, or one with fewer colours.'
      : 'That image could not be prepared as an icon on this device.',
  };
}

/**
 * Draw `dataUrl` centre-cropped into a square of `px` and encode it. Browser-only.
 *
 * Centre-crop (not letterbox) because the store card renders the icon with `object-cover` — cropping
 * here means the preview the user approves is exactly the picture the card will show.
 */
function squareEncoder(dataUrl: string): (attempt: IconEncodeAttempt) => Promise<string> {
  let loaded: Promise<HTMLImageElement> | null = null;
  const load = () => (loaded ??= new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = dataUrl;
  }));

  return async ({ px, mime, quality }) => {
    const img = await load();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('decode failed');
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(
      img,
      Math.round((img.naturalWidth - side) / 2), Math.round((img.naturalHeight - side) / 2), side, side,
      0, 0, px, px,
    );
    return canvas.toDataURL(mime, quality);
  };
}

/** Read a picked/pasted image and turn it into a listing icon that is guaranteed to fit. */
export async function readStoreIcon(file: File | Blob): Promise<IconCheck> {
  const type = (file as File).type || '';
  if (!isAcceptedImageType(type)) {
    return { ok: false, error: 'Please choose a PNG, JPG or WebP image.' };
  }
  if (file.size > MAX_ICON_BYTES) {
    return { ok: false, error: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please pick one under 5 MB.` };
  }
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
  if (!dataUrl.startsWith('data:image/')) {
    return { ok: false, error: 'That file could not be read as an image.' };
  }
  return await fitIconToLimit(squareEncoder(dataUrl));
}

/** The clipboard route into the same pipeline — "copy in AI Image Gen, come back, press Paste". */
export async function readStoreIconFromClipboard(): Promise<IconCheck> {
  const clip = await readImageBlobFromClipboard();
  if (!clip.ok || !clip.blob) return { ok: false, error: clip.error || 'There is no picture on the clipboard.' };
  return await readStoreIcon(clip.blob);
}
