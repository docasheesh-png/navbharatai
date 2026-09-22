// AI Image Studio — the PAID Pollinations rung: the FIRST engine a Pro image is asked of.
//
// Admin, verbatim (2026-09-21): "free wale me user ki ip, paid me hamari … paid pahle pollination use
// ho, fallback me IMAGE_PRO_KEY. ham 1 rup lenge." And, ordering the work: "private=true + token
// padhne ka code — privacy + watermark — sabse zaroori."
//
// So a Pro image now goes: THIS rung (Pollinations, from OUR server, with OUR key) → the Pro host
// (`imageProGen.ts`, `IMAGE_PRO_KEY`) only when this one cannot deliver. The price the user is told and
// charged does not change — ₹1, and only for a picture that arrives.
//
// 🔑 WHY A KEY CHANGES WHAT THE PICTURE IS, not only who pays. On the provider's anonymous door
// (`pollinationsImageUrl`, the free tier) `nologo` is ignored and the picture carries the provider's
// watermark, and `private` has to be asked for or the picture may appear on their public feed. A
// keyed request honours both. That is the "privacy + watermark" the admin put first — and it is
// exactly why the key lives HERE and never in the free link: that link is handed to the user's
// browser (`IMAGE_GEN_CLIENT_FETCH`), and a key in a URL a user can copy is a key everybody has.
//
// 🔒 THE KEY TRAVELS IN A HEADER, NEVER IN THE URL. The provider accepts `?key=` as well; it is not
// used, because a URL is what ends up in logs, in error messages and in a browser's history, and a
// header is not. `pollinationsPaidImageUrl` is a pure function of the prompt and the pixels — a test
// asserts the key is absent from it however the env is set.
//
// 🔒 WHITE-LABEL LAW: nothing this module returns is for a user. Its `error` strings name the vendor
// and the status code ON PURPOSE — they are for the server log and the admin, where the White-Label
// Law's §3 puts them — and the route MUST map them to `imageProFailureMessage(...)` before anything
// reaches a screen. A test holds the route to that.
//
// 💰 WHAT IT COSTS IS MEASURED, NOT ASSUMED. The provider bills in "pollen" (1 pollen = $1) at a
// per-model rate this repo cannot read from here (the catalog host is refused by this environment's
// egress policy), and it reports each request's usage in `x-usage-*` response headers. Those headers
// are captured on every delivery and logged admin-only, so the first real image is the first real
// number — the same "measure first" rule `SANDBOX_PEAK_MEMORY` was built on. `IMAGE_PRO_COST_USD`
// keeps pricing the MARGIN WARNING until that number exists; do not retune it from a guess.

import {
  MAX_PROMPT_CHARS, imagePixelsFor, pollinationsEnabled, pollinationsSeed, type GeneratedImage,
} from './imageGen';
import { imageProConfigured } from './imageProGen';

/** The provider's keyed door. The anonymous one (`image.pollinations.ai`) stays the free tier's. */
export const POLLINATIONS_PAID_BASE = 'https://gen.pollinations.ai';

/**
 * The model a Pro image is made on here. `tongyi-mai/z-image-turbo` because the Pro tier was PRICED
 * around Z-Image Turbo (`imageProGen.ts` records the three reasons — cheapest, top-ranked, open
 * weights), and choosing a different family for the first rung would make the two engines behind
 * one ₹1 toggle produce two different kinds of picture. Env-tunable (`IMAGE_PRO_POLLINATIONS_MODEL`)
 * because the provider's catalog spells ids its own way and reprices without asking us.
 *
 * ⚠️ Its pollen price is UNVERIFIED here — see the module note. A key that lacks permission for it
 * answers 403, which falls to the Pro host and is named in the log.
 */
export const POLLINATIONS_PAID_MODEL_DEFAULT = 'tongyi-mai/z-image-turbo';

/**
 * A bound on ONE attempt at this rung. Shorter than the Pro host's 90 s on purpose: the host still
 * runs after a failure here, and the client puts no clock of its own on the request, so the worst
 * case a user waits is the SUM of the two. 45 s is the free fetch's own budget — a picture that has
 * not arrived by then is not going to, and the host is a better bet than a longer wait.
 */
export const POLLINATIONS_PAID_TIMEOUT_MS = 45_000;

/**
 * The account key (`POLLINATIONS_API_KEY`). Trimmed, and whitespace-only counts as UNSET — the
 * `BRAVE_API_KEY` lesson: a stray newline in a console field would otherwise be a configured-looking
 * key that every call silently rejects with a 401, and the tier would fall to the host on every
 * image while the console said the rung was on.
 */
export function pollinationsKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.POLLINATIONS_API_KEY || '').trim();
}

export function pollinationsPaidModel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.IMAGE_PRO_POLLINATIONS_MODEL || '').trim() || POLLINATIONS_PAID_MODEL_DEFAULT;
}

/**
 * Whether this rung can run: a key, AND neither kill switch thrown.
 *
 * `IMAGE_GEN_POLLINATIONS=off` (the free tier's existing switch) turns the provider off EVERYWHERE,
 * paid included — an operator who pulls that switch means "not this vendor", not "not for free
 * users". `IMAGE_PRO_POLLINATIONS=off` turns off only this rung, so the free tier can keep the
 * provider while Pro goes straight to the host. Unset ⇒ on, exactly like the free switch.
 */
export function pollinationsPaidConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.IMAGE_PRO_POLLINATIONS || '').trim().toLowerCase() === 'off') return false;
  if (!pollinationsEnabled(env)) return false;
  return pollinationsKey(env).length > 0;
}

/**
 * Whether the PRO tier can serve an image at all — EITHER engine.
 *
 * 🔑 THE ONE OWNER of "is Pro on?". `/api/public-config` (the chip) and `POST /api/image/pro/generate`
 * (the 503) both ask this and nothing else, which is what keeps them from telling the user two
 * different stories — the property `proTellsYouBeforeYouType.test.ts` was written to hold. It used
 * to be `imageProConfigured()` alone; now that a key alone makes Pro real, a chip that still read
 * only the host's config would tell a working tier's user it was off.
 */
export function imageProAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return pollinationsPaidConfigured(env) || imageProConfigured(env);
}

/**
 * The keyed request URL. PURE, and a pure function of the PROMPT and the PIXELS — the key is not an
 * input, so it cannot be in the output. `nologo` and `private` are both asked for, and on this door
 * both are honoured.
 */
export function pollinationsPaidImageUrl(
  prompt: string,
  size?: string,
  env: NodeJS.ProcessEnv = process.env,
  custom?: { width?: unknown; height?: unknown },
): string {
  const px = imagePixelsFor(size, custom?.width, custom?.height);
  const p = encodeURIComponent(String(prompt || '').slice(0, MAX_PROMPT_CHARS));
  const model = encodeURIComponent(pollinationsPaidModel(env));
  return `${POLLINATIONS_PAID_BASE}/image/${p}?model=${model}&width=${px.w}&height=${px.h}`
    + `&seed=${pollinationsSeed(env)}&nologo=true&private=true`;
}

/** `Authorization: Bearer …`, or no header at all rather than an empty credential. */
export function pollinationsAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const key = pollinationsKey(env);
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** The shape of headers this module reads — a real `Headers`, or a test's stand-in. */
export interface HeaderReader {
  get(name: string): string | null;
  forEach(cb: (value: string, name: string) => void): void;
}

/**
 * Every `x-usage-*` header, lower-cased, as one record — the provider's own statement of what the
 * request cost. PURE. The exact names are the provider's to choose, so nothing here presumes them:
 * whatever arrives is kept, and an absent set is an empty record, never an invented number.
 */
export function usageFromHeaders(headers: HeaderReader): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    const n = String(name).toLowerCase();
    if (n.startsWith('x-usage-')) out[n] = String(value);
  });
  return out;
}

/**
 * One admin-facing word for a status the provider documents, so the log says WHICH lock tripped:
 * 401 is the key, 402 is the wallet, 403 is the key's own model list, 429 is the rate. A reader of the
 * server log should not need the provider's docs open to act on a line.
 */
export function describePollinationsStatus(status: number): string {
  if (status === 401) return 'HTTP 401 — the key was rejected (check POLLINATIONS_API_KEY)';
  if (status === 402) return 'HTTP 402 — the account has no pollen left';
  if (status === 403) return 'HTTP 403 — the key lacks permission for this model';
  if (status === 429) return 'HTTP 429 — rate-limited';
  return `HTTP ${status}`;
}

export interface PollinationsPaidResult {
  image?: GeneratedImage;
  /** The provider's `x-usage-*` headers on a delivery — admin-only; log them, never return them. */
  usage?: Record<string, string>;
  /** ADMIN-ONLY wording (names the vendor). The route maps it to the branded message. */
  error?: string;
  status?: number;
  disabled?: boolean;
}

/**
 * Ask the keyed door for one image, from THIS server. `fetchImpl` is injectable for tests.
 *
 * Result: `{ image, usage }` on a delivery · `{ error, status? }` on any failure · `{ disabled }`
 * when the rung is not configured. Never a placeholder, never a throw — the route decides what a
 * failure here means (today: try the Pro host).
 */
export async function fetchPollinationsPaidImage(
  prompt: string,
  size?: string,
  opts: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    custom?: { width?: unknown; height?: unknown };
  } = {},
): Promise<PollinationsPaidResult> {
  const env = opts.env ?? process.env;
  if (!pollinationsPaidConfigured(env)) return { disabled: true };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? POLLINATIONS_PAID_TIMEOUT_MS);
  try {
    const r = await fetchImpl(pollinationsPaidImageUrl(prompt, size, env, opts.custom), {
      headers: pollinationsAuthHeaders(env),
      signal: ctl.signal,
    });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok) return { error: describePollinationsStatus(r.status), status: r.status };
    if (!ct.startsWith('image/')) return { error: `non-image (${ct || 'unknown'})`, status: r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0) return { error: 'empty image body', status: r.status };
    return {
      image: { mimeType: ct, base64: buf.toString('base64') },
      usage: usageFromHeaders(r.headers as unknown as HeaderReader),
    };
  } catch (err) {
    const aborted = err instanceof Error && /abort/i.test(err.message);
    return { error: aborted ? 'timed out' : (err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160)) };
  } finally {
    clearTimeout(timer);
  }
}
