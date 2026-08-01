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

/** Size id → concrete pixel dimensions (for providers that take width/height, e.g. Pollinations). */
export const IMAGE_SIZE_PIXELS: Record<string, { w: number; h: number }> = {
  square: { w: 1024, h: 1024 },
  wide: { w: 1280, h: 720 },
  portrait: { w: 768, h: 1024 },
  icon: { w: 512, h: 512 },
};

/** Whether the FREE image provider (Pollinations) is enabled — default ON; kill switch IMAGE_GEN_POLLINATIONS=off. */
export function pollinationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.IMAGE_GEN_POLLINATIONS || '').trim().toLowerCase() !== 'off';
}

/**
 * Build the Pollinations image URL (the FREE provider — no key, no per-image cost). Server-proxied by the
 * route (the bytes are fetched and re-served as a data URL), so — unlike the old raw client hot-link — the
 * user never talks to a third party and the result is branded NavBharatAI. `nologo=true` strips the
 * provider watermark. Pure + bounded. Model is env-tunable via IMAGE_GEN_POLLINATIONS_MODEL (default flux).
 */
export function pollinationsImageUrl(prompt: string, size?: string, env: NodeJS.ProcessEnv = process.env): string {
  const px = IMAGE_SIZE_PIXELS[size || ''] || IMAGE_SIZE_PIXELS.square;
  const model = (env.IMAGE_GEN_POLLINATIONS_MODEL || '').trim() || 'flux';
  const p = encodeURIComponent(String(prompt || '').slice(0, MAX_PROMPT_CHARS));
  return `https://image.pollinations.ai/prompt/${p}?width=${px.w}&height=${px.h}&nologo=true&model=${encodeURIComponent(model)}`;
}

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

/** True when ANY image provider is available — the free Pollinations provider (no key), OR a Gemini key,
 *  OR an xAI/Grok key. With Pollinations on (the default), image generation is always configured. */
export function imageGenConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return pollinationsEnabled(env) || Boolean(
    env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY
    || env.GROK_API_KEY || env.XAI_API_KEY,
  );
}

/** True when only the Gemini key chain is present (used to pick which provider(s) to try). */
export function geminiImageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY);
}

/** The xAI/Grok API key (either accepted env name), or null. Grok is the image FALLBACK provider. */
export function grokImageKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.GROK_API_KEY || env.XAI_API_KEY || null;
}

/** The Grok image model id, env-tunable via IMAGE_GEN_GROK_MODEL (default the current text-to-image model). */
export function grokImageModel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.IMAGE_GEN_GROK_MODEL || '').trim() || 'grok-2-image';
}

/**
 * Generate one image via the FREE Pollinations provider, server-side, returning it as raw base64 (never a
 * placeholder — null-ish result on any failure). SINGLE source of the Pollinations fetch so the /api/image
 * route and the Free-chat inline path can never drift (rule 2/3). `fetchImpl` is injectable for tests.
 * Result: { image } on success | { error } on a real failure | { disabled: true } when the provider is off.
 */
export async function fetchPollinationsImage(
  prompt: string,
  size?: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ image?: GeneratedImage; error?: string; disabled?: boolean }> {
  const env = opts.env ?? process.env;
  if (!pollinationsEnabled(env)) return { disabled: true };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 45_000);
  try {
    const r = await fetchImpl(pollinationsImageUrl(prompt, size, env), { signal: ctl.signal });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok) return { error: `HTTP ${r.status}` };
    if (!ct.startsWith('image/')) return { error: `non-image (${ct || 'unknown'})` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0) return { error: 'empty image body' };
    return { image: { mimeType: ct, base64: buf.toString('base64') } };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

/** A ready-to-embed markdown image for a generated image data URL (renders inline in chat). */
export function imageMarkdown(img: GeneratedImage, alt = 'generated image'): string {
  return `![${alt}](data:${img.mimeType};base64,${img.base64})`;
}

/**
 * Parse the first base64 image out of an xAI /v1/images/generations response. xAI returns
 * `{ data: [{ b64_json: "<...>" }] }` (OpenAI-compatible). Returns null when there is no image
 * (an honest "no image" — the caller reports failure, never a placeholder). Pure.
 */
export function parseGrokImageResponse(resp: unknown): GeneratedImage | null {
  const data = (resp as any)?.data;
  if (!Array.isArray(data)) return null;
  for (const d of data) {
    const b64 = d?.b64_json;
    if (typeof b64 === 'string' && b64.length > 0) return { mimeType: 'image/png', base64: b64 };
  }
  return null;
}
