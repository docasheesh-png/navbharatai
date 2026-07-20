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
  return ['gemini-2.5-flash-image', 'gemini-2.0-flash-preview-image-generation'];
}

/** Compose the full image prompt from the user's text + style + aspect hint. Pure, bounded. */
export function buildImagePrompt(req: ImageGenRequest): string {
  const base = String(req.prompt || '').trim().slice(0, MAX_PROMPT_CHARS);
  const enhancer = IMAGE_STYLE_ENHANCERS[req.style || ''] || '';
  const ratio = IMAGE_SIZE_RATIOS[req.size || ''] || '';
  const parts = [base];
  if (enhancer) parts.push(`Style: ${enhancer}.`);
  if (ratio) parts.push(`Aspect ratio ${ratio}.`);
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
