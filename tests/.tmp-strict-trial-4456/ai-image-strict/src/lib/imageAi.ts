// AI image generation for this app — a description in, a picture out.
//
// MODE: browser. The page calls Pollinations AI directly — it needs no key, so there is nothing secret
// here. To use your own image provider key, add a server route (the key must never be in browser code).
//
// To add another engine, implement ImageGenerationProvider and pass it as { provider } to generateImage().

export type ImageErrorCode =
  | 'invalid-prompt'
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
const SERVER_ENDPOINT: string | null = null;

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

/**
 * Show a picture the browser will not hand to this page as bytes (another site's image without the
 * header that allows it). It still displays; only downloadImage falls back to opening it.
 */
function showWithoutReading(src: string, job: ImageJob, provider: string, signal: AbortSignal): Promise<GeneratedImage> {
  return new Promise<GeneratedImage>((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new ImageGenError('network', 'Could not reach the image service. Check the internet connection and try again.', true));
      return;
    }
    const img = new Image();
    const stop = () => {
      img.src = '';
      reject(cancelled());
    };
    signal.addEventListener('abort', stop, { once: true });
    img.onload = () => {
      signal.removeEventListener('abort', stop);
      resolve({ url: src, blob: null, prompt: job.prompt, seed: job.seed, width: job.width, height: job.height, provider });
    };
    img.onerror = () => {
      signal.removeEventListener('abort', stop);
      reject(new ImageGenError('network', 'Could not reach the image service. Check the internet connection and try again.', true));
    };
    img.src = src;
  });
}

/** Pollinations AI — free, no key, no account. The default engine. */
export class PollinationsProvider implements ImageGenerationProvider {
  readonly name = 'Pollinations AI';
  private readonly model: string;
  constructor(model?: string) {
    this.model = model || 'flux';
  }
  url(job: ImageJob): string {
    // safe=true turns on the provider's own adult-content filter (it is off unless asked for);
    // private=true keeps the picture off the provider's public feed.
    return 'https://image.pollinations.ai/prompt/' + encodeURIComponent(job.prompt) +
      '?width=' + job.width + '&height=' + job.height + '&seed=' + job.seed +
      '&model=' + encodeURIComponent(this.model) + '&nologo=true&private=true&safe=true';
  }
  async generate(job: ImageJob, signal: AbortSignal): Promise<GeneratedImage> {
    const src = this.url(job);
    let res: Response;
    try {
      res = await fetch(src, { signal });
    } catch (err) {
      if (signal.aborted) throw err;
      return showWithoutReading(src, job, this.name, signal);
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        throw new ImageGenError('refused', 'The free image service is not accepting requests right now. Please try again later.', false);
      }
      throw errorForStatus(res.status);
    }
    return imageFromResponse(res, job, this.name);
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
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === 'string') message = body.error;
      } catch {
        // Not JSON — the status alone decides the message.
      }
      throw errorForStatus(res.status, message);
    }
    return imageFromResponse(res, job, res.headers.get('x-image-provider') || this.name);
  }
}

/** The engine this app uses unless you pass another one. */
export function defaultImageProvider(): ImageGenerationProvider {
  return SERVER_ENDPOINT ? new ServerImageProvider(SERVER_ENDPOINT) : new PollinationsProvider();
}

export interface GenerateOptions {
  provider?: ImageGenerationProvider;
  /** Give up on one attempt after this many milliseconds (default 60000). */
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
  const timeoutMs = options.timeoutMs ?? 60000;
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
    link.target = '_blank';
    link.rel = 'noopener';
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Free the memory a picture holds once it is no longer shown. */
export function releaseImage(image: GeneratedImage | null | undefined): void {
  if (image && image.blob && image.url.startsWith('blob:')) URL.revokeObjectURL(image.url);
}
