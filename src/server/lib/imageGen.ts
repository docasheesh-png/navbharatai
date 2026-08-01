// AI Image Gen — pure prompt/response core (admin autopsy 2026-07-20).
//
// WHY THIS EXISTS: the Settings → AI Tools → AI Image Gen tile shipped without ANY server side —
// the client hot-linked a third-party free image site directly from the browser (unreliable,
// unbranded, outside our control; the admin reported it simply doesn't work). This module is the
// pure core of the REAL implementation: the /api/image/generate route calls our own configured
// image model (via the same @google/genai SDK + GEMINI_API_KEY the vision chain already uses) and
// parses the reply with parseImagePartsResponse. Pure → unit-testable.
//
// WHITE-LABEL: user-facing strings never name the underlying model/vendor — the engine is
// "NavBharatAI". Model ids live here (env-tunable) and appear only in server logs.

export interface ImageGenRequest {
  prompt: string;
  style?: string;
  size?: string;
}

export interface GeneratedImage {
  mimeType: string;
  base64: string;
}

const MAX_PROMPT_CHARS = 2_000;

/** Style id → prompt enhancer. Mirrors the client's style chips (kept in sync by the shared test). */
export const IMAGE_STYLE_ENHANCERS: Record<string, string> = {
  minimal: 'minimalist, clean white background, simple shapes',
  vibrant: 'vibrant colors, high contrast, bold, colorful',
  dark: 'dark background, neon accents, moody, cinematic',
  gradient: 'smooth gradient, colorful gradient background',
  flat: 'flat design, 2D, vector style, no shadows',
  '3d': '3D render, isometric, depth, shadows, realistic',
};

/** Size id → aspect-ratio hint (the model takes ratios, not exact pixels). */
export const IMAGE_SIZE_RATIOS: Record<string, string> = {
  square: '1:1',
  wide: '16:9',
  portrait: '3:4',
  icon: '1:1',
};

/**
 * The model ladder for image generation, newest→older, env-tunable via IMAGE_GEN_MODEL (comma
 * list) without a deploy — same discipline as the other model ladders (Decision "A").
 */
export function imageGenModels(): string[] {
  const env = (process.env.IMAGE_GEN_MODEL || '').trim();
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
  // Newest→older. The `-preview` id is included as a fallback because the GA id is not live on every
  // key/region yet; a wrong id simply throws and the ladder falls through (comma-ladder discipline), so
  // adding a rung can only help. Tune without a deploy via IMAGE_GEN_MODEL.
  return [
    'gemini-2.5-flash-image',
    'gemini-2.5-flash-image-preview',
    'gemini-2.0-flash-preview-image-generation',
  ];
}

/** Compose the full image prompt from the user's text + style + aspect hint. Pure, bounded. */
/**
 * A prompt that asks for a MAP OF INDIA. India-first (admin 2026-07-23): such an image must use the
 * official map of India (Government of India / Survey of India). Deliberately narrow — only fires when
 * BOTH "India" and a map/boundary word appear — so an unrelated image is never touched.
 */
export function wantsIndiaMap(prompt: string): boolean {
  const p = (prompt || '').toLowerCase();
  const india = /\bindia\b|\bbharat\b|भारत|इंडिया/.test(p);
  const map = /\bmap\b|\bmaps\b|naksha|नक्शा|\bborder\b|\bboundary\b|\bboundaries\b|cartograph/.test(p);
  return india && map;
}

/** Appended to a map-of-India image prompt so the render uses India's official boundaries. */
export const INDIA_MAP_IMAGE_DIRECTIVE =
  'This is a map of India: use the OFFICIAL map of India as published by the Government of India ' +
  '(Survey of India) — Jammu & Kashmir and Ladakh (including Aksai Chin and Pakistan-occupied Kashmir/' +
  'Gilgit-Baltistan) and Arunachal Pradesh are shown as integral parts of India, with the complete ' +
  'official boundary. Do not use a foreign or “neutral” boundary.';

export function buildImagePrompt(req: ImageGenRequest): string {
  const base = String(req.prompt || '').trim().slice(0, MAX_PROMPT_CHARS);
  const enhancer = IMAGE_STYLE_ENHANCERS[req.style || ''] || '';
  const ratio = IMAGE_SIZE_RATIOS[req.size || ''] || '';
  const parts = [base];
  if (enhancer) parts.push(`Style: ${enhancer}.`);
  if (ratio) parts.push(`Aspect ratio ${ratio}.`);
  if (wantsIndiaMap(base)) parts.push(INDIA_MAP_IMAGE_DIRECTIVE);
  return parts.join(' ');
}

/**
 * Extract the first generated image from a generateContent-style response's candidate parts.
 * Returns null when no image part exists (an honest "no image" — the route reports failure,
 * never a placeholder).
 */
export function parseImagePartsResponse(resp: unknown): GeneratedImage | null {
  const candidates = (resp as any)?.candidates;
  if (!Array.isArray(candidates)) return null;
  for (const cand of candidates) {
    const parts = cand?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      const data = p?.inlineData?.data;
      if (typeof data === 'string' && data.length > 0) {
        const mimeType = typeof p.inlineData.mimeType === 'string' && p.inlineData.mimeType
          ? p.inlineData.mimeType : 'image/png';
        return { mimeType, base64: data };
      }
    }
  }
  return null;
}

/** Finish/block reasons that mean the model DECLINED for policy reasons — a content refusal, NOT an outage. */
const REFUSAL_FINISH_RE = /SAFETY|PROHIBITED|RECITATION|BLOCK|IMAGE_SAFETY|SPII|COPYRIGHT/i;

/**
 * The model's own first text explanation from a no-image response (e.g. a refusal reason), trimmed —
 * null when there is none. Used only for server logs; NEVER surfaced verbatim to the user (white-label).
 */
export function extractResponseText(resp: unknown): string | null {
  const candidates = (resp as any)?.candidates;
  if (!Array.isArray(candidates)) return null;
  for (const cand of candidates) {
    const parts = cand?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (typeof p?.text === 'string' && p.text.trim()) return p.text.trim();
    }
  }
  return null;
}

/**
 * True when a NO-IMAGE response is a content REFUSAL (the model declined — a real brand, public figure,
 * copyrighted character, or unsafe request) rather than a transient/system failure. This is the key
 * distinction that makes the error HONEST (rule 5): a refusal must tell the user to change the prompt,
 * NOT "try again in a minute" (which never works). Detected from an explicit block/finish reason, or from
 * a 200 response that carries a text explanation but no image (a soft refusal). Pure.
 */
export function isImageRefusal(resp: unknown): boolean {
  const r = resp as any;
  const block = r?.promptFeedback?.blockReason;
  if (typeof block === 'string' && block) return true;
  const candidates = r?.candidates;
  if (Array.isArray(candidates)) {
    for (const c of candidates) {
      if (typeof c?.finishReason === 'string' && REFUSAL_FINISH_RE.test(c.finishReason)) return true;
    }
  }
  // A response that produced TEXT but no image, for a dedicated image request, is in practice a soft
  // refusal (the model is explaining why it didn't draw it) — treat it as "change the prompt", not transient.
  return extractResponseText(resp) !== null && parseImagePartsResponse(resp) === null;
}

/**
 * The honest, WHITE-LABEL, actionable message for a content refusal — the app is "NavBharatAI", no vendor
 * named, and it tells the user the real reason (their prompt) and how to succeed, instead of a misleading
 * "server busy, try again". This is the message the "spiderman" case should have shown.
 */
export const IMAGE_REFUSAL_MESSAGE =
  'NavBharatAI couldn’t create this image. This usually happens when the request names a real brand, a ' +
  'public figure, or a copyrighted character (like a movie or comic hero) — or asks for content it can’t ' +
  'generate. Try describing an ORIGINAL design instead (for example: “a friendly web-slinging superhero in ' +
  'a red and blue suit”, not a named character).';

/** Request guard for the route. */
export function isValidImageGenRequest(body: unknown): body is ImageGenRequest {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (typeof b.prompt !== 'string' || !b.prompt.trim()) return false;
  if (b.style !== undefined && typeof b.style !== 'string') return false;
  if (b.size !== undefined && typeof b.size !== 'string') return false;
  return true;
}

/** True when an image-generation key is configured (same env chain the vision path uses). */
export function imageGenConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY);
}
