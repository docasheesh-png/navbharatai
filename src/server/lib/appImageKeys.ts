// THE KEY THAT MAKES AN APP'S PICTURES (admin 2026-10-04).
//
// Admin, verbatim: "1. user ko saaf saaf bolo ki API keys chahiye. 2. user ko navbhatai api keys ka offer
// den, aur bhi api keys ke bare me bataye jaise grok, gemini, chatgpt — user jo bhi select kare uski
// location/link bataye, user ko guide kare ki keys kaha dalni hai!!"
//
// WHY: the free image provider stopped answering anonymous requests (every request now needs an account
// key — its own docs: "401 UNAUTHORIZED always means key missing or invalid"), and a key may not be put in
// browser code, where every visitor could copy it. So an app built on NavBharatAI that makes pictures now
// asks OUR server for each one (`window.NavAI.image`), and our server makes it with the key the app's
// OWNER saved in Keys & Secrets. The key is read from the encrypted vault here and never leaves the server.
//
// ONE TABLE (`APP_IMAGE_KEY_OPTIONS`) is read by every place that talks about these keys — the builder's
// instruction, the checklist at the end of a build, the owner's error message, and this module's own
// vault lookup — so the name of a secret, its link and its place in the app cannot drift between them.
//
// 🔒 A KEY THAT IS REFUSED IS NOT SILENTLY REPLACED BY OURS — the same rule as the app's text assistant
// (appAiOwnKey.ts). The owner chose a key; spending their NavBharatAI wallet behind that choice would be
// a charge they did not decide on.

import { scanPollinationsPrompt } from './pollinationsGuard';
import { parseGrokImageResponse, parseImagePartsResponse, POLLINATIONS_SAFE_FILTERS, type GeneratedImage } from './imageGen';
import { imageShapeOf, type ImagePixels } from './navbharatImageEngine';

export type AppImageProvider = 'navbharatai' | 'openai' | 'gemini' | 'xai' | 'pollinations';

export interface AppImageKeyOption {
  provider: AppImageProvider;
  /** The name the owner gives the secret in Keys & Secrets. */
  secret: string;
  /** Other names the same key is accepted under (a key saved for the text assistant, say). */
  aliases: readonly string[];
  /** What the owner reads. */
  label: string;
  /** Where the key is made. An in-app path for NavBharatAI, a web address for the others. */
  getIt: string;
  note: string;
}

/** Where the owner pastes any of them. One sentence, used everywhere. */
export const APP_KEYS_PLACE = 'NavBharatAI Pro → More → Keys & Secrets (or Settings → App Settings → Secrets & API Keys)';

export const APP_IMAGE_KEY_OPTIONS: readonly AppImageKeyOption[] = [
  {
    provider: 'navbharatai', secret: 'NAVBHARATAI_API_KEY', aliases: [],
    label: 'NavBharatAI API key',
    getIt: 'Home → Other AI → Developer Tools → NavBharatAI API → create a key with the "Images" permission',
    note: 'No other account needed. 5 free pictures a day, then ₹1 each from your NavBharatAI wallet.',
  },
  {
    provider: 'openai', secret: 'OPENAI_API_KEY', aliases: [],
    label: 'OpenAI (ChatGPT) key',
    getIt: 'https://platform.openai.com/api-keys',
    note: 'Billed by OpenAI to your OpenAI account.',
  },
  {
    provider: 'gemini', secret: 'GEMINI_API_KEY', aliases: ['GOOGLE_API_KEY'],
    label: 'Google Gemini key',
    getIt: 'https://aistudio.google.com/apikey',
    note: 'Billed by Google to your Google account.',
  },
  {
    provider: 'xai', secret: 'XAI_API_KEY', aliases: ['GROK_API_KEY'],
    label: 'xAI Grok key',
    getIt: 'https://console.x.ai',
    note: 'Billed by xAI to your xAI account.',
  },
  {
    provider: 'pollinations', secret: 'POLLINATIONS_API_KEY', aliases: [],
    label: 'Pollinations secret key (sk_…)',
    getIt: 'https://enter.pollinations.ai',
    note: 'Use the SECRET key (sk_…), never the publishable pk_ key. Billed in Pollinations "pollen".',
  },
];

/** The owner may name the engine to use when several keys are saved. */
export const APP_IMAGE_PROVIDER_SECRET = 'IMAGE_PROVIDER';

export interface AppImageKey {
  provider: AppImageProvider;
  key: string;
  /** An owner-chosen model, if they set one (e.g. OPENAI_IMAGE_MODEL). */
  model: string;
}

const MODEL_SECRET: Record<Exclude<AppImageProvider, 'navbharatai'>, string> = {
  openai: 'OPENAI_IMAGE_MODEL',
  gemini: 'GEMINI_IMAGE_MODEL',
  xai: 'XAI_IMAGE_MODEL',
  pollinations: 'POLLINATIONS_IMAGE_MODEL',
};

const DEFAULT_MODEL: Record<Exclude<AppImageProvider, 'navbharatai'>, string> = {
  openai: 'gpt-image-1',
  gemini: 'gemini-2.5-flash-image',
  xai: 'grok-2-image',
  pollinations: '',
};

/**
 * The image key to use, from the owner's vault secrets. `IMAGE_PROVIDER` wins when it names a saved key;
 * otherwise the table's order (NavBharatAI first, then OpenAI, Gemini, xAI, Pollinations). PURE.
 */
export function appImageKeyFromSecrets(secrets: Readonly<Record<string, string>> | null | undefined): AppImageKey | null {
  if (!secrets) return null;
  const found = (o: AppImageKeyOption): string => {
    for (const name of [o.secret, ...o.aliases]) {
      const v = String(secrets[name] ?? '').trim();
      if (v.length >= 16) return v;
    }
    return '';
  };
  const asKey = (o: AppImageKeyOption, key: string): AppImageKey => ({
    provider: o.provider,
    key,
    model: o.provider === 'navbharatai' ? '' : String(secrets[MODEL_SECRET[o.provider]] ?? '').trim(),
  });
  const wanted = String(secrets[APP_IMAGE_PROVIDER_SECRET] ?? '').trim().toLowerCase();
  if (wanted) {
    const o = APP_IMAGE_KEY_OPTIONS.find((x) => x.provider === wanted || (wanted === 'grok' && x.provider === 'xai') || (wanted === 'chatgpt' && x.provider === 'openai'));
    const key = o ? found(o) : '';
    if (o && key) return asKey(o, key);
  }
  for (const o of APP_IMAGE_KEY_OPTIONS) {
    const key = found(o);
    if (key) return asKey(o, key);
  }
  return null;
}

/** The plain-words list of options, for the owner. PURE. */
export function appImageKeyOptionsText(): string {
  return APP_IMAGE_KEY_OPTIONS
    .map((o, i) => `${i + 1}. ${o.label} — get it: ${o.getIt}. Save it as ${o.secret}. ${o.note}`)
    .join('\n');
}

/** What the OWNER reads when their app has no image key yet. PURE. */
export function needsImageKeyMessage(): string {
  return 'This app makes pictures with an AI image service, and that needs an API key. ' +
    `Add ONE of these in ${APP_KEYS_PLACE}:\n${appImageKeyOptionsText()}`;
}

/** What a VISITOR reads — never the owner's setup, never a vendor name (White-Label Law). */
export const VISITOR_IMAGE_UNAVAILABLE = 'The picture maker in this app is not set up yet. Please try again later.';

export type OwnImageResult =
  | { ok: true; image: GeneratedImage }
  | { ok: false; reason: 'refused' | 'busy' | 'failed' | 'blocked' };

function reasonForStatus(status: number): 'refused' | 'busy' | 'failed' {
  if (status === 401 || status === 402 || status === 403) return 'refused';
  if (status === 429) return 'busy';
  return 'failed';
}

function openAiSize(model: string, px: ImagePixels): string {
  const shape = imageShapeOf(px);
  if (model.startsWith('dall-e-3')) return shape === 'wide' ? '1792x1024' : shape === 'portrait' ? '1024x1792' : '1024x1024';
  if (model.startsWith('dall-e')) return '1024x1024';
  return shape === 'wide' ? '1536x1024' : shape === 'portrait' ? '1024x1536' : '1024x1024';
}

/** Make one picture with the owner's OWN key (not NavBharatAI's). `fetchImpl` is a test seam. Never throws. */
export async function drawWithOwnImageKey(
  own: AppImageKey,
  prompt: string,
  px: ImagePixels,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; seed?: number } = {},
): Promise<OwnImageResult> {
  if (own.provider === 'navbharatai') return { ok: false, reason: 'failed' };
  // An image model draws, it does not refuse — the platform's word ban runs before ANY engine.
  if (!scanPollinationsPrompt(prompt).ok) return { ok: false, reason: 'blocked' };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 90_000);
  const model = own.model || DEFAULT_MODEL[own.provider];
  try {
    if (own.provider === 'openai') {
      const dalle = model.startsWith('dall-e');
      const res = await fetchImpl('https://api.openai.com/v1/images/generations', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${own.key}` },
        body: JSON.stringify({ model, prompt, n: 1, size: openAiSize(model, px), ...(dalle ? { response_format: 'b64_json' } : {}) }),
      });
      if (!res.ok) return { ok: false, reason: reasonForStatus(res.status) };
      const img = parseGrokImageResponse(await res.json().catch(() => null));
      return img ? { ok: true, image: img } : { ok: false, reason: 'failed' };
    }
    if (own.provider === 'xai') {
      const res = await fetchImpl('https://api.x.ai/v1/images/generations', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${own.key}` },
        body: JSON.stringify({ model, prompt, n: 1, response_format: 'b64_json' }),
      });
      if (!res.ok) return { ok: false, reason: reasonForStatus(res.status) };
      const img = parseGrokImageResponse(await res.json().catch(() => null));
      return img ? { ok: true, image: img } : { ok: false, reason: 'failed' };
    }
    if (own.provider === 'gemini') {
      const shape = imageShapeOf(px);
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': own.key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: shape === 'square' ? prompt : `${prompt}\n\n(${shape === 'wide' ? 'Wide 16:9' : 'Tall 9:16'} picture.)` }] }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
      });
      if (!res.ok) return { ok: false, reason: reasonForStatus(res.status) };
      const img = parseImagePartsResponse(await res.json().catch(() => null));
      return img ? { ok: true, image: img } : { ok: false, reason: 'failed' };
    }
    // Pollinations, with the owner's SECRET key in a header — never in a link a browser could copy.
    const seed = Number.isInteger(opts.seed) ? Number(opts.seed) : Math.floor(Math.random() * 1_000_000_000);
    const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?width=${px.w}&height=${px.h}&seed=${seed}`
      + `${model ? `&model=${encodeURIComponent(model)}` : ''}&nologo=true&private=true&safe=${POLLINATIONS_SAFE_FILTERS}`;
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { Authorization: `Bearer ${own.key}` } });
    if (!res.ok) return { ok: false, reason: reasonForStatus(res.status) };
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return { ok: false, reason: 'failed' };
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? { ok: true, image: { mimeType: type, base64: buf.toString('base64') } } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: ctl.signal.aborted ? 'busy' : 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

/** The owner-facing sentence for an own-key failure. Names the provider — it is THEIR key. PURE. */
export function ownImageKeyMessage(provider: AppImageProvider, reason: 'refused' | 'busy' | 'failed' | 'blocked'): string {
  const label = APP_IMAGE_KEY_OPTIONS.find((o) => o.provider === provider)?.label ?? 'image key';
  switch (reason) {
    case 'refused': return `Your ${label} was refused (wrong key, no image access, or no credit left). Check it in ${APP_KEYS_PLACE}.`;
    case 'busy': return `Your ${label} is busy or slow right now. Please try again in a moment.`;
    case 'blocked': return 'That description cannot be drawn. Please describe something else.';
    default: return `Your ${label} did not make the picture just now. Please try again.`;
  }
}
