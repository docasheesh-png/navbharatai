import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain JS module, deployed to Cloudflare rather than bundled into the server.
import { upstreamHostFor } from '../infra/preview-proxy/worker.js';
import { applyPreviewDomain } from '../src/server/AgentV3/PreviewDomain';

/**
 * The preview proxy is HALF of a pair, and the pair is the thing that has to be right.
 *
 *   server  — `applyPreviewDomain()` turns `5173-abc.e2b.app` into `5173-abc.mitrify.xyz`
 *   worker  — `upstreamHostFor()` turns it back, to know where to fetch from
 *
 * Each is trivially correct alone; only together do they either work or leave every preview
 * unreachable. That is the same shape as the GitHub-token bug from 2026-08-19 (client sent a
 * header, server read the body — each file self-consistent, the pair broken), so the pair is what
 * gets asserted here rather than either side on its own.
 */

const DOMAIN = 'mitrify.xyz';

describe('the round trip: what the server publishes, the worker can resolve', () => {
  it.each([
    'https://5173-abc123xyz.e2b.app',
    'https://3000-i7k2m9q4w1e5r8t3.e2b.app',
    'https://8080-sandbox01.e2b.app',
  ])('%s survives the swap and comes back', (raw) => {
    const branded = applyPreviewDomain(raw, DOMAIN);
    expect(branded).not.toContain('e2b.app');          // the vendor is gone from what the user sees
    const back = upstreamHostFor(new URL(branded).hostname, DOMAIN);
    expect(back).toBe(new URL(raw).hostname);          // …and the worker still knows where to go
  });
});

describe('🔒 it is not an open proxy', () => {
  // If any hostname could be turned into any upstream, anyone could serve their own content from
  // our domain, with our own valid certificate. That is a phishing page wearing our brand, so every
  // one of these must be refused rather than guessed at.
  it.each([
    ['evil.mitrify.xyz', 'no port-sandbox shape at all'],
    ['5173-abc.evil.mitrify.xyz', 'a nested label smuggling another host'],
    ['abc-5173.mitrify.xyz', 'the parts the wrong way round'],
    ['5173-ab.mitrify.xyz', 'a sandbox id too short to be real'],
    ['99999-abc123xyz.mitrify.xyz', 'not a valid port number'],
    ['0-abc123xyz.mitrify.xyz', 'port zero'],
    ['5173-abc_123.mitrify.xyz', 'a non-alphanumeric sandbox id'],
    ['5173-abc123xyz.attacker.com', 'a different domain entirely'],
    ['5173-abc123xyz.e2b.app', 'the upstream host itself, which must not loop'],
  ])('refuses %s (%s)', (host) => {
    expect(upstreamHostFor(host, DOMAIN)).toBeNull();
  });

  it('never forwards anywhere but the fixed upstream suffix', () => {
    const out = upstreamHostFor('5173-abc123xyz.mitrify.xyz', DOMAIN);
    expect(out).toBe('5173-abc123xyz.e2b.app');
    expect(out?.endsWith('.e2b.app')).toBe(true);
  });

  it('handles empty and malformed input without throwing', () => {
    expect(upstreamHostFor('', DOMAIN)).toBeNull();
    expect(upstreamHostFor('5173-abc123xyz.mitrify.xyz', '')).toBeNull();
  });
});

describe('the behaviours a preview depends on', () => {
  const src = readFileSync(join(__dirname, '..', 'infra', 'preview-proxy', 'worker.js'), 'utf8');

  it('proxies WEBSOCKETS, or hot reload dies and the app looks frozen', () => {
    expect(src).toContain("=== 'websocket'");
    expect(src).toContain('webSocket: res.webSocket');
  });

  it('rewrites a redirect back onto our domain', () => {
    // A dev server redirecting to its own absolute URL would walk the browser to the vendor host and
    // undo the entire point of the proxy.
    expect(src).toContain("out.get('location')");
    expect(src).toContain("out.set('location'");
  });

  it('keeps redirects manual so the browser resolves them against our host', () => {
    expect(src).toContain("redirect: 'manual'");
  });

  it('answers a stopped sandbox with an honest page, never a raw gateway error', () => {
    expect(src).toContain('previewGonePage');
    expect(src).toMatch(/502 \|\| res\.status === 503 \|\| res\.status === 504/);
  });

  it('the sleep page never names the vendor', () => {
    const page = src.slice(src.indexOf('function previewGonePage'), src.indexOf('export default'));
    expect(page.toLowerCase()).not.toContain('e2b');
    expect(page.toLowerCase()).not.toContain('sandbox id');
  });
});
