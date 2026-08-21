import { describe, it, expect } from 'vitest';
import { inBrowserRefusal } from './inBrowserRefusal';

/**
 * ADMIN REPORT — Mitrify import, 2026-08-21, build de674a44. The in-browser preview spent **NINE
 * MINUTES** (three CDN attempts at 180 s each) fetching `react-dom/client` for a full-stack Express +
 * PostgreSQL app it could never have run, then failed:
 *
 *   PREVIEW_ERROR: Could not load "react-dom/client" … from the CDN:
 *     timed out after 180s | alt CDN: timed out after 180s | plain: timed out after 180s
 *
 * THE PART THAT MAKES IT OURS: the server had already worked it out and said so —
 * `proveBrowserRunnable` returned `browserRunnable: false`, blocker `has-backend`. The UI rendered
 * the bundle anyway, because its refusal was gated on a CLIENT-side framework guess that starts as
 * `useState('vite-react')` and is never told what the server detected.
 */
const MITRIFY = {
  framework: 'vite-react',        // what the client believed — the stale default
  browserRunnable: false,          // what the SERVER proved from the real files
  browserBlockedReason: 'this project has its own server or database, which the live server has to run',
  hasBackend: true,
  backendReason: 'a Node/Express server and a database',
};

describe('inBrowserRefusal — the server\'s verdict wins', () => {
  it('THE CASE THAT STARTED THIS: refuses even though the client still thinks it is a React SPA', () => {
    const r = inBrowserRefusal(MITRIFY);
    expect(r.refuse).toBe(true);
    // The server's own words, not a generic failure.
    expect(r.detail).toContain('its own server or database');
  });

  it('refuses on the FRAMEWORK too, when the client does know', () => {
    const r = inBrowserRefusal({ framework: 'node-express', browserRunnable: null });
    expect(r.refuse).toBe(true);
    expect(r.title).toBe('Express runs on the Live server');
  });

  it('prefers the framework NAME for the headline when both signals fire', () => {
    // "Express runs on the Live server" is a better headline than a generic one, while the DETAIL
    // still carries the server's specific reason.
    const r = inBrowserRefusal({ ...MITRIFY, framework: 'node-express' });
    expect(r.title).toBe('Express runs on the Live server');
    expect(r.detail).toContain('its own server or database');
  });

  it('🔒 SILENCE IS NOT A REFUSAL — a server that has not answered never blocks a working preview', () => {
    // `browserRunnable: null` means "not asked yet" (or an older server). Treating that as a refusal
    // would break every ordinary React app on first load, which is a far worse bug than the one fixed.
    expect(inBrowserRefusal({ framework: 'vite-react', browserRunnable: null }).refuse).toBe(false);
    expect(inBrowserRefusal({ browserRunnable: null }).refuse).toBe(false);
  });

  it('a plain React SPA the server approved is never refused', () => {
    expect(inBrowserRefusal({ framework: 'vite-react', browserRunnable: true }).refuse).toBe(false);
    // …not even when it happens to have a backend the server still deemed runnable: the server is the
    // authority, and second-guessing its `true` would re-create the same class in reverse.
    expect(inBrowserRefusal({
      framework: 'vite-react', browserRunnable: true, hasBackend: true, backendReason: 'an API',
    }).refuse).toBe(false);
  });

  it('falls back to the backend reason, then to the framework, but never to nothing', () => {
    const noServerReason = inBrowserRefusal({
      framework: 'vite-react', browserRunnable: false, hasBackend: true, backendReason: 'a Python server',
    });
    expect(noServerReason.detail).toContain('a Python server');

    const bare = inBrowserRefusal({ framework: 'nextjs', browserRunnable: null });
    expect(bare.refuse).toBe(true);
    expect(bare.detail.length).toBeGreaterThan(20);   // always says SOMETHING true
    expect(bare.detail).toContain('Next.js');
  });

  it('every server-side framework in the registry is refused', () => {
    for (const f of ['nextjs', 'nuxt', 'sveltekit', 'remix', 'node-express', 'django', 'flask', 'go']) {
      expect(inBrowserRefusal({ framework: f, browserRunnable: null }).refuse, f).toBe(true);
    }
  });
});
