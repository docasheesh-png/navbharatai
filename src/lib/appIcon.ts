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
 * Take the image the user copied — the one AI Image Gen puts on the clipboard as a real PNG.
 *
 * Reports the two failure modes separately because they need different actions: a browser that will
 * not allow clipboard reads at all, versus a clipboard that simply holds no picture.
 */
export async function readIconFromClipboard(): Promise<IconCheck> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clip || typeof clip.read !== 'function') {
    return { ok: false, error: 'This browser will not let a page read the clipboard. Save the image and use Upload instead.' };
  }
  try {
    const items = await clip.read();
    for (const item of items) {
      const type = item.types.find((t) => isAcceptedImageType(t));
      if (!type) continue;
      const blob = await item.getType(type);
      return await readIconFile(blob);
    }
    return { ok: false, error: 'There is no picture on the clipboard. Copy your icon from AI Image Gen first.' };
  } catch {
    // A denied permission and a genuinely empty clipboard look identical here, so the message covers both.
    return { ok: false, error: 'Could not read the clipboard. Allow clipboard access, or save the image and use Upload.' };
  }
}
