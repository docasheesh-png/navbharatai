// THE OLD PAID TIER'S SECOND ENGINE, BACK AS A PAID RUNG (admin 2026-09-30: "old paid wala mila ke banao").
//
// This is the host the ₹1 Pro tier used from 2026-09-21 until its removal on 2026-09-23
// (`IMAGE_PRO_KEY` / `IMAGE_PRO_ENDPOINT` / `IMAGE_PRO_AUTH_SCHEME`, which the admin set in Cloud Run
// on 2026-09-21). The request builder, the response reader and the polling are the ones that shipped
// then (`git show d1af1e4b^:src/server/lib/imageProGen.ts`), unchanged in substance.
//
// 🔴 TEXT-TO-IMAGE ONLY. The Pro tier was removed because an edit of the user's own photo came back
// unchanged. That was this host's edit path. An edit in Paid mode goes to the edit engine the free
// tier has used since (`runImageEdit`), so this module never sends a picture anywhere.
//
// 🔑 THE HOST IS ASYNCHRONOUS BY DEFAULT: the POST can answer with a job id, and even in sync mode a
// slow task comes back HTTP 200 with `status: processing`. So a 200 is not an image; the result URL
// is polled, bounded by the same clock as the first call.
//
// `IMAGE_PRO_ENABLED=off` removes the rung with no deploy.

import { assertPollinationsPromptSafe } from './pollinationsGuard';

export const IMAGE_PRO_TIMEOUT_MS = 90_000;
export const IMAGE_PRO_POLL_MS = 2_000;

export function imageProEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  return (env.IMAGE_PRO_ENDPOINT || '').trim();
}

export function imageProKey(env: NodeJS.ProcessEnv = process.env): string {
  // Whitespace-only counts as unset: a stray newline in a console field is otherwise a key that looks
  // configured and is rejected on every call.
  return (env.IMAGE_PRO_KEY || '').trim();
}

/** The model for a fresh picture. `IMAGE_PRO_MODEL` overrides it; `IMAGE_PRO_TEXT_MODEL` names it. */
export function imageProTextModel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.IMAGE_PRO_MODEL || '').trim() || (env.IMAGE_PRO_TEXT_MODEL || '').trim() || 'z-image-turbo';
}

/**
 * The Authorization header shape: `key` → `Authorization: Key <k>`, `bearer` → `Authorization: Bearer
 * <k>`, `x-key` → `x-key: <k>`. One word decides it, so it is one env and not three code paths.
 */
export function imageProAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const key = imageProKey(env);
  if (!key) return {};
  const scheme = (env.IMAGE_PRO_AUTH_SCHEME || '').trim().toLowerCase();
  if (scheme === 'x-key') return { 'x-key': key };
  if (scheme === 'bearer') return { Authorization: `Bearer ${key}` };
  return { Authorization: `Key ${key}` };
}

/** Both a key and an endpoint, or the rung is skipped. PURE. */
export function imageProConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.IMAGE_PRO_ENABLED || '').trim().toLowerCase() === 'off') return false;
  return imageProKey(env).length > 0 && imageProEndpoint(env).length > 0;
}

/**
 * The request body. It carries both spellings of the common fields because the hosts that serve this
 * model disagree on names and ignore what they do not recognise. PURE apart from the seed.
 */
export function buildImageProTextRequest(prompt: string, px: { w: number; h: number }, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  return {
    prompt,
    model: imageProTextModel(env),
    width: px.w,
    height: px.h,
    image_size: { width: px.w, height: px.h },
    num_images: 1,
    n: 1,
    output_format: 'png',
    // Ask for an inline answer when the host can give one; `pendingResultUrl` covers when it cannot.
    enable_sync_mode: true,
    // Without a seed the same brief returns the same picture, and "try again" means nothing.
    seed: Math.floor(Date.now() % 2_147_483_647),
  };
}

function parseDataUrl(s: string): { mimeType: string; base64: string } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(s || '').trim());
  if (!m) return null;
  const base64 = m[2].replace(/\s+/g, '');
  return base64 ? { mimeType: m[1].toLowerCase(), base64 } : null;
}

/**
 * The first image in whatever shape the host returned — `{images:[{url}]}`, `{data:[{b64_json|url}]}`,
 * `{result:{sample}}`, `{output:[url]}`, the `{code, data:{outputs}}` envelope, or a bare data URL.
 * Never a placeholder: "no image" stays null. PURE.
 */
export function parseImageProResponse(resp: unknown): { base64: string; mimeType: string } | { url: string } | null {
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
  const envelope = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : r;
  const lists = [r.images, r.data, r.output, r.artifacts, envelope.outputs, envelope.images, envelope.data];
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
  return fromEntry(r.result?.sample) ?? fromEntry(r.image) ?? fromEntry(r.result)
    ?? fromEntry(envelope.image) ?? fromEntry(envelope.url) ?? null;
}

/** The URL a still-running job's picture will appear at, or null. Only a URL the host gave. PURE. */
export function pendingResultUrl(resp: unknown): string | null {
  const r = resp as any;
  if (!r || typeof r !== 'object') return null;
  const d = r.data && typeof r.data === 'object' ? r.data : r;
  const status = String(d.status ?? r.status ?? '').toLowerCase();
  const done = status === 'completed' || status === 'succeeded' || status === 'failed' || status === 'cancelled';
  if (done) return null;
  const url = d.urls?.get ?? d.url_get ?? d.result_url ?? r.urls?.get;
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

/** Did the host say the job FAILED? Distinguishes "no image yet" from "no image ever". PURE. */
export function jobFailed(resp: unknown): boolean {
  const r = resp as any;
  if (!r || typeof r !== 'object') return false;
  const d = r.data && typeof r.data === 'object' ? r.data : r;
  const status = String(d.status ?? r.status ?? '').toLowerCase();
  return status === 'failed' || status === 'cancelled' || status === 'timeout';
}

export interface ImageProHostResult {
  image?: { mimeType: string; base64: string };
  /** Why no picture came back, for the admin diagnostic. Never shown to a user. */
  error?: string;
}

/** One fresh picture from the host. Never throws, except for a prompt the word ban refuses. */
export async function fetchImageProHostImage(
  prompt: string,
  px: { w: number; h: number },
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; timeoutMs?: number; pollMs?: number } = {},
): Promise<ImageProHostResult> {
  const env = opts.env ?? process.env;
  if (!imageProConfigured(env)) return { error: 'not configured' };
  // An image model draws, it does not refuse — the same word ban as every other picture rung.
  assertPollinationsPromptSafe(prompt);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = imageProAuthHeaders(env);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? IMAGE_PRO_TIMEOUT_MS);
  try {
    const r = await fetchImpl(imageProEndpoint(env), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(buildImageProTextRequest(prompt, px, env)),
      signal: ctl.signal,
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    let payload: unknown = await r.json();
    let parsed = parseImageProResponse(payload);
    let next = parsed ? null : pendingResultUrl(payload);
    while (!parsed && next && !ctl.signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, opts.pollMs ?? IMAGE_PRO_POLL_MS));
      if (ctl.signal.aborted) break;
      const poll = await fetchImpl(next, { headers, signal: ctl.signal });
      if (!poll.ok) return { error: `polling HTTP ${poll.status}` };
      payload = await poll.json();
      if (jobFailed(payload)) return { error: 'the host reported the job failed' };
      parsed = parseImageProResponse(payload);
      next = parsed ? null : pendingResultUrl(payload);
    }
    if (!parsed) return { error: ctl.signal.aborted ? 'timeout' : 'no image in the response' };
    if ('url' in parsed) {
      // Fetched here and re-served as bytes, so the user's browser never talks to the vendor.
      const img = await fetchImpl(parsed.url, { signal: ctl.signal });
      const ct = img.headers.get('content-type') || 'image/png';
      if (!img.ok || !ct.startsWith('image/')) return { error: `result fetch HTTP ${img.status} (${ct})` };
      const buf = Buffer.from(await img.arrayBuffer());
      if (buf.length === 0) return { error: 'empty image body' };
      return { image: { mimeType: ct, base64: buf.toString('base64') } };
    }
    return { image: parsed };
  } catch (err) {
    return { error: ctl.signal.aborted ? 'timeout' : (err instanceof Error ? err.message : String(err)).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}
