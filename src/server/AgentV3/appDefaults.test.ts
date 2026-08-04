import { describe, it, expect } from 'vitest';
import { planAppDefaults, defaultAssetPath } from './appDefaults';

describe('defaultAssetPath — Vite ships only public/ (deploy-report autopsy 2026-08-03, buildId 588885e8)', () => {
  it('routes the standalone assets into public/ for a Vite app so `npm run build` includes them', () => {
    for (const f of ['vite-react', 'Vite-React', 'vite']) {
      expect(defaultAssetPath('manifest.webmanifest', f)).toBe('public/manifest.webmanifest');
      expect(defaultAssetPath('icon.svg', f)).toBe('public/icon.svg');
      expect(defaultAssetPath('sw.js', f)).toBe('public/sw.js');
      expect(defaultAssetPath('robots.txt', f)).toBe('public/robots.txt');
    }
  });
  it('leaves the root path unchanged for a non-Vite / static / unknown framework', () => {
    for (const f of ['static', 'html', 'remix', '', null, undefined]) {
      expect(defaultAssetPath('manifest.webmanifest', f)).toBe('manifest.webmanifest');
      expect(defaultAssetPath('sw.js', f)).toBe('sw.js');
    }
  });
  it('never double-prefixes an already-pathed file', () => {
    expect(defaultAssetPath('public/icon.svg', 'vite-react')).toBe('public/icon.svg');
    expect(defaultAssetPath('assets/x.svg', 'vite-react')).toBe('assets/x.svg');
  });
});

// U-2: app-scaffold quality defaults. Pure + idempotent — assert missing tags are added, present ones
// are left alone, and re-running changes nothing.

const bareHtml = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
  </head>
  <body><div id="root"></div></body>
</html>
`;

describe('planAppDefaults', () => {
  it('adds missing SEO/meta/manifest tags and an html lang', () => {
    const r = planAppDefaults(bareHtml, 'Todo App');
    expect(r.indexHtml).toContain('lang="en"');
    expect(r.indexHtml).toContain('name="viewport"');
    expect(r.indexHtml).toContain('<title>Todo App</title>');
    expect(r.indexHtml).toContain('name="description"');
    expect(r.indexHtml).toContain('property="og:title"');
    expect(r.indexHtml).toContain('rel="manifest"');
    expect(r.added).toContain('viewport');
    expect(r.added).toContain('html lang="en"');
    // did NOT re-add the charset that was already present
    expect(r.added).not.toContain('charset');
    expect((r.indexHtml!.match(/charset/gi) || []).length).toBe(1);
  });

  it('always provides a manifest + robots file', () => {
    const r = planAppDefaults(bareHtml, 'X');
    expect(r.files['manifest.webmanifest']).toContain('"display": "standalone"');
    expect(r.files['robots.txt']).toContain('User-agent: *');
    expect(JSON.parse(r.files['manifest.webmanifest']).name).toBe('X');
  });

  it('is idempotent — running on its own output adds nothing', () => {
    const first = planAppDefaults(bareHtml, 'App');
    const second = planAppDefaults(first.indexHtml, 'App');
    expect(second.added).toEqual([]);
    expect(second.indexHtml).toBe(first.indexHtml);
  });

  it('leaves a fully-configured head + registered SW untouched', () => {
    const full = `<!doctype html><html lang="en"><head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Done</title>
      <meta name="description" content="d" />
      <meta property="og:title" content="t" />
      <meta property="og:description" content="d" />
      <meta name="twitter:card" content="summary" />
      <meta name="theme-color" content="#000" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    </head><body><script>navigator.serviceWorker.register('/sw.js')</script></body></html>`;
    const r = planAppDefaults(full, 'Done');
    expect(r.added).toEqual([]);
    expect(r.indexHtml).toBe(full);
  });

  it('U-2 PWA: generates a real service worker, an installable icon, theme-color, and SW registration', () => {
    const r = planAppDefaults(bareHtml, 'Todo App');
    // Service worker + registration
    expect(r.files['sw.js']).toContain("addEventListener('fetch'");
    expect(r.files['sw.js']).toContain('caches.open');
    expect(r.indexHtml).toContain("serviceWorker.register('/sw.js')");
    expect(r.added).toContain('service worker registration');
    // Installable icon (non-empty manifest icons + a real SVG file + a favicon link)
    const manifest = JSON.parse(r.files['manifest.webmanifest']);
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.icons[0].src).toBe('/icon.svg');
    expect(r.files['icon.svg']).toContain('<svg');
    expect(r.files['icon.svg']).toContain('>T<'); // monogram of "Todo App"
    expect(r.indexHtml).toContain('rel="icon"');
    // theme-color (PWA + a11y)
    expect(r.indexHtml).toContain('name="theme-color"');
  });

  it('does not inject a service worker when there is no <body> to patch safely', () => {
    const r = planAppDefaults('<html><head></head></html>', 'App');
    expect(r.indexHtml).not.toContain('serviceWorker.register');
    expect(r.files['sw.js']).toBeDefined(); // the file is still offered; registration just isn't injected
  });

  it('returns null html + standalone files (incl. sw + icon) when there is no index.html', () => {
    const r = planAppDefaults(null, 'App');
    expect(r.indexHtml).toBeNull();
    expect(r.files['manifest.webmanifest']).toBeDefined();
    expect(r.files['sw.js']).toBeDefined();
    expect(r.files['icon.svg']).toBeDefined();
    expect(r.added).toEqual([]);
  });
});
