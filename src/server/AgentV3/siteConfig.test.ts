import { describe, it, expect } from 'vitest';
import {
  validateSiteConfig, customNotFoundApplies, hostingVersionConfig, DEFAULT_SITE_CONFIG,
  MAX_REDIRECTS, SECURITY_HEADERS, FRAME_HEADER,
} from './siteConfig';

const files = (...paths: string[]) => new Map(paths.map((p) => [p, Buffer.from('x')]));

describe('validateSiteConfig — nothing that could hurt the site it belongs to', () => {
  it('accepts sane redirects, normalises the code, and defaults embedding to off', () => {
    const { config, errors } = validateSiteConfig({ redirects: [{ from: '/old', to: '/new', code: '302' }, { from: '/x', to: 'https://example.com/y' }] });
    expect(errors).toEqual([]);
    expect(config).toEqual({ redirects: [{ from: '/old', to: '/new', code: 302 }, { from: '/x', to: 'https://example.com/y', code: 301 }], allowEmbedding: false });
  });

  it('🔒 refuses an open redirect: protocol-relative, javascript:, http:, and a bare host', () => {
    for (const to of ['//evil.com', 'javascript:alert(1)', 'http://example.com', 'example.com', '']) {
      const { config, errors } = validateSiteConfig({ redirects: [{ from: '/a', to }] });
      expect(config).toBeNull();
      expect(errors[0]).toMatch(/Redirect 1/);
    }
  });

  it('refuses a "from" that is not a path on this site, a loop, and a duplicate', () => {
    expect(validateSiteConfig({ redirects: [{ from: 'old', to: '/new' }] }).config).toBeNull();
    expect(validateSiteConfig({ redirects: [{ from: '/same', to: '/same' }] }).errors[0]).toMatch(/loop/);
    expect(validateSiteConfig({ redirects: [{ from: '/a', to: '/b' }, { from: '/a', to: '/c' }] }).errors[0]).toMatch(/already has a redirect/);
  });

  it('caps the list and tolerates garbage', () => {
    const many = Array.from({ length: MAX_REDIRECTS + 1 }, (_, i) => ({ from: `/p${i}`, to: '/x' }));
    expect(validateSiteConfig({ redirects: many }).errors[0]).toMatch(/At most/);
    expect(validateSiteConfig(null).config).toEqual(DEFAULT_SITE_CONFIG);
    expect(validateSiteConfig({ redirects: 'nope', allowEmbedding: 'yes' }).config).toEqual(DEFAULT_SITE_CONFIG);
  });
});

describe('customNotFoundApplies — the catch-all is dropped only when it is safe to', () => {
  it('needs BOTH a 404.html and another top-level page', () => {
    expect(customNotFoundApplies(files('index.html', 'about.html', '404.html'))).toBe(true);
    // An SPA with a stray 404.html keeps its deep links.
    expect(customNotFoundApplies(files('index.html', '404.html', 'assets/app.js'))).toBe(false);
    // A multi-page site without a 404 page has nothing to serve for a missing one.
    expect(customNotFoundApplies(files('index.html', 'about.html'))).toBe(false);
    // Nested html (a docs folder) is not a top-level page.
    expect(customNotFoundApplies(files('/index.html', 'docs/a.html', '404.html'))).toBe(false);
  });
});

describe('hostingVersionConfig — the ONE config every first-party publish is created with', () => {
  it('keeps the SPA catch-all and the asset cache, and always sets the safe headers', () => {
    const cfg = hostingVersionConfig(files('index.html', 'assets/a.js'), null);
    expect(cfg.rewrites).toEqual([{ glob: '**', path: '/index.html' }]);
    expect(cfg.redirects).toBeUndefined();
    const all = cfg.headers.find((h) => h.glob === '**')!.headers;
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(all[k]).toBe(v);
    expect(all['X-Frame-Options']).toBe(FRAME_HEADER['X-Frame-Options']);
    expect(cfg.headers.find((h) => h.glob === '/assets/**')!.headers['Cache-Control']).toContain('immutable');
  });

  it('drops the catch-all for a multi-page site with its own 404, maps redirects, and honours embedding', () => {
    const cfg = hostingVersionConfig(files('index.html', 'about.html', '404.html'), {
      redirects: [{ from: '/old', to: '/new', code: 301 }], allowEmbedding: true,
    });
    expect(cfg.rewrites).toBeUndefined();
    expect(cfg.redirects).toEqual([{ glob: '/old', statusCode: 301, location: '/new' }]);
    expect(cfg.headers.find((h) => h.glob === '**')!.headers['X-Frame-Options']).toBeUndefined();
  });
});
