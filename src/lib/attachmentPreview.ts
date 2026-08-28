/**
 * ONE image-downscaler for attachments, because there were already two and one of them leaked.
 *
 * THE LEAK (measured, Phase 2 of the Google Play 2027 work). `useChatEngine.ts` read every uploaded
 * file with `readAsDataURL` and stored the FULL base64 string in the message object — and the
 * messages array is never trimmed. Base64 inflates ~1.37x and a data URL is an ordinary JS string,
 * i.e. anonymous memory, which is exactly what Google's Feb-2027 metric counts:
 *
 *     one phone photo   ~4 MB  →  ~5.5 MB retained
 *     ten over a session ~40 MB → ~55 MB retained, until reload
 *
 * That is a rising P90 against a flat P50 — the 3.5x ratio Google names as a leak signal.
 *
 * ONE VALUE WAS DOING TWO JOBS, which is the actual root cause. The same string both DISPLAYED the
 * image in a 64x64 chat bubble and WAS the retained record of the attachment. A thumbnail does not
 * need 4 MB, but while it is the same string as the archive copy, shrinking one looks like
 * discarding the other.
 *
 * WHY SHRINKING IT LOSES NOTHING — verified, not assumed. `useChatEngine` sends the attachment to the
 * backend SEPARATELY (`fileAttachments: await filesToBase64(files)`), so the preview is purely for
 * display. The AI receives exactly what it received before. The file itself was never persisted
 * client-side; only a preview of it was. That is what keeps this inside CLAUDE.md rule 12 — no user
 * data is discarded, because none of it was being kept here in the first place.
 *
 * WHY THIS FILE EXISTS RATHER THAN A THIRD IMPLEMENTATION. `AgentV3Panel.tsx` already had a correct
 * downscaler — canvas, skip-if-small, revoke the object URL, fall back to a raw read on any failure —
 * and it is also why the builder chat never leaked: it keeps no attachment in message state at all.
 * `useChatEngine` hand-rolled a worse one. Per CLAUDE.md rule 2 the fix for a drifted duplicate is to
 * CENTRALISE, so this is that one implementation, and the two call sites now differ only in the size
 * they ask for.
 *
 * TWO SIZES, because they are genuinely two jobs:
 *   • SEND   — 1568 px, what the vision model should see. Not retained.
 *   • PREVIEW —  512 px, what sits in the bubble forever. This is the one that had to shrink.
 */

/** What the vision model receives. Matches the value AgentV3Panel has used since 2026-07. */
export const SEND_MAX_EDGE = 1568;

/**
 * What is RETAINED in message state. A chat bubble renders at 64x64 and the lightbox at screen size,
 * so 512 is generous for both while being ~100x cheaper than a 4000px camera photo.
 */
export const PREVIEW_MAX_EDGE = 512;

/** Below this, re-encoding costs more than it saves and can make a small PNG bigger. */
export const SKIP_BELOW_BYTES = 200 * 1024;

/** JPEG quality for a downscaled preview — visually clean at thumbnail and lightbox size. */
export const PREVIEW_QUALITY = 0.82;

export interface ScaleDecision {
  /** Re-encode at all? False means "use the original bytes as-is". */
  resize: boolean;
  width: number;
  height: number;
  why: 'too-small' | 'already-within' | 'downscaled' | 'unknown-dimensions';
}

/**
 * Decide whether and how far to scale. PURE, so the sizing rule is testable without a DOM — which
 * matters because everything else here needs a canvas and cannot be unit-tested at all.
 *
 * Never scales UP: `Math.min(1, …)`. A 100px avatar must not become a 512px re-encode that is larger
 * than the file it replaced.
 */
export function scaleDecision(
  width: number,
  height: number,
  bytes: number,
  maxEdge: number,
): ScaleDecision {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    // A browser that could not decode the image gives us nothing to reason about. Keep the original
    // rather than guessing at dimensions — a wrong guess produces a visibly broken preview.
    return { resize: false, width: 0, height: 0, why: 'unknown-dimensions' };
  }
  const longest = Math.max(width, height);
  const scale = Math.min(1, maxEdge / longest);

  if (scale === 1 && bytes <= SKIP_BELOW_BYTES) {
    return { resize: false, width, height, why: 'too-small' };
  }
  if (scale === 1) {
    // Within the edge limit but a heavy file (a large PNG screenshot). Re-encoding to JPEG still wins.
    return { resize: true, width, height, why: 'already-within' };
  }
  return {
    resize: true,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    why: 'downscaled',
  };
}

/**
 * SVG is deliberately excluded from the image path. It is markup, not a raster: a canvas re-encode
 * would rasterise it at one fixed size and throw away the one property that makes it worth having.
 * It is small anyway, so it costs nothing to keep whole.
 */
export function isResizableImage(type: string | undefined | null): boolean {
  const t = String(type || '');
  return t.startsWith('image/') && t !== 'image/svg+xml';
}

/** A downscaled JPEG loses its original extension; the name should not claim otherwise. */
export function jpegName(name: string): string {
  return String(name || 'image').replace(/\.(png|webp|gif|bmp|heic|heif|jpeg|jpg)$/i, '') + '.jpg';
}

/** Read a File as a data URL, unchanged. The fallback for every path that cannot or should not resize. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

/**
 * Produce a data URL for `file`, downscaled to `maxEdge` when that helps.
 *
 * NEVER REJECTS, and never returns nothing when the original was readable. Every failure path —
 * a non-image, a decode error, no 2D context, a canvas that throws — falls back to the untouched
 * read. An attachment preview is a convenience; losing the user's image to save memory would be a
 * far worse bug than the one this fixes.
 */
export async function downscaledDataUrl(file: File, maxEdge: number): Promise<string> {
  if (typeof document === 'undefined' || !isResizableImage(file?.type)) {
    return readAsDataUrl(file);
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img) return await readAsDataUrl(file);

    const d = scaleDecision(img.width, img.height, file.size, maxEdge);
    if (!d.resize) return await readAsDataUrl(file);

    const canvas = document.createElement('canvas');
    canvas.width = d.width;
    canvas.height = d.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return await readAsDataUrl(file);
    ctx.drawImage(img, 0, 0, d.width, d.height);
    return canvas.toDataURL('image/jpeg', PREVIEW_QUALITY);
  } catch {
    return await readAsDataUrl(file);
  } finally {
    // ALWAYS, on every path. This helper exists to reduce memory; leaking an object URL out of it
    // would be its own small version of the bug.
    URL.revokeObjectURL(url);
  }
}

export interface PreviewAttachment {
  name: string;
  type: string;
  dataUrl?: string;
}

/**
 * The display-only attachment record kept in message state.
 *
 * A non-image gets NO dataUrl at all — the UI already renders those as a name chip (`📎 report.pdf`),
 * so a 20 MB base64 PDF was being retained purely to never be looked at.
 */
export async function previewAttachment(file: File): Promise<PreviewAttachment> {
  if (!isResizableImage(file?.type)) {
    return { name: file.name, type: file.type || 'application/octet-stream' };
  }
  const dataUrl = await downscaledDataUrl(file, PREVIEW_MAX_EDGE);
  if (!dataUrl) return { name: file.name, type: file.type };
  const resized = dataUrl.startsWith('data:image/jpeg');
  return {
    name: resized ? jpegName(file.name) : file.name,
    type: resized ? 'image/jpeg' : file.type,
    dataUrl,
  };
}
