import { describe, it, expect } from 'vitest';
import { buildReactPreview, buildModulePreloads, MAX_MODULE_PRELOADS } from './ReactPreview';
import { VirtualFileSystem } from '../project/ProjectModel';

/**
 * Dependency downloads start with the page, not after the compiler (admin 2026-08-05: "kitne bhi din
 * baad open karo, preview pehle jaisa hi chalega").
 *
 * The loader can only call import() once Babel has loaded and the sources have been scanned, so package
 * fetching used to be fully serialized behind the compiler — two slow phases back to back on a phone
 * with a cold cache. The URLs are known at render time, so the browser can be told to start them
 * immediately.
 *
 * These tests pin the win AND its bounds: a preload is a promise that the module will be used, so an
 * unbounded list would compete with the compiler for connections and slow the thing it is meant to
 * speed up.
 */
const app = (deps: Record<string, string>) =>
  VirtualFileSystem.fromRecord({
    'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', ...deps } }),
    'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
    'src/main.jsx': "import App from './App';\nexport default function boot(){ return App; }",
    'src/App.jsx': "export default function App(){ return <div>Hi</div>; }",
  });

describe('preview module preloads', () => {
  it('preloads the packages the loader is going to import anyway', () => {
    const html = buildReactPreview(app({ axios: '^1.6.0' }));
    expect(html).toContain('rel="modulepreload"');
    expect(html).toContain('esm.sh/axios@1.6.0');
  });

  it('preloads the SAME url the loader will later import — a different one would be a wasted request', () => {
    // specUrl() returns the importmap entry verbatim for a mapped package, which is the whole reason
    // this optimisation is safe: the preload primes the exact cache entry import() then hits. If the
    // two ever drift apart, the browser downloads every dependency twice.
    const vfs = app({ axios: '^1.6.0' });
    const html = buildReactPreview(vfs);
    const mapped = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)![1]).imports;
    for (const url of Object.values(mapped) as string[]) {
      if (!/^https?:/.test(url)) continue;
      expect(html).toContain(`href="${url.replace(/&/g, '&amp;')}"`);
    }
  });

  it('starts the downloads BEFORE the compiler, or the serialization it removes comes straight back', () => {
    const html = buildReactPreview(app({ axios: '^1.6.0' }));
    expect(html.indexOf('rel="modulepreload"')).toBeLessThan(html.indexOf('babel'));
  });

  it('is capped, and React survives the cap', () => {
    // A preload tells the browser the module WILL be used. Hundreds of them compete with the compiler
    // for the same connections — an unbounded list would slow the very thing this speeds up. React must
    // never be what the cap drops: every React app needs it.
    const many: Record<string, string> = {};
    for (let i = 0; i < 80; i++) many['pkg-' + i] = '^1.0.0';
    const out = buildModulePreloads({
      react: 'https://esm.sh/react@18.3.1',
      'react-dom': 'https://esm.sh/react-dom@18.3.1',
      ...Object.fromEntries(Object.keys(many).map((k) => [k, `https://esm.sh/${k}@1.0.0`])),
    });
    const links = out.match(/rel="modulepreload"/g) ?? [];
    expect(links.length).toBe(MAX_MODULE_PRELOADS);
    expect(out).toContain('esm.sh/react@18.3.1');
    expect(out).toContain('esm.sh/react-dom@18.3.1');
  });

  it('emits each URL once even when two specifiers share it', () => {
    const out = buildModulePreloads({ react: 'https://esm.sh/react@18.3.1', alias: 'https://esm.sh/react@18.3.1' });
    expect((out.match(/rel="modulepreload"/g) ?? []).length).toBe(1);
  });

  it('emits http(s) URLs only', () => {
    // The map is ours today; restricting the scheme means a future entry can never become a
    // javascript: URL injected into the page head.
    const out = buildModulePreloads({ bad: 'javascript:alert(1)', rel: '/local/thing.js', ok: 'https://esm.sh/x@1' });
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('/local/thing.js');
    expect(out).toContain('https://esm.sh/x@1');
  });

  it('carries the ?external= query through intact — without it the preload primes the wrong URL', () => {
    // Every non-React package is mapped with ?external=react,react-dom (one shared React). Preloading
    // the same package WITHOUT that query caches a different, second copy of the module: the loader's
    // import() would still miss, so the optimisation would silently do nothing while doubling traffic.
    const out = buildModulePreloads({ mui: 'https://esm.sh/@mui/material@5.0.0?external=react,react-dom' });
    expect(out).toContain('href="https://esm.sh/@mui/material@5.0.0?external=react,react-dom"');
  });

  it('escapes & and " so a multi-parameter URL cannot break out of the attribute', () => {
    const out = buildModulePreloads({ x: 'https://esm.sh/x@1?a=1&b=2', y: 'https://esm.sh/y@1?q="z"' });
    expect(out).toContain('href="https://esm.sh/x@1?a=1&amp;b=2"');
    expect(out).toContain('&quot;z&quot;');
    // Exactly one href attribute per link — a raw quote would have produced a second, broken one.
    expect((out.match(/href="/g) ?? []).length).toBe(2);
  });

  it('an app with no dependencies still renders a valid page', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord({
      'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
      'src/main.jsx': "import App from './App';\nexport default function boot(){ return App; }",
      'src/App.jsx': "export default function App(){ return <div>Hi</div>; }",
    }));
    expect(html).toContain('<div id="root">');
  });
});
