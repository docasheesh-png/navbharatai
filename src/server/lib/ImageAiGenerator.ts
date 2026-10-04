// U-4 (verified recipe modules) — AI IMAGE GENERATION inside the user's app (admin 2026-10-01).
//
// Admin, verbatim: "jab user apni api key dalna chahe kisi aur provider ki to bhi dal sakta ho, jab chahe
// change kare, agar user keys na de, to default pollination ai".
//
// 🔴 CORRECTED 2026-10-04 — THE KEYLESS DEFAULT IS GONE, because it no longer exists at the provider. The
// free image provider now answers 401 to every request without an account key (its own API docs), and a
// key may never be put in browser code. An app built on this recipe failed on every picture while its
// builder told the user "no API key needed" (admin report, build cc3ef776). The
// admin's ruling: "user ko saaf saaf bolo ki API keys chahiye … navbhatai api keys ka offer den, aur bhi
// api keys (grok, gemini, chatgpt) … guide kare ki keys kaha dalni hai".
//
// So a generated app that makes pictures gets ONE modular engine:
//
//   ImageGenerationProvider            (the interface every engine implements)
//     ├─ NavAIImageProvider            (the default — NavBharatAI makes it with the OWNER's saved key)
//     ├─ ServerImageProvider           (browser → this app's own /api/generate-image route)
//     └─ on the server: NavBharatAI API, OpenAI, Gemini, xAI Grok, Pollinations (keyed), Stability
//
// TWO MODES, chosen when the recipe runs:
//   • browser (default) — the page calls window.NavAI.image(). NavBharatAI's gateway reads the owner's image
//     key from Keys & Secrets (lib/appImageKeys.ts) and makes the picture on our server, so the key never
//     reaches the page. Works in the NavBharatAI preview and in the published app.
//   • server — the page calls the app's own route; the SERVER picks the engine from its settings on every
//     request (the same key names as the gateway, or IMAGE_PROVIDER + IMAGE_API_KEY). No key ⇒ an honest
//     "add an image API key" error, never an anonymous call that cannot succeed.
//
// The generated code is complete and real — no placeholder pictures, no TODOs. It handles an empty or
// over-long prompt, a missing key, timeouts, rate limits, a refused key, a non-image answer, network
// failures, retries, cancellation, and download. Keyed Pollinations requests carry the explicit safety
// filters (`privacy,secrets,sexual,violence` — on the current API `safe=true` alone is NOT the nudity
// filter) and `private=true`, the same as NavBharatAI's own image generator (src/server/lib/imageGen.ts).
//
// ⚠️ The generated sources below are written WITHOUT backticks, `${` or backslashes, because they live
// inside TypeScript template literals here; a stray one would be evaluated now instead of shipped.
//
// PURE builders; unit-tested and compiled with the real TypeScript compiler in the tests.

import { appImageKeyOptionsText, APP_KEYS_PLACE } from './appImageKeyOptions';

export interface ImageAiOptions {
  /** Route requests through the app's own server (needed for the owner's own provider key). */
  server: boolean;
  /** The app uses React — also write the `useImageGenerator()` hook. */
  react: boolean;
}

export interface ImageAiConfig {
  files: Record<string, string>;
  envKeys: string[];
  instructions: string;
}

export const IMAGE_ENDPOINT = '/api/generate-image';
export const IMAGE_ENV_KEYS = ['IMAGE_PROVIDER', 'IMAGE_API_KEY', 'IMAGE_MODEL', 'IMAGE_BASE_URL', 'IMAGE_RATE_PER_MINUTE'];
const ENV_EXAMPLE = '.env.example';

// ── Browser module: src/lib/imageAi.ts ──────────────────────────────────────────────────────────────
function clientModule(server: boolean): string {
  const endpointLine = server
    ? "const SERVER_ENDPOINT: string | null = '" + IMAGE_ENDPOINT + "';"
    : 'const SERVER_ENDPOINT: string | null = null;';
  const modeNote = server
    ? '// MODE: server. Every request goes to this app\'s own ' + IMAGE_ENDPOINT + ' route, and the SERVER picks\n' +
      '// the engine from the image API key saved for it. No key is ever in this file.'
    : '// MODE: browser. The page asks NavBharatAI for each picture (window.NavAI.image), and NavBharatAI makes\n' +
      '// it with the image API key the app\'s owner saved in NavBharatAI → More → Keys & Secrets. No key is ever in this file.';
  return `// AI image generation for this app — a description in, a picture out.
//
${modeNote}
//
// To add another engine, implement ImageGenerationProvider and pass it as { provider } to generateImage().

export type ImageErrorCode =
  | 'invalid-prompt'
  | 'needs-key'
  | 'timeout'
  | 'rate-limited'
  | 'network'
  | 'refused'
  | 'failed'
  | 'cancelled';

export class ImageGenError extends Error {
  readonly code: ImageErrorCode;
  /** True when trying again can succeed (busy, slow, network). */
  readonly retryable: boolean;
  constructor(code: ImageErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = 'ImageGenError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ImageRequest {
  prompt: string;
  width?: number;
  height?: number;
  /** Same prompt + same seed gives the same picture; leave it out for a new one every time. */
  seed?: number;
}

export interface ImageJob {
  prompt: string;
  width: number;
  height: number;
  seed: number;
}

export interface GeneratedImage {
  /** Put this in an <img src>. */
  url: string;
  /** The picture's bytes, when the browser could read them (used by downloadImage). */
  blob: Blob | null;
  prompt: string;
  seed: number;
  width: number;
  height: number;
  /** Which engine made the picture. */
  provider: string;
}

export interface ImageGenerationProvider {
  readonly name: string;
  generate(job: ImageJob, signal: AbortSignal): Promise<GeneratedImage>;
}

export const MAX_PROMPT_LENGTH = 1000;
const MIN_SIZE = 256;
const MAX_SIZE = 1536;
${endpointLine}

/** Trim and check a description; throws an 'invalid-prompt' ImageGenError when it cannot be used. */
export function cleanPrompt(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new ImageGenError('invalid-prompt', 'Please describe the picture you want.', false);
  if (text.length > MAX_PROMPT_LENGTH) {
    throw new ImageGenError('invalid-prompt', 'That description is too long. Please keep it under ' + MAX_PROMPT_LENGTH + ' characters.', false);
  }
  return text;
}

function pixels(value: number | undefined): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 1024;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, n));
}

function newSeed(): number {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return (buf[0] ?? 0) % 2147483647;
  }
  return Math.floor(Math.random() * 2147483647);
}

/** The error for an HTTP status from an image service. */
export function errorForStatus(status: number, message?: string): ImageGenError {
  if (status === 400 || status === 422) {
    return new ImageGenError('invalid-prompt', message || 'The image service could not use that description. Try different words.', false);
  }
  if (status === 401 || status === 402 || status === 403) {
    return new ImageGenError('refused', message || 'The image service is not accepting requests right now. Please try again later.', false);
  }
  if (status === 429) return new ImageGenError('rate-limited', message || 'Too many pictures were requested at once. Please wait a moment.', true);
  if (status === 408 || status === 504) return new ImageGenError('timeout', message || 'The picture took too long to make.', true);
  if (status >= 500) return new ImageGenError('failed', message || 'The image service had a problem making this picture.', true);
  return new ImageGenError('failed', message || 'The picture could not be made.', false);
}

async function imageFromResponse(res: Response, job: ImageJob, provider: string): Promise<GeneratedImage> {
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new ImageGenError('failed', 'The image service answered without a picture.', true);
  const blob = await res.blob();
  if (blob.size === 0) throw new ImageGenError('failed', 'The image service sent an empty picture.', true);
  return { url: URL.createObjectURL(blob), blob, prompt: job.prompt, seed: job.seed, width: job.width, height: job.height, provider };
}

function cancelled(): ImageGenError {
  return new ImageGenError('cancelled', 'Stopped.', false);
}

const NOT_CONNECTED = 'Pictures are made through NavBharatAI. Open this app in the NavBharatAI preview, or publish it with NavBharatAI, and add an image API key in More → Keys & Secrets.';

interface NavAIPictures {
  image?: (prompt: string, options: { width: number; height: number }) => Promise<string>;
}

/** Turn a data: URL into a Blob, so the picture can be downloaded and its memory freed. */
function dataUrlToBlob(url: string): Blob | null {
  const comma = url.indexOf(',');
  if (url.indexOf('data:') !== 0 || comma < 0) return null;
  const meta = url.slice(5, comma);
  if (meta.indexOf('base64') < 0) return null;
  const type = meta.split(';')[0] || 'image/png';
  const raw = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * NavBharatAI — the default engine. The page asks NavBharatAI for the picture (window.NavAI.image) and
 * NavBharatAI makes it with the image API key the app's owner saved. The key never reaches this page.
 */
export class NavAIImageProvider implements ImageGenerationProvider {
  readonly name = 'NavBharatAI';
  generate(job: ImageJob, signal: AbortSignal): Promise<GeneratedImage> {
    const nav = (globalThis as unknown as { NavAI?: NavAIPictures }).NavAI;
    const make = nav && typeof nav.image === 'function' ? nav.image : null;
    if (!make) return Promise.reject(new ImageGenError('needs-key', NOT_CONNECTED, false));
    const name = this.name;
    return new Promise<GeneratedImage>((resolve, reject) => {
      const stop = () => reject(cancelled());
      if (signal.aborted) {
        stop();
        return;
      }
      signal.addEventListener('abort', stop, { once: true });
      make(job.prompt, { width: job.width, height: job.height }).then(
        (url) => {
          signal.removeEventListener('abort', stop);
          if (typeof url !== 'string' || url.indexOf('data:image/') !== 0) {
            reject(new ImageGenError('failed', 'The picture could not be made. Please try again.', false));
            return;
          }
          const blob = dataUrlToBlob(url);
          resolve({ url: blob ? URL.createObjectURL(blob) : url, blob, prompt: job.prompt, seed: job.seed, width: job.width, height: job.height, provider: name });
        },
        (err: unknown) => {
          signal.removeEventListener('abort', stop);
          const message = err instanceof Error && err.message ? err.message : 'The picture could not be made. Please try again.';
          const code = err && typeof err === 'object' && (err as { code?: unknown }).code === 'needs-key' ? 'needs-key' : 'failed';
          reject(new ImageGenError(code, message, false));
        },
      );
    });
  }
}

/** This app's own server route — the server chooses the engine and holds any key. */
export class ServerImageProvider implements ImageGenerationProvider {
  readonly name = 'server';
  private readonly endpoint: string;
  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }
  async generate(job: ImageJob, signal: AbortSignal): Promise<GeneratedImage> {
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new ImageGenError('network', 'Could not reach the server. Check the internet connection and try again.', true);
    }
    if (!res.ok) {
      if (res.status === 404) throw new ImageGenError('failed', 'The image route is not running on this server.', false);
      let message: string | undefined;
      let code: unknown;
      try {
        const body = (await res.json()) as { error?: unknown; code?: unknown };
        if (typeof body.error === 'string') message = body.error;
        code = body.code;
      } catch {
        // Not JSON — the status alone decides the message.
      }
      if (code === 'needs-key') throw new ImageGenError('needs-key', message || 'This app needs an image API key.', false);
      throw errorForStatus(res.status, message);
    }
    return imageFromResponse(res, job, res.headers.get('x-image-provider') || this.name);
  }
}

/** The engine this app uses unless you pass another one. */
export function defaultImageProvider(): ImageGenerationProvider {
  return SERVER_ENDPOINT ? new ServerImageProvider(SERVER_ENDPOINT) : new NavAIImageProvider();
}

export interface GenerateOptions {
  provider?: ImageGenerationProvider;
  /** Give up on one attempt after this many milliseconds (default 120000 — a picture can take a minute). */
  timeoutMs?: number;
  /** Extra attempts after a failure that can succeed on a retry (default 2). */
  retries?: number;
  /** Abort this to stop the request. */
  signal?: AbortSignal;
  /** Called before each new attempt, with its number (1, 2, ...). */
  onRetry?: (attempt: number, error: ImageGenError) => void;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Make one picture. Retries what can succeed on a retry; throws an ImageGenError otherwise. */
export async function generateImage(request: ImageRequest, options: GenerateOptions = {}): Promise<GeneratedImage> {
  const job: ImageJob = {
    prompt: cleanPrompt(request.prompt),
    width: pixels(request.width),
    height: pixels(request.height),
    seed: Number.isInteger(request.seed) ? Number(request.seed) : newSeed(),
  };
  const provider = options.provider ?? defaultImageProvider();
  const timeoutMs = options.timeoutMs ?? 120000;
  const retries = Math.max(0, options.retries ?? 2);
  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw cancelled();
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeoutMs);
    const follow = () => ctl.abort();
    options.signal?.addEventListener('abort', follow, { once: true });
    try {
      return await provider.generate(job, ctl.signal);
    } catch (err) {
      if (options.signal?.aborted) throw cancelled();
      let error: ImageGenError;
      if (timedOut) error = new ImageGenError('timeout', 'The picture took too long to make.', true);
      else if (err instanceof ImageGenError) error = err;
      else error = new ImageGenError('network', 'Could not reach the image service. Check the internet connection and try again.', true);
      if (!error.retryable || attempt >= retries) throw error;
      options.onRetry?.(attempt + 1, error);
      await wait(error.code === 'rate-limited' ? 5000 * (attempt + 1) : 1500 * Math.pow(2, attempt), options.signal);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', follow);
    }
  }
}

/** A message for the person using the app, for any error generateImage throws. */
export function describeImageError(error: unknown): string {
  if (error instanceof ImageGenError) return error.message;
  return 'The picture could not be made. Please try again.';
}

/** Save the picture to the device (opens it in a new tab when the browser could not read its bytes). */
export function downloadImage(image: GeneratedImage, name?: string): void {
  const type = image.blob ? image.blob.type : '';
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const base = (name || image.prompt).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  const link = document.createElement('a');
  link.href = image.url;
  if (image.blob) {
    link.download = base + '.' + ext;
  } else {
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Free the memory a picture holds once it is no longer shown. */
export function releaseImage(image: GeneratedImage | null | undefined): void {
  if (image && image.blob && image.url.startsWith('blob:')) URL.revokeObjectURL(image.url);
}
`;
}

// ── React hook: src/lib/useImageGenerator.ts ────────────────────────────────────────────────────────
const REACT_HOOK = `// React state for making pictures: status, the current picture, errors, retry and cancel.
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeImageError, generateImage, releaseImage } from './imageAi';
import type { GeneratedImage, ImageRequest } from './imageAi';

export type ImageStatus = 'idle' | 'generating' | 'done' | 'error';

export function useImageGenerator() {
  const [status, setStatus] = useState<ImageStatus>('idle');
  const [image, setImage] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 0 on the first try; 1, 2, ... while retrying after a busy or slow answer. */
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const current = useRef<GeneratedImage | null>(null);
  const last = useRef<ImageRequest | null>(null);

  useEffect(() => () => {
    controller.current?.abort();
    releaseImage(current.current);
  }, []);

  const generate = useCallback(async (request: ImageRequest) => {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    last.current = request;
    setStatus('generating');
    setError(null);
    setAttempt(0);
    try {
      const made = await generateImage(request, { signal: ctl.signal, onRetry: (n) => setAttempt(n) });
      if (ctl.signal.aborted) {
        releaseImage(made);
        return;
      }
      releaseImage(current.current);
      current.current = made;
      setImage(made);
      setStatus('done');
    } catch (err) {
      if (ctl.signal.aborted) return;
      setError(describeImageError(err));
      setStatus('error');
    }
  }, []);

  /** Try the last description again. */
  const retry = useCallback(() => {
    if (last.current) void generate(last.current);
  }, [generate]);

  /** Same description, a new picture. */
  const again = useCallback(() => {
    if (!last.current) return;
    const next: ImageRequest = { prompt: last.current.prompt };
    if (last.current.width !== undefined) next.width = last.current.width;
    if (last.current.height !== undefined) next.height = last.current.height;
    void generate(next);
  }, [generate]);

  const cancel = useCallback(() => {
    controller.current?.abort();
    setStatus(current.current ? 'done' : 'idle');
  }, []);

  return { status, image, error, attempt, isGenerating: status === 'generating', generate, retry, again, cancel };
}
`;

// ── Server module: server/lib/imageAi.ts ────────────────────────────────────────────────────────────
const SERVER_MODULE = `// AI image generation on this app's server. The engine is chosen from settings on EVERY request.
// Every engine needs an API key — save ONE of these (NavBharatAI → More → Keys & Secrets):
//
//   NAVBHARATAI_API_KEY   -> NavBharatAI (Home → Other AI → Developer Tools → NavBharatAI API, "Images")
//   OPENAI_API_KEY        -> OpenAI Images            (https://platform.openai.com/api-keys)
//   GEMINI_API_KEY        -> Google Gemini            (https://aistudio.google.com/apikey)
//   XAI_API_KEY           -> xAI Grok                 (https://console.x.ai)
//   POLLINATIONS_API_KEY  -> Pollinations, sk_ key    (https://enter.pollinations.ai)
//
// Or name it yourself: IMAGE_PROVIDER (navbharatai | openai | gemini | xai | pollinations | stability) and
// IMAGE_API_KEY, plus IMAGE_BASE_URL for any OpenAI-compatible images API. With no key at all, a request is
// answered "this app needs an image API key" — never sent anywhere.
//
// IMAGE_MODEL picks the model; IMAGE_RATE_PER_MINUTE limits pictures per visitor per minute (default 10,
// 0 turns it off). Change any of them and restart the server — no code change. The key is read only
// here, on the server, and is never sent to the browser or written into a response.
//
// Mount it:  app.post('/api/generate-image', express.json({ limit: '16kb' }), imageRoute());

export interface ImageJob {
  prompt: string;
  width: number;
  height: number;
  seed: number;
}

export interface ImageResult {
  bytes: Uint8Array;
  contentType: string;
  provider: string;
}

export class ImageServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: string | null;
  constructor(status: number, code: string, message: string, retryAfter: string | null = null) {
    super(message);
    this.name = 'ImageServiceError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** One image engine. Add another by implementing this and returning it from chooseImageProvider(). */
export interface ImageGenerationProvider {
  readonly name: string;
  generate(job: ImageJob, signal: AbortSignal): Promise<ImageResult>;
}

type Env = Record<string, string | undefined>;

const MAX_PROMPT_LENGTH = 1000;
const TIMEOUT_MS = 90000;

function setting(env: Env, name: string): string {
  return (env[name] || '').trim();
}

function pixels(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 1024;
  return Math.min(1536, Math.max(256, n));
}

function sniffType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  return 'image/png';
}

/** Turn a provider's refusal into an error that is safe to show a visitor (details go to the log). */
function upstreamError(provider: string, res: Response): ImageServiceError {
  const status = res.status;
  console.error('[image] ' + provider + ' answered HTTP ' + status);
  if (status === 400 || status === 422) {
    return new ImageServiceError(400, 'invalid-prompt', 'The image service could not use that description. Try different words.');
  }
  if (status === 401 || status === 402 || status === 403) {
    console.error('[image] the provider refused the request: check IMAGE_PROVIDER and IMAGE_API_KEY on this server.');
    return new ImageServiceError(502, 'refused', 'The image service is not accepting requests right now. Please try again later.');
  }
  if (status === 429) {
    return new ImageServiceError(429, 'rate-limited', 'The image service is busy. Please wait a moment and try again.', res.headers.get('retry-after'));
  }
  return new ImageServiceError(502, 'failed', 'The image service had a problem making this picture. Please try again.');
}

async function readImage(provider: string, res: Response): Promise<ImageResult> {
  if (!res.ok) throw upstreamError(provider, res);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new ImageServiceError(502, 'failed', 'The image service answered without a picture.');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) throw new ImageServiceError(502, 'failed', 'The image service sent an empty picture.');
  return { bytes, contentType: type.split(';')[0] || 'image/png', provider };
}

function pollinations(key: string, model: string): ImageGenerationProvider {
  const name = 'Pollinations AI';
  return {
    name,
    async generate(job, signal) {
      // safe: the nudity and violence filters by name (on this API safe=true alone is only privacy).
      // private=true: keep the picture off the provider's public feed. The key goes in a header, never the address.
      const query = '?width=' + job.width + '&height=' + job.height + '&seed=' + job.seed +
        (model ? '&model=' + encodeURIComponent(model) : '') + '&nologo=true&private=true&safe=privacy,secrets,sexual,violence';
      const url = 'https://gen.pollinations.ai/image/' + encodeURIComponent(job.prompt) + query;
      return readImage(name, await fetch(url, { signal, headers: { Authorization: 'Bearer ' + key } }));
    },
  };
}

function fromBase64(name: string, b64: string): ImageResult {
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  if (bytes.length === 0) throw new ImageServiceError(502, 'failed', 'The image service sent an empty picture.');
  return { bytes, contentType: sniffType(bytes), provider: name };
}

function navbharatai(key: string, baseUrl: string): ImageGenerationProvider {
  const name = 'NavBharatAI';
  return {
    name,
    async generate(job, signal) {
      const res = await fetch((baseUrl || 'https://navbharatai.com/api/v1').replace(/[/]+$/, '') + '/images/generations', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: job.prompt, size: job.width + 'x' + job.height }),
        signal,
      });
      if (!res.ok) throw upstreamError(name, res);
      const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
      const first = data.data ? data.data[0] : undefined;
      if (first && first.b64_json) return fromBase64(name, first.b64_json);
      throw new ImageServiceError(502, 'failed', 'The image service answered without a picture.');
    },
  };
}

function gemini(key: string, model: string): ImageGenerationProvider {
  const name = 'Google Gemini';
  return {
    name,
    async generate(job, signal) {
      const shape = job.width > job.height * 1.15 ? ' (a wide 16:9 picture)' : job.height > job.width * 1.15 ? ' (a tall 9:16 picture)' : '';
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model || 'gemini-2.5-flash-image') + ':generateContent', {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: job.prompt + shape }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
        signal,
      });
      if (!res.ok) throw upstreamError(name, res);
      const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> };
      for (const c of data.candidates || []) {
        for (const part of (c.content && c.content.parts) || []) {
          if (part.inlineData && part.inlineData.data) return fromBase64(name, part.inlineData.data);
        }
      }
      throw new ImageServiceError(502, 'failed', 'The image service answered without a picture.');
    },
  };
}

function xai(key: string, model: string): ImageGenerationProvider {
  const name = 'xAI Grok';
  return {
    name,
    async generate(job, signal) {
      const res = await fetch('https://api.x.ai/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'grok-2-image', prompt: job.prompt, n: 1, response_format: 'b64_json' }),
        signal,
      });
      if (!res.ok) throw upstreamError(name, res);
      const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
      const first = data.data ? data.data[0] : undefined;
      if (first && first.b64_json) return fromBase64(name, first.b64_json);
      throw new ImageServiceError(502, 'failed', 'The image service answered without a picture.');
    },
  };
}

function openAiImages(key: string, model: string, baseUrl: string): ImageGenerationProvider {
  const name = 'OpenAI-compatible images';
  return {
    name,
    async generate(job, signal) {
      const m = model || 'gpt-image-1';
      const dalle = m.startsWith('dall-e');
      const wide = job.width > job.height;
      const tall = job.height > job.width;
      const size = m === 'dall-e-2'
        ? '1024x1024'
        : wide ? (dalle ? '1792x1024' : '1536x1024') : tall ? (dalle ? '1024x1792' : '1024x1536') : '1024x1024';
      const payload: Record<string, unknown> = { model: m, prompt: job.prompt, n: 1, size };
      if (dalle) payload['response_format'] = 'b64_json';
      const res = await fetch((baseUrl || 'https://api.openai.com/v1').replace(/[/]+$/, '') + '/images/generations', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok) throw upstreamError(name, res);
      const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      const first = data.data ? data.data[0] : undefined;
      if (first && first.b64_json) {
        const bytes = new Uint8Array(Buffer.from(first.b64_json, 'base64'));
        return { bytes, contentType: sniffType(bytes), provider: name };
      }
      if (first && first.url) return readImage(name, await fetch(first.url, { signal }));
      throw new ImageServiceError(502, 'failed', 'The image service answered without a picture.');
    },
  };
}

function aspectRatio(width: number, height: number): string {
  const ratios: Array<[string, number]> = [
    ['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['3:2', 3 / 2], ['2:3', 2 / 3],
    ['4:5', 4 / 5], ['5:4', 5 / 4], ['21:9', 21 / 9], ['9:21', 9 / 21],
  ];
  const want = Math.log(width / height);
  let best = '1:1';
  let gap = Infinity;
  for (const [label, r] of ratios) {
    const d = Math.abs(Math.log(r) - want);
    if (d < gap) {
      gap = d;
      best = label;
    }
  }
  return best;
}

function stability(key: string, model: string): ImageGenerationProvider {
  const name = 'Stability AI';
  return {
    name,
    async generate(job, signal) {
      const form = new FormData();
      form.append('prompt', job.prompt);
      form.append('aspect_ratio', aspectRatio(job.width, job.height));
      form.append('output_format', 'png');
      form.append('seed', String(job.seed % 4294967294));
      const path = model === 'ultra' ? 'ultra' : model.startsWith('sd3') ? 'sd3' : 'core';
      if (path === 'sd3') form.append('model', model);
      const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/' + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, Accept: 'image/*' },
        body: form,
        signal,
      });
      return readImage(name, res);
    },
  };
}

/** The keys this server recognises by name, in the order they are tried. */
const NAMED_KEYS: Array<[string, string]> = [
  ['navbharatai', 'NAVBHARATAI_API_KEY'],
  ['openai', 'OPENAI_API_KEY'],
  ['gemini', 'GEMINI_API_KEY'],
  ['xai', 'XAI_API_KEY'],
  ['xai', 'GROK_API_KEY'],
  ['pollinations', 'POLLINATIONS_API_KEY'],
];

const NEEDS_KEY = 'This app needs an image API key before it can make pictures. The owner adds one (NavBharatAI, OpenAI, Gemini, Grok or Pollinations) in NavBharatAI → More → Keys & Secrets.';

/** Whose key is this, from its shape alone — only for the prefixes that cannot be mistaken. */
function providerFromKeyShape(key: string): string {
  if (key.indexOf('nbai_') === 0) return 'navbharatai';
  if (key.indexOf('xai-') === 0) return 'xai';
  if (key.indexOf('AIza') === 0) return 'gemini';
  if (key.indexOf('sk_') === 0) return 'pollinations';
  if (key.indexOf('sk-') === 0) return 'openai';
  return '';
}

/** The engine for this request, from this server's settings. No key means an honest error, never a guess. */
export function chooseImageProvider(env: Env = process.env): ImageGenerationProvider {
  let key = setting(env, 'IMAGE_API_KEY');
  let provider = setting(env, 'IMAGE_PROVIDER').toLowerCase();
  if (provider === 'grok') provider = 'xai';
  if (provider === 'chatgpt') provider = 'openai';
  const model = setting(env, 'IMAGE_MODEL');
  if (!key) {
    const named = NAMED_KEYS.find(([p, name]) => setting(env, name) !== '' && (provider === '' || provider === p));
    if (named) {
      provider = named[0];
      key = setting(env, named[1]);
    }
  }
  if (!key) {
    console.error('[image] no image API key is set — save one of: ' + NAMED_KEYS.map(([, n]) => n).join(', ') + '.');
    throw new ImageServiceError(503, 'needs-key', NEEDS_KEY);
  }
  if (!provider) provider = providerFromKeyShape(key);
  if (provider === 'navbharatai') return navbharatai(key, setting(env, 'IMAGE_BASE_URL'));
  if (provider === 'pollinations') return pollinations(key, model);
  if (provider === 'openai') return openAiImages(key, model, setting(env, 'IMAGE_BASE_URL'));
  if (provider === 'gemini') return gemini(key, model);
  if (provider === 'xai') return xai(key, model);
  if (provider === 'stability') return stability(key, model);
  // A key is set but we cannot tell whose it is: sending it to the wrong company would leak it.
  console.error('[image] IMAGE_API_KEY is set but IMAGE_PROVIDER is "' + provider + '" — use navbharatai, openai, gemini, xai, pollinations or stability.');
  throw new ImageServiceError(500, 'not-configured', 'Image generation is not set up correctly on this server.');
}

const visitors = new Map<string, { start: number; count: number }>();

function withinLimit(client: string, env: Env): boolean {
  const raw = setting(env, 'IMAGE_RATE_PER_MINUTE');
  const parsed = raw === '' ? NaN : Number(raw);
  const limit = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 10;
  if (limit === 0) return true;
  const now = Date.now();
  const seen = visitors.get(client);
  if (!seen || now - seen.start >= 60000) {
    if (visitors.size > 5000) visitors.clear();
    visitors.set(client, { start: now, count: 1 });
    return true;
  }
  seen.count += 1;
  return seen.count <= limit;
}

export interface ImageResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | { error: string; code: string };
}

function failure(status: number, code: string, error: string, extra: Record<string, string> = {}): ImageResponse {
  return { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra }, body: { error, code } };
}

/** Framework-free: validate the request, rate-limit it, call the engine, and describe the answer. */
export async function handleImageRequest(input: unknown, client: string, env: Env = process.env): Promise<ImageResponse> {
  const body = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const rawPrompt = body['prompt'];
  const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : '';
  if (!prompt) return failure(400, 'invalid-prompt', 'Please describe the picture you want.');
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return failure(400, 'invalid-prompt', 'That description is too long. Please keep it under ' + MAX_PROMPT_LENGTH + ' characters.');
  }
  if (!withinLimit(client, env)) {
    return failure(429, 'rate-limited', 'Too many pictures were requested. Please wait a minute and try again.', { 'Retry-After': '60' });
  }
  const rawSeed = body['seed'];
  const job: ImageJob = {
    prompt,
    width: pixels(body['width']),
    height: pixels(body['height']),
    seed: typeof rawSeed === 'number' && Number.isInteger(rawSeed) && rawSeed >= 0 ? rawSeed : Math.floor(Math.random() * 2147483647),
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const made = await chooseImageProvider(env).generate(job, ctl.signal);
    return {
      status: 200,
      headers: { 'Content-Type': made.contentType, 'Cache-Control': 'no-store', 'X-Image-Provider': made.provider },
      body: made.bytes,
    };
  } catch (err) {
    if (err instanceof ImageServiceError) {
      return failure(err.status, err.code, err.message, err.retryAfter ? { 'Retry-After': err.retryAfter } : {});
    }
    if (ctl.signal.aborted) return failure(504, 'timeout', 'The picture took too long to make. Please try again.');
    console.error('[image] generation failed:', err instanceof Error ? err.message : String(err));
    return failure(502, 'network', 'Could not reach the image service. Please try again.');
  } finally {
    clearTimeout(timer);
  }
}

interface RequestLike {
  body?: unknown;
  ip?: string;
}

interface ResponseLike {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
  send(body: unknown): unknown;
  json(body: unknown): unknown;
}

/** An Express-style handler for POST /api/generate-image (needs a JSON body parser in front of it). */
export function imageRoute() {
  return async (req: RequestLike, res: ResponseLike): Promise<void> => {
    const out = await handleImageRequest(req.body, req.ip || 'anonymous');
    res.status(out.status);
    for (const [name, value] of Object.entries(out.headers)) res.setHeader(name, value);
    if (out.body instanceof Uint8Array) res.send(Buffer.from(out.body));
    else res.json(out.body);
  };
}
`;

const BROWSER_UI =
  'Build the screen with: a prompt box (and optional size choice), a Generate button disabled while a ' +
  'picture is being made, a visible progress state (say "Trying again..." when attempt > 0), the picture ' +
  'in an <img> with alt set to the prompt, a Download button (downloadImage), a "Generate another" button, ' +
  'and errors shown in words (describeImageError) with a Retry button. Never show a placeholder, stock or ' +
  'random photo as a result.';

/**
 * What the builder must tell the user, every time (admin 2026-10-04): an image API key is REQUIRED, which
 * keys work, where each is made, and where to paste it. Never "free" or "no key needed".
 */
export const KEY_GUIDANCE =
  'IN YOUR FINAL MESSAGE, SAY PLAINLY that the pictures need an image API key, and list these options, ' +
  'each with where to get it: ' + appImageKeyOptionsText().replace(/\n/g, ' ') + ' Tell them to paste the ' +
  'one they choose in ' + APP_KEYS_PLACE + ' under the exact name shown. Never say the pictures are free or ' +
  'that no key is needed.';

export function generateImageAiIntegration(opts: ImageAiOptions): ImageAiConfig {
  const files: Record<string, string> = { 'src/lib/imageAi.ts': clientModule(opts.server) };
  if (opts.react) files['src/lib/useImageGenerator.ts'] = REACT_HOOK;
  const hook = opts.react
    ? ' In React use useImageGenerator() from src/lib/useImageGenerator.ts (status, image, error, attempt, ' +
      'generate, retry, again, cancel).'
    : '';
  if (!opts.server) {
    return {
      files,
      envKeys: [],
      instructions:
        'AI image generation wired through NavBharatAI: the page calls window.NavAI.image(), and NavBharatAI ' +
        'makes each picture on its server with the image API key the app\'s owner saves — the key never reaches ' +
        'the page. Call generateImage({ prompt, width, height }) from src/lib/imageAi.ts; it returns a ' +
        'GeneratedImage (url, blob, provider) and throws ImageGenError with a code and a message a person can ' +
        'read (code "needs-key" when no key is saved yet — show its message as it is).' + hook + ' ' + BROWSER_UI +
        ' It works in the NavBharatAI preview and in the published app. ' + KEY_GUIDANCE,
    };
  }
  files['server/lib/imageAi.ts'] = SERVER_MODULE;
  files[ENV_EXAMPLE] = 'IMAGE_PROVIDER=\nIMAGE_API_KEY=\nIMAGE_MODEL=\nIMAGE_BASE_URL=\nIMAGE_RATE_PER_MINUTE=\n';
  return {
    files,
    envKeys: [...IMAGE_ENV_KEYS],
    instructions:
      'AI image generation wired through this app\'s server. Mount the route on the app\'s server (add a ' +
      'small Express server if the app has none): app.post(\'' + IMAGE_ENDPOINT + '\', express.json({ limit: ' +
      '\'16kb\' }), imageRoute()) with imageRoute from server/lib/imageAi.ts, and make sure the dev setup ' +
      'sends ' + IMAGE_ENDPOINT + ' to that server (for Vite, a server.proxy entry for /api). The browser ' +
      'calls generateImage({ prompt, width, height }) from src/lib/imageAi.ts, which posts to that route.' + hook +
      ' ' + BROWSER_UI + ' The server reads the image key by its name (or IMAGE_PROVIDER + IMAGE_API_KEY, and ' +
      'IMAGE_BASE_URL for any OpenAI-compatible images API); a change applies the next time the server starts, ' +
      'with no code change, and the key stays on the server. ' + KEY_GUIDANCE,
  };
}
