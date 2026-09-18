// AI Image Studio — the PAID tier (admin-mandated 2026-09-18).
//
// Admin, verbatim: "free image ko aise hi rahne do! paid walo ko inhance karna hai, FLUX.2 Klein 4B
// dwara image banwana hai, 2₹/image fee rakhni hai."
//
// So this module is the paid half ONLY. The free path (Pollinations, ₹0) is untouched and stays the
// default — a user who never opens the toggle sees exactly today's product at exactly today's price.
//
// 🔒 WHITE-LABEL LAW APPLIES TO THIS FILE'S OUTPUT, NOT TO THIS FILE. The model id and the vendor
// live here and in server logs; NOTHING this module returns to a user may name them. The admin named
// the model when specifying the work — that is a build instruction, not permission to print it on a
// screen. Every user-facing string below says "NavBharatAI".
//
// 🔴 THE PRICE IS A DECISION, NOT A MEASUREMENT. ₹2/image is the admin's set price, so the user is
// told ₹2 and charged ₹2 — that is honest by construction and needs no estimate. It is deliberately
// NOT the real-cost + markup model a build uses, because an image provider returns no token usage to
// price from, and THE ONE-WALLET LAW forbids inventing one. What this does mean is that the MARGIN is
// unverified from inside the code: whether ₹2 clears what the host charges is a question only the
// admin's provider invoice can answer. See PROGRESS.md.

export const IMAGE_PRO_PRICE_INR = 2;

/** The most images one request may ask for — a bound on both spend and wall-clock. */
export const IMAGE_PRO_MAX_BATCH = 4;

/** How long one paid generation may take before we give up and charge nothing. */
export const IMAGE_PRO_TIMEOUT_MS = 90_000;

const MAX_PROMPT_CHARS = 2_000;
/** An uploaded reference image, base64, before it is rejected as too large to forward. */
const MAX_INIT_IMAGE_BYTES = 8 * 1024 * 1024;

export type ImageProMode = 'text-to-image' | 'image-to-image' | 'image-text-to-image';

export interface ImageProRequest {
  prompt?: string;
  size?: string;
  /** A reference image as a data URL — turns this into an image-to-image request. */
  initImage?: string;
  /** How far the result may move from the reference, 0..1. Only meaningful with `initImage`. */
  strength?: number;
  count?: number;
}

export interface ProGeneratedImage {
  mimeType: string;
  base64: string;
}

/**
 * Which of the three jobs this request is, decided from what the caller actually sent.
 *
 * The admin asked for all three to be handled ("text to image, image to image, image+text to image
 * yeh sab world class handel kare"), and the honest way to handle three modes is to DERIVE the mode
 * from the payload rather than to add a fourth control the user has to get right. An attached image
 * with no words is a re-imagining; an attached image with words is a directed edit; words alone are
 * a fresh generation. Nobody has to be taught that.
 */
export function imageProMode(req: ImageProRequest): ImageProMode | null {
  const hasPrompt = typeof req.prompt === 'string' && req.prompt.trim().length > 0;
  const hasImage = typeof req.initImage === 'string' && req.initImage.trim().length > 0;
  if (hasImage && hasPrompt) return 'image-text-to-image';
  if (hasImage) return 'image-to-image';
  if (hasPrompt) return 'text-to-image';
  return null; // neither — there is no request here, and the route says so rather than guessing
}

/** How many images this request should produce, clamped to something a wallet and a clock can survive. */
export function imageProCount(req: ImageProRequest): number {
  const n = Math.floor(Number(req.count));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, IMAGE_PRO_MAX_BATCH);
}

/** What this request will cost the user, in ₹ — the number shown to them BEFORE they press go. */
export function imageProQuotedInr(req: ImageProRequest): number {
  return imageProCount(req) * IMAGE_PRO_PRICE_INR;
}

/**
 * The paid host's endpoint. Env-configured because the model is available from several hosts and the
 * admin has not yet chosen one — and because a host's URL is exactly the kind of fact that should be
 * changeable without a deploy (Decision "A", same as every model ladder in this repo).
 */
export function imageProEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  return (env.IMAGE_PRO_ENDPOINT || '').trim();
}

/** The model id, for hosts that take it in the BODY rather than in the path. */
export function imageProModel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.IMAGE_PRO_MODEL || '').trim() || 'flux.2-klein-4b';
}

export function imageProKey(env: NodeJS.ProcessEnv = process.env): string {
  // Trimmed, and whitespace-only counts as unset — the `BRAVE_API_KEY` lesson: a stray newline in a
  // console field would otherwise be a configured-looking key that every call silently rejects.
  return (env.IMAGE_PRO_KEY || '').trim();
}

/**
 * The Authorization header shape. The three plausible hosts disagree, and the disagreement is
 * one word — so it is one env var rather than three code paths.
 *   `key`    → `Authorization: Key <k>`
 *   `bearer` → `Authorization: Bearer <k>`
 *   `x-key`  → `x-key: <k>`
 */
export function imageProAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const key = imageProKey(env);
  if (!key) return {};
  const scheme = (env.IMAGE_PRO_AUTH_SCHEME || '').trim().toLowerCase();
  if (scheme === 'x-key') return { 'x-key': key };
  if (scheme === 'bearer') return { Authorization: `Bearer ${key}` };
  return { Authorization: `Key ${key}` };
}

/**
 * Whether the paid tier can actually run.
 *
 * 🔒 BOTH a key AND an endpoint, and that is the second absolute rule applied: a half-configured paid
 * tier is the "built but not really working" state that must not exist. With either missing the
 * toggle still appears but says, honestly, that Pro is not available yet — never a silent fallback to
 * the free provider, which would charge ₹2 for the picture the user could have had for nothing.
 */
export function imageProConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.IMAGE_PRO_ENABLED || '').trim().toLowerCase() === 'off') return false;
  return imageProKey(env).length > 0 && imageProEndpoint(env).length > 0;
}

/** Strip a data-URL header and report the raw base64 + its mime. Returns null for anything else. */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || '').trim());
  if (!m) return null;
  const base64 = m[2].replace(/\s+/g, '');
  if (!base64) return null;
  return { mimeType: m[1].toLowerCase(), base64 };
}

/** Roughly how many bytes a base64 string decodes to — bounded without decoding it. */
export function base64Bytes(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((len * 3) / 4) - pad;
}

export function initImageTooLarge(dataUrl: string): boolean {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return false;
  return base64Bytes(parsed.base64) > MAX_INIT_IMAGE_BYTES;
}

/**
 * The request body.
 *
 * Deliberately carries BOTH spellings of the common fields (`image_url`/`image`, `num_images`/`n`,
 * `width`/`height` as well as `image_size`) because the hosts that serve this model disagree on
 * names and ignore what they do not recognise. That is not shotgunning: every key here is a real
 * field of at least one of them, and sending a superset is what lets ONE adapter serve whichever the
 * admin signs up for, instead of this shipping broken until the host is known.
 */
export function buildImageProRequest(
  req: ImageProRequest,
  px: { w: number; h: number },
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const prompt = String(req.prompt || '').slice(0, MAX_PROMPT_CHARS);
  const n = imageProCount(req);
  const body: Record<string, unknown> = {
    prompt,
    model: imageProModel(env),
    width: px.w,
    height: px.h,
    image_size: { width: px.w, height: px.h },
    num_images: n,
    n,
    output_format: 'png',
    // The free tier's own 2026-09-18 finding, carried over: without a seed the same brief returns the
    // same picture, and "try again" stops meaning anything.
    seed: Math.floor(Date.now() % 2_147_483_647),
  };
  const mode = imageProMode(req);
  if (mode === 'image-to-image' || mode === 'image-text-to-image') {
    body.image_url = req.initImage;
    body.image = req.initImage;
    // A reference with NO words is a re-imagining and should stay close to the original; a reference
    // WITH words is a directed edit and needs room to follow them. One sensible default each, and an
    // explicit value always wins.
    const dflt = mode === 'image-to-image' ? 0.65 : 0.85;
    const s = Number(req.strength);
    body.strength = Number.isFinite(s) && s > 0 && s <= 1 ? s : dflt;
  }
  return body;
}

/**
 * Pull the first image out of whatever shape the host returned.
 *
 * Handles the four families in use — `{images:[{url}]}`, `{data:[{b64_json|url}]}`,
 * `{result:{sample}}` and `{output:[url]}` — plus a bare data URL. Returns either raw bytes or a URL
 * for the caller to fetch; it never returns a placeholder, so "no image" stays an honest failure.
 */
export function parseImageProResponse(
  resp: unknown,
): { base64: string; mimeType: string } | { url: string } | null {
  const r = resp as any;
  if (!r || typeof r !== 'object') return null;

  const fromEntry = (e: any): { base64: string; mimeType: string } | { url: string } | null => {
    if (!e) return null;
    if (typeof e === 'string') {
      const d = parseDataUrl(e);
      if (d) return d;
      return /^https?:\/\//i.test(e) ? { url: e } : null;
    }
    const b64 = e.b64_json ?? e.base64 ?? e.image_base64;
    if (typeof b64 === 'string' && b64.length > 0) {
      const d = parseDataUrl(b64);
      return d ?? { base64: b64.replace(/\s+/g, ''), mimeType: e.content_type || e.mime_type || 'image/png' };
    }
    const url = e.url ?? e.image_url ?? e.sample;
    if (typeof url === 'string' && url.length > 0) {
      const d = parseDataUrl(url);
      return d ?? (/^https?:\/\//i.test(url) ? { url } : null);
    }
    return null;
  };

  const lists = [r.images, r.data, r.output, r.artifacts];
  for (const list of lists) {
    if (Array.isArray(list)) {
      for (const e of list) {
        const got = fromEntry(e);
        if (got) return got;
      }
    } else if (typeof list === 'string') {
      const got = fromEntry(list);
      if (got) return got;
    }
  }
  return fromEntry(r.result?.sample) ?? fromEntry(r.image) ?? fromEntry(r.result) ?? null;
}

/**
 * The user-facing failure text. ONE function, so the white-label law holds by construction rather
 * than by every call site remembering it — the same discipline as `publicEngineName()`.
 *
 * ⚠️ Every branch says the same kind of thing on purpose: a user is never told which vendor failed,
 * and — as with the published-app gateway — "not configured" and "the host errored" read alike,
 * because the difference is ours to fix and not theirs to diagnose.
 */
export function imageProFailureMessage(kind: 'unconfigured' | 'failed' | 'timeout'): string {
  if (kind === 'timeout') {
    return 'NavBharatAI Pro took too long on this image, so nothing was charged. Please try again.';
  }
  if (kind === 'unconfigured') {
    return 'NavBharatAI Pro images are not switched on yet. Free generation is working — switch the toggle to Free.';
  }
  return 'NavBharatAI Pro could not finish this image, so nothing was charged. Please try again.';
}
