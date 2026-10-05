// THE FIRST IMAGE RUNG: FLUX.1 schnell on Cloudflare Workers AI (admin 2026-09-30: "cloudflare wala bana do").
//
// WHY THIS PROVIDER. The free provider the image generator was built on closed its anonymous door
// (it answered 402 to everyone by 2026-10-05), and the paid rungs behind it cost several rupees a picture. Workers AI
// gives every account 10,000 "neurons" a day at no charge; at its published rates (4.8 neurons per
// 512×512 tile, 9.6 per step) a 1024×1024 picture at 4 steps is about 58 neurons, so roughly 170
// pictures a day cost nothing and each one after that about $0.0006. The model's licence (Apache 2.0)
// and Cloudflare's terms both allow a commercial product. ⚠️ Those figures are the published rates,
// not a measurement from this account.
//
// 🔑 CREDENTIALS. The account id and API token Cloud Run already holds for DNS and Pages are reused.
// That token may not carry the Workers AI permission, so `CLOUDFLARE_AI_TOKEN`, when set, is used
// instead — a token made for this and nothing else. A refused token is an ordinary rung failure: the
// request falls through to the next rung and the admin diagnostic names the status.
//
// 🔒 WHAT IT WILL NOT DO:
//  - Draw a size it cannot make. The model returns 1024×1024 whatever it is asked for, so it serves
//    only a request for exactly that; a banner or a portrait goes to a rung that honours its shape
//    (the "the picker advertised a size we do not generate" class, `IMAGE_SIZE_PIXELS`).
//  - Draw a banned prompt. The same word ban the free provider has runs here too, for the same reason:
//    an image model does not refuse, it draws (Play rejection 2026-09-28).
//  - Edit the user's own picture. That stays on the multimodal rung.
//
// `IMAGE_GEN_CLOUDFLARE=off` removes the rung with no deploy.

import { assertPollinationsPromptSafe } from './pollinationsGuard';

export const CLOUDFLARE_IMAGE_MODEL_DEFAULT = '@cf/black-forest-labs/flux-1-schnell';

/** The one shape this model makes. */
export const CLOUDFLARE_IMAGE_SIDE = 1024;

export interface CloudflareImageConfig {
  accountId: string;
  token: string;
  model: string;
  steps: number;
}

/** The rung's settings, or null when it is switched off or not configured. PURE. */
export function cloudflareImageConfig(env: NodeJS.ProcessEnv = process.env): CloudflareImageConfig | null {
  if ((env.IMAGE_GEN_CLOUDFLARE || '').trim().toLowerCase() === 'off') return null;
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
  const token = String(env.CLOUDFLARE_AI_TOKEN ?? '').trim() || String(env.CLOUDFLARE_API_TOKEN ?? '').trim();
  if (!accountId || !token) return null;
  const model = String(env.CLOUDFLARE_IMAGE_MODEL ?? '').trim() || CLOUDFLARE_IMAGE_MODEL_DEFAULT;
  const rawSteps = String(env.CLOUDFLARE_IMAGE_STEPS ?? '').trim();
  const n = rawSteps === '' ? Number.NaN : Number(rawSteps);
  // The model allows 1–8 steps. An unreadable value is the default, never "as many as possible".
  const steps = Number.isFinite(n) ? Math.min(8, Math.max(1, Math.round(n))) : 4;
  return { accountId, token, model, steps };
}

/** Whether this rung makes the size that was asked for. PURE. */
export function cloudflareServesSize(px: { w: number; h: number }): boolean {
  return px.w === CLOUDFLARE_IMAGE_SIDE && px.h === CLOUDFLARE_IMAGE_SIDE;
}

/** The picture's type, read from its first bytes rather than assumed. PURE. */
export function mimeFromBase64(b64: string): string | null {
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return null;
}

/** The endpoint for one run. PURE. */
export function cloudflareRunUrl(cfg: CloudflareImageConfig): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfg.accountId)}/ai/run/${cfg.model}`;
}

export interface CloudflareImageResult {
  image?: { mimeType: string; base64: string };
  /** Why no picture came back, for the admin diagnostic. Never shown to a user. */
  error?: string;
}

/** Ask the model for one picture. Never throws, except for a prompt the word ban refuses. */
export async function fetchCloudflareImage(
  prompt: string,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<CloudflareImageResult> {
  const cfg = cloudflareImageConfig(opts.env ?? process.env);
  if (!cfg) return { error: 'not configured' };
  // The model takes at most 2,048 characters.
  const finalPrompt = String(prompt || '').slice(0, 2048);
  assertPollinationsPromptSafe(finalPrompt);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 45_000);
  try {
    const r = await fetchImpl(cloudflareRunUrl(cfg), {
      method: 'POST',
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: finalPrompt, steps: cfg.steps }),
    });
    const data: any = await r.json().catch(() => null);
    if (!r.ok || data?.success === false) {
      const why = Array.isArray(data?.errors) && data.errors[0]?.message ? `: ${String(data.errors[0].message).slice(0, 140)}` : '';
      return { error: `HTTP ${r.status}${why}` };
    }
    const b64 = typeof data?.result?.image === 'string' ? data.result.image : '';
    const mimeType = b64 ? mimeFromBase64(b64) : null;
    if (!b64 || !mimeType) return { error: 'no image in response' };
    return { image: { mimeType, base64: b64 } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: ctl.signal.aborted ? 'timeout' : msg.slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}
