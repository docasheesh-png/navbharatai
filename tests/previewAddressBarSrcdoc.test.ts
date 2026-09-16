import { describe, it, expect } from 'vitest';
import { previewBridgeSource } from '../src/server/AgentV3/previewBridge';

/**
 * ADMIN SCREENSHOT 2026-09-14 — the preview's address bar read literally **`srcdoc`**, and the admin
 * asked what the box was for and whether deleting it would cost anything.
 *
 * It is a real address bar: back / forward step the app's OWN history and Enter performs a real
 * navigation (PreviewSurface.tsx, `routeBar`). Its NAVIGATION half was already correct for the
 * in-browser preview — the handler routes that mode by HASH, because an `about:srcdoc` document
 * cannot be navigated at all. Only the DISPLAY was wrong: `location.pathname` of `about:srcdoc` is
 * the string "srcdoc", so a working control advertised an address that was never real.
 *
 * These tests run the bridge's own emitted source against a fake `location`, so they assert the
 * shipped script rather than a description of it.
 */

/** Evaluate the bridge's `currentPath()` against a given SOURCE tag and location. */
function currentPathFor(source: 'in-browser' | 'live', loc: { protocol?: string; pathname?: string; search?: string; hash?: string }): string {
  const script = previewBridgeSource(source);
  const start = script.indexOf('function currentPath()');
  expect(start, 'currentPath must exist in the emitted bridge').toBeGreaterThan(-1);
  // The function body ends at the first line that closes it at two-space indentation.
  const end = script.indexOf('\n  }', start);
  const body = script.slice(start, end + 4);
  const SOURCE = source;
  const location = { protocol: 'https:', pathname: '/', search: '', hash: '', ...loc };
  // eslint-disable-next-line no-new-func
  const fn = new Function('SOURCE', 'location', `${body}; return currentPath();`);
  return fn(SOURCE, location);
}

describe('the in-browser preview no longer reports "srcdoc" as the address', () => {
  it('a freshly opened srcdoc preview reports "/", not "srcdoc"', () => {
    const p = currentPathFor('in-browser', { protocol: 'about:', pathname: 'srcdoc', hash: '' });
    expect(p).toBe('/');
    expect(p).not.toContain('srcdoc');
  });

  it('after navigating, it reports the app’s real route — not the route with "srcdoc" glued in front', () => {
    const p = currentPathFor('in-browser', { protocol: 'about:', pathname: 'srcdoc', hash: '#/dashboard' });
    expect(p).toBe('/dashboard');
    expect(p).not.toContain('srcdoc');
  });

  it('a hash that is not route-shaped still becomes a path rather than leaking the hash character', () => {
    expect(currentPathFor('in-browser', { protocol: 'about:', pathname: 'srcdoc', hash: '#checkout' })).toBe('/checkout');
  });

  it('the guard is on the MODE as well as the protocol, so a hash-routed in-browser frame is covered either way', () => {
    // SOURCE alone is enough — the in-browser preview rewrites BrowserRouter to HashRouter, so its
    // route always lives in the hash whatever the document URL turns out to be.
    expect(currentPathFor('in-browser', { protocol: 'https:', pathname: '/whatever', hash: '#/settings' })).toBe('/settings');
  });
});

describe('the LIVE preview is untouched — there the path is genuinely real', () => {
  it('reports the real path, query and hash exactly as before', () => {
    expect(currentPathFor('live', { pathname: '/checkout', search: '?id=7', hash: '#top' })).toBe('/checkout?id=7#top');
  });

  it('a plain live page reports its plain path', () => {
    expect(currentPathFor('live', { pathname: '/', search: '', hash: '' })).toBe('/');
  });
});

describe('the control it feeds is real, which is why the fix is a rename and not a deletion', () => {
  const inBrowser = previewBridgeSource('in-browser');

  it('a srcdoc document is navigated by HASH, because it cannot be navigated at all', () => {
    expect(inBrowser).toContain("var hashRouted = SOURCE === 'in-browser'");
    expect(inBrowser).toContain("location.hash = '#'");
  });

  it('and a live app still gets a REAL navigation', () => {
    expect(previewBridgeSource('live')).toContain('location.assign(to)');
  });

  it('never throws, whatever location turns out to be', () => {
    expect(() => currentPathFor('in-browser', {})).not.toThrow();
    expect(() => currentPathFor('live', {})).not.toThrow();
  });
});
