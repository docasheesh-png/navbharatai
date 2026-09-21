// Running ONE edit of a picture the user supplied — the single implementation, for every surface.
//
// 🔴 WHY IT IS ITS OWN MODULE. Two surfaces do this now: the image generator's route and FREE CHAT,
// where somebody attaches a photo and says "remove the background". A second copy of "which rung can
// edit, what is it told, and what counts as a refusal" is the drifted-copy class this repo has paid
// for four times (`safeRelPath` ×4, `tagsOnLine` ×2, the HTML boot guard ×2, the Playwright browser
// path ×2) — and here the drift would be invisible: both copies would return pictures.
//
// 🔑 THE FREE PROVIDER CANNOT SERVE THIS, and that is a fact about the request rather than a policy.
// Pollinations takes a prompt inside a URL; it has no way to receive a picture that exists only
// inside this request, and publishing a user's photograph somewhere it could fetch is not something
// we will do to make a feature work. So an edit is served by the multimodal rung the ladder already
// has, and every caller must meter it as the PAID rung it is.

import { buildEditInstruction, editIntentFor } from '../../lib/imageEdit';
import {
  extractResponseText, geminiImageConfigured, imageGenModels, isImageRefusal,
  parseImagePartsResponse, type GeneratedImage,
} from './imageGen';
import { initImageTooLarge, parseDataUrl } from './imageProGen';

export interface ImageEditOutcome {
  /** The edited picture. Present only on success. */
  image?: GeneratedImage;
  /** The model declined (a real face, a brand, an unsafe request) — the user must change the ask. */
  refusal?: boolean;
  /** A per-rung diagnostic, for ADMIN eyes and server logs only. Never shown to a user. */
  diag?: string[];
  /** Set when the request itself is wrong, with a user-safe reason. */
  badInput?: string;
  /** True when no rung on this server can edit a picture at all. */
  unavailable?: boolean;
}

/** How long one edit may take before we give up. Matches the generator route's own ceiling. */
export const IMAGE_EDIT_TIMEOUT_MS = 60_000;

/**
 * Is this request a well-formed edit we could actually serve? Checked BEFORE a wallet is touched,
 * so a picture we were never going to be able to read costs the user nothing.
 *
 * PURE apart from reading the environment.
 */
export function checkEditable(dataUrl: string): { ok: true } | { ok: false; outcome: ImageEditOutcome } {
  if (!parseDataUrl(dataUrl)) {
    return { ok: false, outcome: { badInput: 'That picture could not be read. Please attach a JPG or PNG.' } };
  }
  if (initImageTooLarge(dataUrl)) {
    return { ok: false, outcome: { badInput: 'That picture is too large. Please use one under 8 MB.' } };
  }
  if (!geminiImageConfigured()) return { ok: false, outcome: { unavailable: true } };
  return { ok: true };
}

/**
 * Edit the picture. The words are wrapped in the shared preservation brief (`buildEditInstruction`)
 * and NOTHING else is added — in particular no art direction, whose every rule is an instruction to
 * re-compose the photograph the user asked us to keep.
 *
 * Never returns a placeholder: no image is an honest failure.
 */
export async function runImageEdit(
  dataUrl: string,
  words: string,
  opts: { timeoutMs?: number } = {},
): Promise<ImageEditOutcome> {
  const editable = checkEditable(dataUrl);
  if (!editable.ok) return editable.outcome;
  const parsed = parseDataUrl(dataUrl)!;
  const said = String(words || '').trim();
  const prompt = buildEditInstruction(said, editIntentFor(said));

  const { GoogleGenAI } = await import('@google/genai');
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });
  const ceiling = opts.timeoutMs ?? IMAGE_EDIT_TIMEOUT_MS;
  const diag: string[] = [];
  let sawRefusal = false;

  for (const model of imageGenModels()) {
    try {
      const result: any = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } },
              { text: prompt },
            ],
          }],
          config: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('image-edit timeout')), ceiling)),
      ]);
      const img = parseImagePartsResponse(result);
      if (img) return { image: img, diag };
      if (isImageRefusal(result)) {
        sawRefusal = true;
        console.warn(`[IMAGE_EDIT] ${model} declined: ${extractResponseText(result) || 'no reason given'}`);
      } else {
        diag.push(`${model}: no image part (${extractResponseText(result)?.slice(0, 120) || 'empty response'})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      diag.push(`${model}: ${msg.slice(0, 160)}`);
      console.warn(`[IMAGE_EDIT] ${model} failed: ${msg}`);
    }
  }
  return { refusal: sawRefusal, diag };
}
