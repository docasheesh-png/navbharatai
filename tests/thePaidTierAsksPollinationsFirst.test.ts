// The PAID tier asks Pollinations first, with OUR key, from OUR server — and the key never leaves it.
//
// Admin, 2026-09-21: "free wale me user ki ip, paid me hamari … paid pahle pollination use ho, fallback
// me IMAGE_PRO_KEY. ham 1 rup lenge." — and, ordering the work: "private=true + token padhne ka code —
// privacy + watermark — sabse zaroori."
//
// What this suite holds:
//   • the key is read the way every key in this repo is read (trimmed; whitespace is UNSET);
//   • a key alone makes Pro REAL — one owner (`imageProAvailable`) for the chip and the 503;
//   • the keyed URL asks for `private` and `nologo`, and NEVER contains the key however the env is set;
//   • the fetch sends the key in a HEADER, captures the provider's `x-usage-*` cost headers, and turns
//     every failure into an admin line that names the status — never a throw, never a placeholder;
//   • the FREE link now carries `private=true` and still carries no key;
//   • the route tries this rung BEFORE the host, for words only, and never surfaces the vendor's error.
// The last group is SOURCE-level, because `tsc` and `vitest` cannot see the ORDER two engines are asked
// in — which is exactly how a "fallback" quietly becomes the primary.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  POLLINATIONS_PAID_BASE, POLLINATIONS_PAID_MODEL_DEFAULT, POLLINATIONS_PAID_TIMEOUT_MS,
  pollinationsKey, pollinationsPaidModel, pollinationsPaidConfigured, imageProAvailable,
  pollinationsPaidImageUrl, pollinationsAuthHeaders, usageFromHeaders, describePollinationsStatus,
  fetchPollinationsPaidImage,
} from '../src/server/lib/pollinationsPaid';
import { pollinationsImageUrl } from '../src/server/lib/imageGen';
import { IMAGE_PRO_TIMEOUT_MS } from '../src/server/lib/imageProGen';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const KEY = 'sk_test_0123456789abcdef';
const HOST = { IMAGE_PRO_KEY: 'hk', IMAGE_PRO_ENDPOINT: 'https://host/x' };

const fakeHeaders = (map: Record<string, string>) => ({
  get: (n: string) => map[n.toLowerCase()] ?? null,
  forEach: (cb: (v: string, n: string) => void) => { for (const [n, v] of Object.entries(map)) cb(v, n); },
});
const imageResponse = (extra: Record<string, string> = {}, bytes = 4) => ({
  ok: true, status: 200,
  headers: fakeHeaders({ 'content-type': 'image/png', ...extra }),
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
});

describe('the key is read like every key in this repo', () => {
  it('trimmed, and whitespace-only is UNSET (the BRAVE_API_KEY lesson)', () => {
    expect(pollinationsKey(env({ POLLINATIONS_API_KEY: `  ${KEY}\n` }))).toBe(KEY);
    expect(pollinationsKey(env({ POLLINATIONS_API_KEY: ' \n ' }))).toBe('');
    expect(pollinationsKey(env({}))).toBe('');
  });

  it('the rung is configured by a key, and either kill switch turns it off', () => {
    expect(pollinationsPaidConfigured(env({}))).toBe(false);
    expect(pollinationsPaidConfigured(env({ POLLINATIONS_API_KEY: KEY }))).toBe(true);
    expect(pollinationsPaidConfigured(env({ POLLINATIONS_API_KEY: KEY, IMAGE_PRO_POLLINATIONS: 'off' }))).toBe(false);
    // The provider-wide switch means "not this vendor", paid included.
    expect(pollinationsPaidConfigured(env({ POLLINATIONS_API_KEY: KEY, IMAGE_GEN_POLLINATIONS: 'off' }))).toBe(false);
    expect(pollinationsPaidConfigured(env({ POLLINATIONS_API_KEY: ' ' }))).toBe(false);
  });

  it('the model has a default that matches what the Pro tier was priced around, and an override', () => {
    expect(pollinationsPaidModel(env({}))).toBe(POLLINATIONS_PAID_MODEL_DEFAULT);
    expect(POLLINATIONS_PAID_MODEL_DEFAULT).toMatch(/z-image-turbo/);
    expect(pollinationsPaidModel(env({ IMAGE_PRO_POLLINATIONS_MODEL: ' flux ' }))).toBe('flux');
  });
});

describe('🔑 ONE owner of "is Pro on?" — a key ALONE makes Pro real', () => {
  it('either engine is enough; neither is not', () => {
    expect(imageProAvailable(env({}))).toBe(false);
    expect(imageProAvailable(env({ POLLINATIONS_API_KEY: KEY }))).toBe(true);
    expect(imageProAvailable(env(HOST))).toBe(true);
    expect(imageProAvailable(env({ POLLINATIONS_API_KEY: KEY, ...HOST }))).toBe(true);
  });

  it('a half-configured host still counts as no host (the second absolute rule, unchanged)', () => {
    expect(imageProAvailable(env({ IMAGE_PRO_KEY: 'hk' }))).toBe(false);
    expect(imageProAvailable(env({ IMAGE_PRO_ENDPOINT: 'https://host/x' }))).toBe(false);
  });

  it('the Pro-host kill switch does not take the Pollinations rung down with it, and vice versa', () => {
    expect(imageProAvailable(env({ POLLINATIONS_API_KEY: KEY, ...HOST, IMAGE_PRO_ENABLED: 'off' }))).toBe(true);
    expect(imageProAvailable(env({ POLLINATIONS_API_KEY: KEY, ...HOST, IMAGE_PRO_POLLINATIONS: 'off' }))).toBe(true);
  });
});

describe('the keyed URL', () => {
  it('is on the keyed door, carries the prompt, the pixels, private AND nologo, and the model', () => {
    const url = pollinationsPaidImageUrl('a tea stall at dawn', 'wide', env({ POLLINATIONS_API_KEY: KEY, __IMAGE_SEED: '9' }));
    expect(url.startsWith(`${POLLINATIONS_PAID_BASE}/image/`)).toBe(true);
    expect(url).toContain(encodeURIComponent('a tea stall at dawn'));
    expect(url).toContain('width=1280');
    expect(url).toContain('height=720');
    expect(url).toContain('private=true');
    expect(url).toContain('nologo=true');
    expect(url).toContain('seed=9');
    expect(url).toContain(`model=${encodeURIComponent(POLLINATIONS_PAID_MODEL_DEFAULT)}`);
  });

  it('🔒 NEVER contains the key, however the env is set — the key is not an input, so it cannot be an output', () => {
    for (const e of [
      { POLLINATIONS_API_KEY: KEY },
      { POLLINATIONS_API_KEY: KEY, IMAGE_PRO_POLLINATIONS_MODEL: 'flux' },
      { POLLINATIONS_API_KEY: KEY, __IMAGE_SEED: '1' },
    ]) {
      const url = pollinationsPaidImageUrl('x', 'square', env(e));
      expect(url).not.toContain('sk_test');
      expect(url).not.toMatch(/[?&]key=/i);
      expect(url).not.toMatch(/authorization/i);
    }
  });

  it('⚠️ the seed pin works — it never had (an env value is a string, and Number.isFinite("5") is false)', () => {
    const a = pollinationsPaidImageUrl('x', 'square', env({ __IMAGE_SEED: '9' }));
    const b = pollinationsImageUrl('x', 'square', env({ __IMAGE_SEED: '9' }));
    expect(a).toContain('seed=9');
    expect(b).toContain('seed=9');
    // A blank pin is UNSET, not seed 0 — `Number('')` is 0.
    expect(pollinationsPaidImageUrl('x', 'square', env({ __IMAGE_SEED: '' }))).not.toMatch(/seed=0&/);
  });

  it('honours a custom size through the SAME resolver the picker uses', () => {
    const url = pollinationsPaidImageUrl('x', 'custom', env({}), { width: 1536, height: 512 });
    expect(url).toContain('width=1536');
    expect(url).toContain('height=512');
  });

  it('the auth header is Bearer, and no key means no header at all', () => {
    expect(pollinationsAuthHeaders(env({ POLLINATIONS_API_KEY: KEY }))).toEqual({ Authorization: `Bearer ${KEY}` });
    expect(pollinationsAuthHeaders(env({}))).toEqual({});
  });
});

describe('💰 the cost is MEASURED from the provider\'s own headers', () => {
  it('keeps every x-usage-* header, lower-cased, and nothing else', () => {
    const got = usageFromHeaders(fakeHeaders({
      'X-Usage-Cost': '0.0021', 'x-usage-model': 'z', 'content-type': 'image/png', 'x-request-id': 'r',
    }));
    expect(got).toEqual({ 'x-usage-cost': '0.0021', 'x-usage-model': 'z' });
  });

  it('an absent set is an EMPTY record — never an invented number', () => {
    expect(usageFromHeaders(fakeHeaders({ 'content-type': 'image/png' }))).toEqual({});
  });

  it('names the lock that tripped, so the log is actionable without the vendor\'s docs open', () => {
    expect(describePollinationsStatus(401)).toMatch(/POLLINATIONS_API_KEY/);
    expect(describePollinationsStatus(402)).toMatch(/pollen/);
    expect(describePollinationsStatus(403)).toMatch(/permission/);
    expect(describePollinationsStatus(429)).toMatch(/rate/);
    expect(describePollinationsStatus(500)).toBe('HTTP 500');
  });
});

describe('the fetch', () => {
  const paid = env({ POLLINATIONS_API_KEY: KEY, __IMAGE_SEED: '3' });

  it('is a no-op when the rung is not configured — zero calls', async () => {
    let calls = 0;
    const r = await fetchPollinationsPaidImage('x', 'square', { env: env({}), fetchImpl: (async () => { calls += 1; return imageResponse(); }) as unknown as typeof fetch });
    expect(r).toEqual({ disabled: true });
    expect(calls).toBe(0);
  });

  it('🔒 sends the key in the Authorization HEADER and never in the URL', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const r = await fetchPollinationsPaidImage('a cat', 'square', {
      env: paid,
      fetchImpl: (async (url: string, init: { headers: Record<string, string> }) => {
        seen = { url, headers: init.headers };
        return imageResponse({ 'x-usage-cost': '0.002' });
      }) as unknown as typeof fetch,
    });
    expect(seen).not.toBeNull();
    expect(seen!.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(seen!.url).not.toContain('sk_test');
    expect(seen!.url).toContain('private=true');
    expect(r.image?.mimeType).toBe('image/png');
    expect(r.image?.base64.length).toBeGreaterThan(0);
    expect(r.usage).toEqual({ 'x-usage-cost': '0.002' });
  });

  it('a rejected key, an empty wallet and a forbidden model are each an admin line with the status', async () => {
    for (const status of [401, 402, 403, 429, 500]) {
      const r = await fetchPollinationsPaidImage('x', 'square', {
        env: paid,
        fetchImpl: (async () => ({ ok: false, status, headers: fakeHeaders({}), arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as typeof fetch,
      });
      expect(r.image).toBeUndefined();
      expect(r.status).toBe(status);
      expect(r.error).toContain(`HTTP ${status}`);
    }
  });

  it('a 200 that is not an image, or an empty body, is a failure — never a placeholder', async () => {
    const html = await fetchPollinationsPaidImage('x', 'square', {
      env: paid,
      fetchImpl: (async () => ({ ok: true, status: 200, headers: fakeHeaders({ 'content-type': 'text/html' }), arrayBuffer: async () => new ArrayBuffer(3) })) as unknown as typeof fetch,
    });
    expect(html.image).toBeUndefined();
    expect(html.error).toMatch(/non-image/);
    const empty = await fetchPollinationsPaidImage('x', 'square', { env: paid, fetchImpl: (async () => imageResponse({}, 0)) as unknown as typeof fetch });
    expect(empty.image).toBeUndefined();
    expect(empty.error).toMatch(/empty/);
  });

  it('a throw is caught and reported; an abort reads as a timeout', async () => {
    const boom = await fetchPollinationsPaidImage('x', 'square', { env: paid, fetchImpl: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch });
    expect(boom.error).toBe('ECONNRESET');
    const slow = await fetchPollinationsPaidImage('x', 'square', {
      env: paid, timeoutMs: 5,
      fetchImpl: ((_u: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => {
        init.signal.addEventListener('abort', () => rej(new Error('The operation was aborted')));
      })) as unknown as typeof fetch,
    });
    expect(slow.error).toBe('timed out');
  });

  it('its clock is SHORTER than the host\'s, because the two run in sequence and the client has no clock', () => {
    expect(POLLINATIONS_PAID_TIMEOUT_MS).toBeLessThan(IMAGE_PRO_TIMEOUT_MS);
  });
});

describe('the FREE link (private now, still keyless)', () => {
  it('asks for private, and the key is not in it even when the env has one', () => {
    const url = pollinationsImageUrl('x', 'square', env({ POLLINATIONS_API_KEY: KEY, __IMAGE_SEED: '1' }));
    expect(url).toContain('private=true');
    expect(url).not.toContain('sk_test');
    expect(url.startsWith('https://image.pollinations.ai/prompt/')).toBe(true);
  });
});

describe('🔒 SOURCE — the route asks this rung FIRST, for words only, and hides its wording from the user', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/imageGen.ts'), 'utf8');
  const pro = route.slice(route.indexOf("app.post('/api/image/pro/generate'"));
  const health = readFileSync(join(__dirname, '..', 'src/server/routes/health.ts'), 'utf8');

  it('the 503 gate asks the one owner, not the host alone', () => {
    expect(pro).toContain('if (!imageProAvailable())');
    expect(pro.indexOf('if (!imageProAvailable())')).toBeLessThan(pro.indexOf('fetchPollinationsPaidImage('));
    expect(health).toContain('imageProAvailable()');
  });

  it('an edit needs the host — the rung is words-only, and a photograph never becomes a link', () => {
    expect(pro).toMatch(/mode !== 'text-to-image' && !imageProConfigured\(\)/);
    expect(pro).toMatch(/if \(mode === 'text-to-image'\) \{\s*const pr = await fetchPollinationsPaidImage\(/);
  });

  it('the rung is tried BEFORE the host fetch, and the host runs only when nothing was delivered', () => {
    const rung = pro.indexOf('fetchPollinationsPaidImage(');
    const host = pro.indexOf('await fetch(imageProEndpoint()');
    expect(rung).toBeGreaterThan(0);
    expect(host).toBeGreaterThan(rung);
    const between = pro.slice(rung, host);
    expect(between).toContain('if (delivered.length === 0) {');
    expect(between).toContain('if (!imageProConfigured()) {');
  });

  it('🔒 the vendor\'s error wording goes to the LOG, never to `res`', () => {
    // `pr.error` names the vendor and the status on purpose (admin-only). The only `res.` calls in
    // the rung's own block are none — every response after it uses the branded message.
    const start = pro.indexOf('// RUNG 1');
    const end = pro.indexOf('// RUNG 2');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const rungBlock = pro.slice(start, end);
    expect(rungBlock).not.toMatch(/res\.(status|json)\(/);
    expect(rungBlock).toMatch(/console\.warn\(.*pr\.error/);
    expect(rungBlock).toMatch(/console\.log\(.*pr\.usage/);
  });

  it('the rung is charged at the same ₹1 and only on delivery — the charge reads `delivered`, not the engine', () => {
    expect(pro).toMatch(/const chargedInr = freeListed \? 0 : delivered\.length \* IMAGE_PRO_PRICE_INR;/);
  });
});
