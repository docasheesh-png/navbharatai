import { describe, it, expect, vi } from 'vitest';
import { isNativeShell, needsApiRewrite, rewriteApiUrl, installNativeApiRewrite, NATIVE_API_ORIGIN, type ShellWindow } from './apiBase';

const fakeWindow = (over: Partial<ShellWindow> & { origin?: string } = {}): ShellWindow & { fetch: ReturnType<typeof vi.fn> } => {
  const fetch = vi.fn(async () => new Response('ok'));
  return {
    Capacitor: over.Capacitor,
    location: { origin: over.origin ?? 'https://localhost' },
    fetch: fetch as unknown as typeof globalThis.fetch,
    XMLHttpRequest: over.XMLHttpRequest,
  } as ShellWindow & { fetch: ReturnType<typeof vi.fn> };
};

describe('isNativeShell — only a real Capacitor native runtime counts', () => {
  it('web (no Capacitor global) → false', () => {
    expect(isNativeShell({})).toBe(false);
  });
  it('native platform → true; web build of the plugin (isNativePlatform false) → false', () => {
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
  });
  it('legacy isNative flag works; a throwing detector fails CLOSED (false)', () => {
    expect(isNativeShell({ Capacitor: { isNative: true } })).toBe(true);
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } })).toBe(false);
  });
});

describe('needsApiRewrite — bundled shell only', () => {
  it('web → false; hosted shell (origin already the API origin) → false; bundled shell → true', () => {
    expect(needsApiRewrite(false, 'https://navbharatai.com')).toBe(false);
    expect(needsApiRewrite(true, NATIVE_API_ORIGIN)).toBe(false);
    expect(needsApiRewrite(true, 'https://localhost')).toBe(true);
    expect(needsApiRewrite(true, 'capacitor://localhost')).toBe(true);
  });
});

describe('rewriteApiUrl — only site-relative /api paths are touched', () => {
  it('rewrites /api, /api/… and /api?…', () => {
    expect(rewriteApiUrl('/api/agentv3/chat')).toBe(`${NATIVE_API_ORIGIN}/api/agentv3/chat`);
    expect(rewriteApiUrl('/api')).toBe(`${NATIVE_API_ORIGIN}/api`);
    expect(rewriteApiUrl('/api?x=1')).toBe(`${NATIVE_API_ORIGIN}/api?x=1`);
  });
  it('leaves everything else untouched (assets, absolute URLs, lookalikes)', () => {
    expect(rewriteApiUrl('/logo.png')).toBe('/logo.png');
    expect(rewriteApiUrl('/apiary/docs')).toBe('/apiary/docs'); // NOT /api/…
    expect(rewriteApiUrl('https://other.example/api/x')).toBe('https://other.example/api/x');
    expect(rewriteApiUrl('//cdn.example/api/x')).toBe('//cdn.example/api/x');
  });
});

describe('installNativeApiRewrite — transport-layer patch', () => {
  it('NO-OP on the web (no Capacitor): returns false, fetch untouched', () => {
    const w = fakeWindow({ origin: 'https://navbharatai.com' });
    const before = w.fetch;
    expect(installNativeApiRewrite(w)).toBe(false);
    expect(w.fetch).toBe(before);
  });

  it("NO-OP in today's HOSTED shell (origin already the API origin)", () => {
    const w = fakeWindow({ Capacitor: { isNativePlatform: () => true }, origin: NATIVE_API_ORIGIN });
    expect(installNativeApiRewrite(w)).toBe(false);
  });

  it('bundled shell: string /api fetches are rewritten to the production origin', async () => {
    const w = fakeWindow({ Capacitor: { isNativePlatform: () => true }, origin: 'https://localhost' });
    const inner = w.fetch;
    expect(installNativeApiRewrite(w)).toBe(true);
    await w.fetch('/api/wallet/u1', { method: 'GET' });
    expect(inner).toHaveBeenCalledWith(`${NATIVE_API_ORIGIN}/api/wallet/u1`, { method: 'GET' });
  });

  it('bundled shell: an ABSOLUTE local-origin /api STRING is re-targeted (the GitHub-connect bug)', async () => {
    // connectGitHub / useGitHubConnect / firebase-auth build the URL as
    // `new URL(window.location.origin + '/api/…').toString()` and pass that STRING to fetch. On native
    // the origin is the local shell, so without rewriteAbsolute the request hit capacitor/localhost and
    // GitHub connect never even started. This locks the fix.
    const w = fakeWindow({ Capacitor: { isNativePlatform: () => true }, origin: 'capacitor://localhost' });
    const inner = w.fetch;
    installNativeApiRewrite(w);
    const built = new URL('capacitor://localhost/api/auth/github/url?redirect_uri=x').toString();
    await w.fetch(built);
    expect(inner).toHaveBeenCalledWith(`${NATIVE_API_ORIGIN}/api/auth/github/url?redirect_uri=x`, undefined);
  });

  it('bundled shell: non-API fetches pass through untouched (local assets stay local)', async () => {
    const w = fakeWindow({ Capacitor: { isNativePlatform: () => true }, origin: 'https://localhost' });
    const inner = w.fetch;
    installNativeApiRewrite(w);
    await w.fetch('/assets/index.js');
    expect(inner).toHaveBeenCalledWith('/assets/index.js', undefined);
  });

  it('bundled shell: URL objects pointing at the LOCAL origin /api are re-targeted', async () => {
    const w = fakeWindow({ Capacitor: { isNativePlatform: () => true }, origin: 'https://localhost' });
    const inner = w.fetch;
    installNativeApiRewrite(w);
    await w.fetch(new URL('https://localhost/api/agentv3/status?userId=u1'));
    expect(inner).toHaveBeenCalledWith(`${NATIVE_API_ORIGIN}/api/agentv3/status?userId=u1`, undefined);
  });

  it('bundled shell: XMLHttpRequest.open (axios path) rewrites relative and local-absolute /api URLs', () => {
    const opened: unknown[][] = [];
    const XHR = { prototype: { open: function (...args: unknown[]) { opened.push(args); } } };
    const w = fakeWindow({ Capacitor: { isNativePlatform: () => true }, origin: 'https://localhost', XMLHttpRequest: XHR });
    installNativeApiRewrite(w);
    XHR.prototype.open.call({}, 'POST', '/api/secrets/u1', true);
    XHR.prototype.open.call({}, 'GET', 'https://localhost/api/x', true);
    XHR.prototype.open.call({}, 'GET', '/logo.png', true);
    expect(opened[0][1]).toBe(`${NATIVE_API_ORIGIN}/api/secrets/u1`);
    expect(opened[1][1]).toBe(`${NATIVE_API_ORIGIN}/api/x`);
    expect(opened[2][1]).toBe('/logo.png');
  });
});
