import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildReactPreview } from './ReactPreview';
import { precompileModules } from './PreviewPrecompile';
import { VirtualFileSystem } from '../project/ProjectModel';

/**
 * SERVER-PRECOMPILED PREVIEW (admin 2026-08-05: "hamare in-browser preview ko Bolt ke preview jaisa
 * banao").
 *
 * What makes Bolt's preview feel fast is that the device never runs a compiler. Ours shipped ~2.85 MB
 * of Babel and transpiled every module on the user's phone. Now the SAME compiler runs once on the
 * server and the page ships compiled code and no compiler at all.
 *
 * The invariants here are the safety story: the fallback page must remain exactly today's page, the
 * compiled output must carry everything the Visual Editor and the loader depend on, and the two
 * compile paths must never drift apart.
 */
const APP = {
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
  'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
  'src/main.tsx': "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './index.css';\ncreateRoot(document.getElementById('root')!).render(<App />);",
  'src/App.tsx': "export default function App(){ return <div className='hi'>Hello</div>; }",
  'src/index.css': '.hi { color: red; }',
};

const payloadOf = (html: string): { entry: string; modules: Record<string, string> } =>
  JSON.parse(html.match(/<script type="application\/json" id="__bundle__">([\s\S]*?)<\/script>/)![1].replace(/<\\\//g, '</'));

afterEach(() => { delete process.env.AGENTV3_PREVIEW_PRECOMPILE; });

describe('server-precompiled preview', () => {
  it('ships NO compiler — no Babel tag, boot goes straight to dependencies', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord(APP));
    expect(html).toContain('var PRECOMPILED = true');
    expect(html).not.toContain('<script src="/vendor/babel.min.js">');
    // The fallback CDN list may remain in the loader for the non-precompiled branch, but no compiler
    // <script> tag may exist in the head of a precompiled page.
    expect(html).not.toMatch(/<script src="[^"]*babel[^"]*"><\/script>/);
  });

  it('modules in the payload are COMPILED: JSX gone, CommonJS shape present', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord(APP));
    const { modules } = payloadOf(html);
    const app = modules['src/App.tsx'];
    expect(app).not.toContain('<div');                    // JSX compiled away
    expect(app).toContain('jsxDEV');                      // development runtime (Visual Editor's _debugSource)
    expect(app).toMatch(/require\(["']react\/jsx-dev-runtime["']\)/); // CJS, resolvable by collectBare + loader
  });

  it('the Visual Editor stamp survives server compilation — data-nbai-src on host elements', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord(APP));
    const { modules } = payloadOf(html);
    expect(modules['src/App.tsx']).toContain('data-nbai-src');
    expect(modules['src/App.tsx']).toContain('src/App.tsx:1:');
  });

  it('every compiled module is valid JavaScript', async () => {
    // The compiled code lives in the JSON payload, which the inline-script parse test deliberately
    // skips — so it gets its own parse gate here. A module that does not parse is a blank preview.
    const { transform } = await import('esbuild');
    const html = buildReactPreview(VirtualFileSystem.fromRecord(APP));
    const { modules } = payloadOf(html);
    for (const [path, code] of Object.entries(modules)) {
      if (path.endsWith('.css')) continue;
      await expect(transform(code, { loader: 'js' }), `${path} must parse`).resolves.toBeTruthy();
    }
  });

  it('CSS passes through untouched — it is a runtime concern, not a compile-time one', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord(APP));
    const { modules } = payloadOf(html);
    expect(modules['src/index.css']).toBe(APP['src/index.css']);
  });

  it('kill switch AGENTV3_PREVIEW_PRECOMPILE=off restores today\'s browser-Babel page', () => {
    process.env.AGENTV3_PREVIEW_PRECOMPILE = 'off';
    const html = buildReactPreview(VirtualFileSystem.fromRecord(APP));
    expect(html).toContain('var PRECOMPILED = false');
    expect(html).toMatch(/<script src="[^"]*babel[^"]*"><\/script>/);
    const { modules } = payloadOf(html);
    expect(modules['src/App.tsx']).toBe(APP['src/App.tsx']); // raw source, compiled in the browser
  });

  it('a module that fails to compile falls the WHOLE page back — where the same compiler reports it', () => {
    const broken = { ...APP, 'src/Broken.tsx': 'export default function( { return <div; }' };
    const html = buildReactPreview(VirtualFileSystem.fromRecord(broken));
    expect(html).toContain('var PRECOMPILED = false');
    const { modules } = payloadOf(html);
    expect(modules['src/App.tsx']).toBe(APP['src/App.tsx']); // no mixed pages: all raw or all compiled
  });

  it('precompileModules itself: all-or-nothing on failure', () => {
    expect(precompileModules({ 'a.jsx': 'export default () => <p>ok</p>;', 'b.jsx': 'export ] broken' })).toBeNull();
    const ok = precompileModules({ 'a.jsx': 'export default () => <p>ok</p>;' });
    expect(ok).not.toBeNull();
    expect(ok!['a.jsx']).toContain('jsxDEV');
  });

  it('the two stamping implementations cannot drift silently', () => {
    // The browser fallback keeps its inline nbaiSrcPlugin; the server has srcStampPlugin. They must
    // agree on the attribute, the host-element filter and the 1-based column convention — a drift
    // means the Visual Editor works on one path and misses on the other.
    const server = readFileSync(join(__dirname, 'PreviewPrecompile.ts'), 'utf8');
    const browser = readFileSync(join(__dirname, 'ReactPreview.ts'), 'utf8');
    for (const marker of ["'data-nbai-src'", 'column + 1', 'toLowerCase()']) {
      expect(server).toContain(marker);
      expect(browser).toContain(marker);
    }
  });
});
