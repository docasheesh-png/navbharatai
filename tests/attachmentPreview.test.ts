import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  scaleDecision,
  isResizableImage,
  jpegName,
  SEND_MAX_EDGE,
  PREVIEW_MAX_EDGE,
  SKIP_BELOW_BYTES,
} from '../src/lib/attachmentPreview';

/**
 * THE LEAK THIS FIXES (measured, Phase 2 of the Google Play 2027 work).
 *
 * `useChatEngine` read every uploaded file with `readAsDataURL` and kept the FULL base64 string in
 * the message object, which is never trimmed. Base64 inflates ~1.37x and a data URL is an ordinary
 * JS string — anonymous memory, exactly what Google's Feb-2027 metric counts. Ten phone photos held
 * ~55 MB for the session: a rising P90 against a flat P50, which is the 3.5x ratio Google names as a
 * leak signal.
 *
 * Only `scaleDecision` and the small helpers are unit-testable — everything else needs a canvas.
 * That is precisely why the sizing RULE was extracted as a pure function instead of living inline.
 */

describe('scaleDecision — the sizing rule', () => {
  it('shrinks a phone photo to the preview edge', () => {
    const d = scaleDecision(4032, 3024, 4_000_000, PREVIEW_MAX_EDGE);
    expect(d.resize).toBe(true);
    expect(d.why).toBe('downscaled');
    expect(Math.max(d.width, d.height)).toBe(PREVIEW_MAX_EDGE);
    // Aspect ratio is preserved, or the preview would look wrong rather than merely smaller.
    expect(d.width / d.height).toBeCloseTo(4032 / 3024, 2);
  });

  it('NEVER scales up — a small avatar must not become a bigger re-encode', () => {
    // The bug this prevents is subtle: "resize to 512" applied to a 100px image produces a LARGER
    // file than the original, so a memory fix would have increased memory.
    const d = scaleDecision(100, 100, 5_000, PREVIEW_MAX_EDGE);
    expect(d.resize).toBe(false);
    expect(d.why).toBe('too-small');
  });

  it('leaves a small file alone even at an awkward size', () => {
    expect(scaleDecision(400, 300, SKIP_BELOW_BYTES - 1, PREVIEW_MAX_EDGE).resize).toBe(false);
  });

  it('still re-encodes a HEAVY file that is already within the edge limit', () => {
    // A 500x400 PNG screenshot can be several MB. It needs no resize but does need JPEG.
    const d = scaleDecision(500, 400, 3_000_000, PREVIEW_MAX_EDGE);
    expect(d.resize).toBe(true);
    expect(d.why).toBe('already-within');
    expect(d.width).toBe(500);
  });

  it('keeps the original when the browser could not read dimensions', () => {
    // Guessing dimensions produces a visibly broken preview; keeping the original does not.
    for (const [w, h] of [[0, 0], [-1, 10], [NaN, 10], [10, Infinity]] as Array<[number, number]>) {
      const d = scaleDecision(w, h, 1_000_000, PREVIEW_MAX_EDGE);
      expect(d.resize, `${w}x${h}`).toBe(false);
      expect(d.why).toBe('unknown-dimensions');
    }
  });

  it('the two sizes are genuinely different jobs', () => {
    // SEND is what the vision model sees; PREVIEW is what sits in the bubble forever. Collapsing
    // them back into one number is what caused the leak.
    expect(SEND_MAX_EDGE).toBe(1568);
    expect(PREVIEW_MAX_EDGE).toBe(512);
    expect(PREVIEW_MAX_EDGE).toBeLessThan(SEND_MAX_EDGE);
  });

  it('the preview edge really is ~100x cheaper than a camera photo', () => {
    const photo = scaleDecision(4032, 3024, 4_000_000, PREVIEW_MAX_EDGE);
    const photoPixels = 4032 * 3024;
    const previewPixels = photo.width * photo.height;
    expect(photoPixels / previewPixels).toBeGreaterThan(50);
  });
});

describe('isResizableImage', () => {
  it('accepts rasters', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) {
      expect(isResizableImage(t), t).toBe(true);
    }
  });

  it('excludes SVG — it is markup, and rasterising it throws away the point of it', () => {
    expect(isResizableImage('image/svg+xml')).toBe(false);
  });

  it('excludes non-images, which get no dataUrl at all', () => {
    // The UI renders these as a name chip, so a 20 MB base64 PDF was being retained purely to never
    // be looked at.
    for (const t of ['application/pdf', 'text/plain', '', undefined, null]) {
      expect(isResizableImage(t as string)).toBe(false);
    }
  });
});

describe('jpegName', () => {
  it('renames a converted image so it does not claim a format it no longer is', () => {
    expect(jpegName('photo.png')).toBe('photo.jpg');
    expect(jpegName('scan.HEIC')).toBe('scan.jpg');
    expect(jpegName('already.jpg')).toBe('already.jpg');
    expect(jpegName('no-extension')).toBe('no-extension.jpg');
    expect(jpegName('')).toBe('image.jpg');
  });

  it('does not eat a dot that is part of the name', () => {
    expect(jpegName('v1.2.report.png')).toBe('v1.2.report.jpg');
  });
});

// ── The wiring, and the two things that must stay true ──────────────────────────────────────────
describe('useChatEngine uses the shared helper, and still sends the full file', () => {
  const src = readFileSync(join(process.cwd(), 'src/hooks/useChatEngine.ts'), 'utf8');

  it('the retained preview goes through previewAttachment', () => {
    expect(src).toContain("import { previewAttachment } from '../lib/attachmentPreview'");
    expect(src).toContain('await Promise.all(files.map(previewAttachment))');
  });

  it('the OLD full-size read is gone', () => {
    // This is the actual leak: readAsDataURL on the whole file, stored into message state.
    expect(src).not.toContain('reader.readAsDataURL(f)');
  });

  it('what the MODEL receives is untouched — the preview was never the payload', () => {
    // The entire safety argument for shrinking the preview rests on this line existing. If a refactor
    // ever routes the payload through the preview, the model silently starts seeing 512px images.
    expect(src).toContain('fileAttachments: files.length > 0 ? await filesToBase64(files) : undefined');
  });
});

describe('Doctor AI is deliberately left alone', () => {
  const sda = readFileSync(join(process.cwd(), 'src/components/sda/SDAChat.tsx'), 'utf8');

  it('keeps its 2400px / 0.92 clinical quality', () => {
    // A documented decision, not an oversight: "a 1mm ST shift or a small q wave can be compression
    // artefact rather than signal, and the doctor may start treatment from that reading." Shrinking
    // the retained copy there is not a free memory win — it degrades what a clinician zooms into.
    expect(sda).toContain('maxDim = 2400');
    expect(sda).toContain('quality = 0.92');
  });
});
