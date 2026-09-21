// The ₹1 Pro tier would have been a dead button on the very host its price was built around.
//
// 🔴 THE FINDING, and it was one API-doc read away from costing the admin money for nothing:
// WaveSpeed — the vendor whose $0.005/image makes ₹1 profitable — is ASYNCHRONOUS by default. The
// POST answers with a prediction id and the picture appears at a separate result URL. Every one of
// its real response shapes came back `null` from our parser, so setting IMAGE_PRO_KEY and
// IMAGE_PRO_ENDPOINT correctly would have produced an honest "could not finish" on every press.
//
// ⚠️ AND THE NASTIEST SHAPE IS AN HTTP **200**: sync mode that outlives its ~120s wait window returns
// 200 with `code: 5004, status: processing`. A caller that stops at `r.ok` sees success, finds no
// image, and tells the user their picture failed — while it was still being made.
//
// The fixture shapes below are taken from WaveSpeed's own documented envelope, and each is named for
// the real case it represents rather than for the code path it exercises.

import { describe, it, expect } from 'vitest';
import {
  IMAGE_PRO_POLL_MS,
  buildImageProRequest,
  jobFailed,
  parseImageProResponse,
  pendingResultUrl,
} from '../src/server/lib/imageProGen';

const env = {} as NodeJS.ProcessEnv;
const px = { w: 1024, h: 1024 };

/** `{ code, message, data: { … } }` — the envelope every WaveSpeed response arrives in. */
const wave = (data: Record<string, unknown>, code = 200) => ({ code, message: 'success', data });
const RESULT_URL = 'https://api.wavespeed.ai/api/v3/predictions/pred_abc/result';

describe('the picture is found inside the host\'s own envelope', () => {
  it('reads data.outputs from a completed sync response', () => {
    const got = parseImageProResponse(wave({ id: 'pred_abc', status: 'completed', outputs: ['https://cdn.wavespeed.ai/x.png'] }));
    expect(got).toEqual({ url: 'https://cdn.wavespeed.ai/x.png' });
  });

  it('reads base64 inside the envelope too', () => {
    const got = parseImageProResponse(wave({ status: 'completed', outputs: [{ b64_json: 'QUJD', content_type: 'image/png' }] }));
    expect(got).toEqual({ base64: 'QUJD', mimeType: 'image/png' });
  });

  it('still reads the shapes it always read — no host regressed to fix another', () => {
    expect(parseImageProResponse({ images: [{ url: 'https://x/y.png' }] })).toEqual({ url: 'https://x/y.png' });
    expect(parseImageProResponse({ data: [{ b64_json: 'QUJD' }] })).toEqual({ base64: 'QUJD', mimeType: 'image/png' });
    expect(parseImageProResponse({ output: ['https://x/y.png'] })).toEqual({ url: 'https://x/y.png' });
    expect(parseImageProResponse({ result: { sample: 'https://x/y.png' } })).toEqual({ url: 'https://x/y.png' });
  });

  it('returns null for a body with no picture in it — "no image" stays an honest failure', () => {
    expect(parseImageProResponse(wave({ status: 'completed', outputs: [] }))).toBeNull();
    expect(parseImageProResponse({})).toBeNull();
    expect(parseImageProResponse(null)).toBeNull();
    expect(parseImageProResponse('nope')).toBeNull();
  });
});

describe('a job that has not finished is recognised, not reported as a failure', () => {
  it('spots the ordinary async submit', () => {
    expect(pendingResultUrl(wave({ id: 'pred_abc', status: 'created', urls: { get: RESULT_URL } }))).toBe(RESULT_URL);
  });

  it('🔴 spots sync mode timing out — an HTTP 200 carrying code 5004', () => {
    expect(pendingResultUrl(wave({ id: 'pred_abc', status: 'processing', urls: { get: RESULT_URL } }, 5004))).toBe(RESULT_URL);
  });

  it('does NOT call a finished job pending', () => {
    expect(pendingResultUrl(wave({ status: 'completed', outputs: ['https://x/y.png'], urls: { get: RESULT_URL } }))).toBeNull();
  });

  it('does NOT call a failed job pending — there is nothing to wait for', () => {
    expect(pendingResultUrl(wave({ status: 'failed', urls: { get: RESULT_URL } }))).toBeNull();
    expect(jobFailed(wave({ status: 'failed' }))).toBe(true);
    expect(jobFailed(wave({ status: 'cancelled' }))).toBe(true);
    expect(jobFailed(wave({ status: 'timeout' }))).toBe(true);
    expect(jobFailed(wave({ status: 'completed' }))).toBe(false);
  });

  it('never invents a poll URL the host did not give us', () => {
    // Building `…/predictions/<id>/result` ourselves would hardcode one vendor's URL shape into a
    // module that is deliberately host-agnostic, and be wrong for every other host.
    expect(pendingResultUrl(wave({ id: 'pred_abc', status: 'processing' }))).toBeNull();
    expect(pendingResultUrl(wave({ status: 'processing', urls: { get: 'not-a-url' } }))).toBeNull();
  });

  it('polls at a sane interval', () => {
    expect(IMAGE_PRO_POLL_MS).toBeGreaterThanOrEqual(1_000);
    expect(IMAGE_PRO_POLL_MS).toBeLessThanOrEqual(5_000);
  });
});

describe('the request asks for the result inline', () => {
  it('sends enable_sync_mode, so a fast job needs no polling at all', () => {
    expect(buildImageProRequest({ prompt: 'x' }, px, env).enable_sync_mode).toBe(true);
  });

  it('still sends everything it sent before', () => {
    const body = buildImageProRequest({ prompt: 'x' }, px, env);
    expect(body.prompt).toBe('x');
    expect(body.width).toBe(1024);
    expect(body.num_images).toBe(1);
  });
});

describe('the route waits for a pending job before it gives up', () => {
  // Source-level: the polling loop is I/O inside a route, and the failure it prevents is silent —
  // the user is told their picture could not be made while it is being made.
  const code = () =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('node:fs') as typeof import('node:fs'))
      .readFileSync(new URL('../src/server/routes/imageGen.ts', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

  it('polls while the job is pending', () => {
    const src = code();
    expect(src).toContain('pendingResultUrl(payload)');
    expect(/while \(!parsed && next/.test(src)).toBe(true);
  });

  it('stops on a reported failure rather than polling a dead job', () => {
    expect(code()).toContain('jobFailed(payload)');
  });

  it('is bounded by the SAME clock as the first call — no second, longer budget', () => {
    const src = code();
    expect(src).toContain('ctl.signal.aborted');
    expect(/fetch\(next, \{ headers: imageProAuthHeaders\(\), signal: ctl\.signal \}\)/.test(src)).toBe(true);
  });
});
