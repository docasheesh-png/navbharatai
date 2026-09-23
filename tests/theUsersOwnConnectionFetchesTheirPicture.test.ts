/**
 * "free wale me user ki ip" — the admin, 2026-09-21.
 *
 * 🔑 THE PROBLEM IS A RATE LIMIT, NOT A BILL. The free image provider allows one request every 15
 * seconds PER ADDRESS, and this server is ONE address — so every free user on the platform shares a
 * single bucket and, at any real scale, queues behind everybody else. Fetching from the browser puts
 * each user on their own connection. It is the only way to buy that capacity without a key.
 *
 * 🔴 AND THE FOUR FEATURES HAD TO SURVIVE IT (admin, same message: "yeh sab user ke ip par kaam kar
 * jaye, kisi bhi tarah"). Add text, Crop, Copy and Download all need the picture's real pixels, and
 * a browser may not read another site's pixels unless that site allows it. Whether this provider
 * allows it could not be checked from a Claude session, so nothing here assumes an answer: the
 * client tries, and when it cannot, our relay fetches the bytes once — on the press.
 *
 * ⚠️ The relay takes a URL from the CLIENT, which is a server-side request forgery waiting to
 * happen. Its two locks are the most important assertions in this file.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DIRECT_FETCH_THROW_LIMIT, IMAGE_FETCH_HOSTS, IMAGE_TICKET_TTL_MS,
  imageRetryBudgetMs, imageRetryDelaysMs, imageWaitMessage, isAllowedImageHost,
  shouldRetryImageStatus,
} from '../src/lib/imageDelivery';
import { clientImageFetchEnabled, signImageTicket, verifyImageTicket } from '../src/server/lib/imageTicket';
import { pollinationsImageUrl } from '../src/server/lib/imageGen';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROUTE = 'src/server/routes/imageGen.ts';
const CLIENT = 'src/components/ide/AIImageGenerator.tsx';

describe('🔴 the relay cannot be pointed anywhere else — SSRF', () => {
  it('only the provider’s exact hosts are allowed', () => {
    for (const host of IMAGE_FETCH_HOSTS) {
      expect(isAllowedImageHost(`https://${host}/prompt/a%20cat?width=1024`)).toBe(true);
    }
  });

  it('🔴 a host that merely CONTAINS an allowed one is refused', () => {
    // The classic bypass: a substring or regex check passes every one of these.
    for (const bad of [
      'https://image.pollinations.ai.evil.com/x',
      'https://evil.com/image.pollinations.ai',
      'https://evil.com/?a=image.pollinations.ai',
      'https://image.pollinations.ai.attacker.net/prompt/x',
    ]) expect(isAllowedImageHost(bad), bad).toBe(false);
  });

  it('🔴 and the addresses an SSRF is actually aimed at', () => {
    for (const bad of [
      'http://169.254.169.254/latest/meta-data/',        // cloud metadata
      'https://169.254.169.254/computeMetadata/v1/',
      'http://localhost:8080/admin',
      'https://127.0.0.1/',
      'http://[::1]:3000/',
      'https://10.0.0.5/internal',
      'file:///etc/passwd',
      'gopher://evil/x',
    ]) expect(isAllowedImageHost(bad), bad).toBe(false);
  });

  it('plain http is refused even on an allowed host', () => {
    expect(isAllowedImageHost('http://image.pollinations.ai/prompt/x')).toBe(false);
  });

  it('junk is refused rather than throwing', () => {
    for (const bad of ['', '   ', 'not a url', '//image.pollinations.ai/x', null as never, undefined as never]) {
      expect(isAllowedImageHost(bad as string)).toBe(false);
    }
  });

  it('credentials in the URL cannot smuggle a different host past it', () => {
    // `https://image.pollinations.ai@evil.com/` has hostname evil.com — a naive string check reads
    // the first host and gets it exactly backwards.
    expect(isAllowedImageHost('https://image.pollinations.ai@evil.com/x')).toBe(false);
  });
});

describe('🔒 the ticket — proof WE minted that exact link', () => {
  const secret = 'test-secret-value';
  const url = 'https://image.pollinations.ai/prompt/a%20cat?width=1024&seed=7';
  const exp = 2_000_000_000_000;

  it('a link we signed verifies', () => {
    const sig = signImageTicket(url, exp, secret);
    expect(verifyImageTicket(url, exp, sig, secret, exp - 1)).toBe(true);
  });

  it('🔴 a DIFFERENT path on the same host does not', () => {
    // Without this, an allowed host is a free pass to any prompt — including one our safety triage
    // never saw. The host allowlist alone is not enough, which is why there are two locks.
    const sig = signImageTicket(url, exp, secret);
    const other = 'https://image.pollinations.ai/prompt/something%20else?width=1024&seed=7';
    expect(verifyImageTicket(other, exp, sig, secret, exp - 1)).toBe(false);
  });

  it('a changed expiry, a wrong secret, and an expired ticket all fail', () => {
    const sig = signImageTicket(url, exp, secret);
    expect(verifyImageTicket(url, exp + 1, sig, secret, exp - 1)).toBe(false);
    expect(verifyImageTicket(url, exp, sig, 'another-secret', exp - 1)).toBe(false);
    expect(verifyImageTicket(url, exp, sig, secret, exp + 1)).toBe(false);
  });

  it('malformed input is false, never an exception', () => {
    for (const [u, e, g] of [
      ['', exp, 'x'], [url, 'nope', 'x'], [url, exp, ''], [url, exp, 'short'],
    ] as Array<[string, unknown, string]>) {
      expect(() => verifyImageTicket(u, e as number, g, secret, 0)).not.toThrow();
      expect(verifyImageTicket(u, e as number, g, secret, 0)).toBe(false);
    }
  });

  it('the link we actually mint is one the allowlist accepts', () => {
    const minted = pollinationsImageUrl('a tea stall', 'square', { __IMAGE_SEED: '5' } as never);
    expect(isAllowedImageHost(minted)).toBe(true);
  });
});

describe('⏱️ waiting out the provider’s limit', () => {
  it('the first wait clears the 15-second window', () => {
    // The provider's documented limit is one request every 15s per address; a shorter first wait
    // would simply be refused again and spend a retry for nothing.
    expect(imageRetryDelaysMs()[0]).toBeGreaterThanOrEqual(15_000);
  });

  it('🔒 and the whole budget stays inside the minute the admin allowed', () => {
    // "user ko result 1 min baad bhi mile chalega" — a minute is the permission, not a target.
    expect(imageRetryBudgetMs()).toBeLessThanOrEqual(60_000);
    expect(imageRetryBudgetMs()).toBeGreaterThan(30_000);
  });

  it('a rate limit is waited out; a refusal is not', () => {
    expect(shouldRetryImageStatus(429)).toBe(true);
    expect(shouldRetryImageStatus(503)).toBe(true);
    expect(shouldRetryImageStatus(408)).toBe(true);
    expect(shouldRetryImageStatus(400)).toBe(false);
    expect(shouldRetryImageStatus(404)).toBe(false);
    expect(shouldRetryImageStatus(200)).toBe(false);
  });

  it('🔴 a blocked cross-origin read is given up on quickly, not retried for a minute', () => {
    // A throw carries no status: a refusal and a dropped connection look identical. One retry covers
    // the dropped connection; a second failure means this browser cannot read these bytes, and
    // retrying a refusal makes the user wait a full minute for something that never succeeds.
    expect(DIRECT_FETCH_THROW_LIMIT).toBe(2);
    expect(DIRECT_FETCH_THROW_LIMIT).toBeLessThan(imageRetryDelaysMs().length);
  });

  it('🔒 the countdown never names the provider', () => {
    const msg = imageWaitMessage(30_000);
    expect(msg).toContain('NavBharatAI');
    expect(msg.toLowerCase()).not.toContain('pollination');
    expect(msg).toContain('30');
  });

  it('a ticket outlives a tab the user left open, but is not a standing key', () => {
    expect(IMAGE_TICKET_TTL_MS).toBeGreaterThan(60 * 60 * 1000);
    expect(IMAGE_TICKET_TTL_MS).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});

describe('🔒 the kill switch', () => {
  it('defaults ON, and `off` is the exact word that reverts it', () => {
    expect(clientImageFetchEnabled({} as never)).toBe(true);
    expect(clientImageFetchEnabled({ IMAGE_GEN_CLIENT_FETCH: 'off' } as never)).toBe(false);
    expect(clientImageFetchEnabled({ IMAGE_GEN_CLIENT_FETCH: 'OFF' } as never)).toBe(false);
    // Anything else is ON — the same shape every other flag in this repo uses.
    expect(clientImageFetchEnabled({ IMAGE_GEN_CLIENT_FETCH: 'on' } as never)).toBe(true);
    expect(clientImageFetchEnabled({ IMAGE_GEN_CLIENT_FETCH: '' } as never)).toBe(true);
  });
});

describe('🔒 what the server does, and what it deliberately still does', () => {
  const route = code(read(ROUTE));

  it('a free generation hands the browser a link instead of fetching it here', () => {
    expect(route).toContain('clientImageFetchEnabled()');
    expect(route).toContain("mode: 'client-fetch'");
    expect(route).toContain('signImageTicket(url, exp, imageTicketSecret())');
  });

  it('🔴 the safety triage still runs HERE, before a link is ever minted', () => {
    // The link carries a FINISHED prompt. The pornography ban, the craft layer and the India-map
    // directive all ran on this server seconds earlier — none of that moved to the client.
    // ⚠️ The provider's own `safe` parameter is NOT a substitute: its docs say safety is off unless
    // asked for, and it is documented on their NEW endpoint, not the keyless one this uses.
    const mint = route.slice(route.indexOf('clientImageFetchEnabled()'));
    expect(mint).toContain('pollinationsImageUrl(prompt');
    expect(route.indexOf('triagePrompt') === -1 || route.indexOf('craftImagePrompt') > -1).toBe(true);
    expect(route).toContain('craftImagePrompt(');
  });

  it('🔴 an EDIT of the user’s own photo is never handed to the browser', () => {
    // An edit carries the user's photograph. It goes to a keyed provider from our server, and its
    // bytes must not end up in a URL anybody could hold.
    expect(route).toContain('pollinationsEnabled() && !editing');
  });

  it('the relay is locked by BOTH the host allowlist and the signature', () => {
    const relay = route.slice(route.indexOf("'/api/image/relay'"), route.indexOf("'/api/image/enhance-prompt'"));
    expect(relay.length).toBeGreaterThan(400);
    // ⚠️ ASSERT THE NEGATION, NOT THE NAME. `toContain('verifyImageTicket(')` passes for
    // `if (false && !verifyImageTicket(...))` — proven by reverting it and watching this test stay
    // green. A guard's presence is not a guard; the `if (!` is the part that refuses.
    expect(relay).toContain('if (!isAllowedImageHost(url))');
    expect(relay).toContain('if (!verifyImageTicket(');
    expect(relay).toContain('requireAccountForCostlyAi');
    // The host check comes FIRST — a signature check on an unparsed URL is a check on nothing.
    expect(relay.indexOf('isAllowedImageHost')).toBeLessThan(relay.indexOf('verifyImageTicket'));
    // And each refusal really returns — a check that falls through is not a check.
    expect(relay).toContain('res.status(400).json({ error: ');
    expect(relay).toContain('res.status(403).json({ error: ');
  });

  it('🔒 the relay refuses a forged and an expired ticket with the SAME words', () => {
    const relay = route.slice(route.indexOf("'/api/image/relay'"), route.indexOf("'/api/image/enhance-prompt'"));
    expect(relay).toContain('That picture link has expired');
    // Two different messages would tell a prober which lock they tripped.
    expect(relay.match(/res\.status\(403\)/g) || []).toHaveLength(1);
  });
});

describe('🔒 the four features survive — Add text, Crop, Copy, Download', () => {
  const client = code(read(CLIENT));

  it('every one of them goes through the ONE function that guarantees bytes', () => {
    // Four call sites each doing their own version of this is how three end up subtly different and
    // one ends up broken.
    expect(client).toContain('const ensureLocalImage =');
    const calls = client.match(/ensureLocalImage\(item\.id\)/g) || [];
    expect(calls.length, 'Add text, Copy and Save must each route through it').toBeGreaterThanOrEqual(3);
  });

  it('bytes already in hand cost nothing — the relay is a fallback, not a step', () => {
    const fn = client.slice(client.indexOf('const ensureLocalImage ='), client.indexOf('const handleCopyImage'));
    expect(fn).toContain("item.url.startsWith('data:')");
    // The early return must come BEFORE the relay call, or every picture pays a round trip.
    expect(fn.indexOf("startsWith('data:')")).toBeLessThan(fn.indexOf('relayImage('));
  });

  it('a relayed picture is written back, so the second press is free', () => {
    const fn = client.slice(client.indexOf('const ensureLocalImage ='), client.indexOf('const handleCopyImage'));
    expect(fn).toContain('imageHistoryStore.save(updated)');
    expect(fn).toContain('ticket: undefined');
  });

  it('a picture with no ticket and no bytes says so instead of failing silently', () => {
    const fn = client.slice(client.indexOf('const ensureLocalImage ='), client.indexOf('const handleCopyImage'));
    expect(fn).toContain('could not be opened for editing');
  });

  it('the wait is visible while the browser retries', () => {
    expect(client).toContain('setWaitNote(imageWaitMessage(msLeft))');
    expect(client).toContain('{waitNote');
  });
});

describe('🔒 the client fetcher gives up on a refusal and keeps the picture', () => {
  // These exercise the real module against a fake `fetch`, not a snapshot of it.
  let calls = 0;
  const withFetch = async (impl: typeof fetch, run: () => Promise<unknown>) => {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    try { return await run(); } finally { globalThis.fetch = original; }
  };

  beforeEach(async () => {
    calls = 0;
    const { resetDirectReadMemo } = await import('../src/lib/clientImageFetch');
    resetDirectReadMemo();
  });

  it('a readable picture comes back as bytes, from the user’s own connection', async () => {
    const { fetchImageFromUser } = await import('../src/lib/clientImageFetch');
    const out = await withFetch(
      (async () => {
        calls += 1;
        return { ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'image/png' }) } as never;
      }) as typeof fetch,
      () => fetchImageFromUser({ url: 'https://image.pollinations.ai/prompt/x', ticket: 't', exp: 1 }),
    ) as { dataUrl?: string };
    expect(calls).toBe(1);
    expect(out.dataUrl).toMatch(/^data:/);
  });

  it('🔴 a blocked read stops after two tries and asks for the relay', async () => {
    const { fetchImageFromUser } = await import('../src/lib/clientImageFetch');
    const started = Date.now();
    const out = await withFetch(
      (async () => { calls += 1; throw new TypeError('Failed to fetch'); }) as typeof fetch,
      () => fetchImageFromUser({ url: 'https://image.pollinations.ai/prompt/x', ticket: 't', exp: 1 }),
    ) as { needsRelay?: boolean };
    expect(calls).toBe(DIRECT_FETCH_THROW_LIMIT);
    expect(out.needsRelay).toBe(true);
    // And it did NOT sit through the rate-limit ladder to learn that.
    expect(Date.now() - started).toBeLessThan(imageRetryBudgetMs());
  });

  it('🔴 a picture that ARRIVED but could not be decoded is not mistaken for a blocked read', async () => {
    // Found by this suite before it shipped. A resolved response proves the browser may read these
    // bytes; a decode failure afterwards proves nothing about that. Treating the two as one took a
    // single undecodable picture and routed the whole session through our relay from then on.
    const { fetchImageFromUser, directReadKnownBlocked } = await import('../src/lib/clientImageFetch');
    const out = await withFetch(
      (async () => {
        calls += 1;
        return { ok: true, status: 200, blob: async () => { throw new Error('decode failed'); } } as never;
      }) as typeof fetch,
      () => fetchImageFromUser({ url: 'https://image.pollinations.ai/prompt/x', ticket: 't', exp: 1 }),
    ) as { error?: string; needsRelay?: boolean };
    expect(calls).toBe(1);
    expect(out.needsRelay).toBeUndefined();
    expect(out.error).toBeTruthy();
    expect(directReadKnownBlocked(), 'one bad decode must not disable direct reads').toBe(false);
  });

  it('once it is known blocked, later pictures do not pay for the discovery again', async () => {
    const { fetchImageFromUser, directReadKnownBlocked } = await import('../src/lib/clientImageFetch');
    await withFetch(
      (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch,
      () => fetchImageFromUser({ url: 'https://image.pollinations.ai/prompt/x', ticket: 't', exp: 1 }),
    );
    expect(directReadKnownBlocked()).toBe(true);
    const out = await withFetch(
      (async () => { calls += 1; throw new TypeError('nope'); }) as typeof fetch,
      () => fetchImageFromUser({ url: 'https://image.pollinations.ai/prompt/y', ticket: 't', exp: 1 }),
    ) as { needsRelay?: boolean };
    expect(calls).toBe(0);
    expect(out.needsRelay).toBe(true);
  });
});
