import { describe, it, expect } from 'vitest';
import { buildReactPreview, isReactProject } from '../src/server/runtime/ReactPreview';
import { renderPreview } from '../src/server/runtime/renderPreview';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { scaffold } from '../src/server/project/Scaffold';

function reactVfs() {
  const vfs = VirtualFileSystem.fromRecord({});
  scaffold(vfs, 'vite-react');
  return vfs;
}

describe('isReactProject', () => {
  it('detects a react dependency in package.json', () => {
    expect(isReactProject(reactVfs())).toBe(true);
  });
  it('is false for a plain static project', () => {
    expect(isReactProject(VirtualFileSystem.fromRecord({ 'index.html': '<h1>x</h1>' }))).toBe(false);
  });
  it('detects jsx/tsx sources without package.json', () => {
    expect(isReactProject(VirtualFileSystem.fromRecord({ 'app.jsx': 'export default ()=>null' }))).toBe(true);
  });
});

describe('buildReactPreview', () => {
  it('produces a self-contained HTML doc that bundles the scaffold in-browser', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain('<div id="root">');
    expect(html).toContain('@babel/standalone');     // transpiler present
    expect(html).toContain('react@18');               // react CDN present
    expect(html).toContain('transform-modules-commonjs');
    // entry + module sources embedded for the in-browser loader
    expect(html).toContain('src/main.jsx');
    expect(html).toContain('src/App.jsx');
  });

  it('loads the self-hosted compiler via an ABSOLUTE same-origin URL when an origin is given', () => {
    // Inside a sandboxed <iframe srcDoc> a root-relative "/vendor/babel.min.js" does not resolve to
    // the app origin → "Could not load the preview compiler". An absolute URL fixes it.
    const rel = buildReactPreview(reactVfs());
    expect(rel).toContain('src="/vendor/babel.min.js"'); // no origin → relative (back-compat)
    const abs = buildReactPreview(reactVfs(), 'https://navbharatai.com');
    expect(abs).toContain('src="https://navbharatai.com/vendor/babel.min.js"');
    // a trailing slash on the origin is normalised (no double slash)
    expect(buildReactPreview(reactVfs(), 'https://navbharatai.com/')).toContain('src="https://navbharatai.com/vendor/babel.min.js"');
  });

  it('embeds the entry from index.html script src', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain('"entry":"src/main.jsx"');
  });

  it('wires arbitrary npm deps via an esm.sh importmap (complex apps)', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-router-dom': '^6.26.0', zustand: '^4.5.0' } }),
      'index.html': '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': "import { create } from 'zustand';\nimport { BrowserRouter } from 'react-router-dom';\n",
    });
    const html = buildReactPreview(vfs);
    expect(html).toContain('<script type="importmap">');
    // Non-react deps are starred (`*`) so esm.sh externalizes react/react-dom and every
    // package shares the ONE React from the importmap (no "Invalid hook call" second copy).
    expect(html).toContain('esm.sh/*react-router-dom@6.26.0');
    expect(html).toContain('esm.sh/*zustand@4.5.0');
    // React itself stays UN-starred — it is the shared copy the others externalize to.
    expect(html).toMatch(/esm\.sh\/react@18\.3\.1/);
    expect(html).not.toContain('esm.sh/*react@');
  });

  it('uses the JSX automatic runtime (no React-in-scope requirement)', () => {
    expect(buildReactPreview(reactVfs())).toContain("runtime: 'automatic'");
  });

  it('falls back to a clear notice when no entry module exists', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord({ 'foo.txt': 'x' }));
    expect(html).toContain('No React entry module found');
  });

  it('emits PRECISE module errors — names the unresolved import AND its importer (not a cryptic stack)', () => {
    const html = buildReactPreview(reactVfs());
    // A failed relative import surfaces "Cannot resolve ... imported by ..." rather than just "Module not found".
    expect(html).toContain('Cannot resolve');
    expect(html).toContain('imported by');
    // A missing bare dep names the package + importer.
    expect(html).toContain('Missing dependency');
    // The error display surfaces the MESSAGE (iOS Safari's stack is frames-only) — message-first handling.
    expect(html).toContain('err.message');
    // Preview failures are postMessage'd up to the host so they can be captured into the build report.
    expect(html).toContain('__nbaiPreviewError');
  });
});

describe('renderPreview', () => {
  it('routes a react project to the react bundler', () => {
    expect(renderPreview(reactVfs())).toContain('@babel/standalone');
  });
  it('routes a plain static project to the static inliner', () => {
    const html = renderPreview(VirtualFileSystem.fromRecord({ 'index.html': '<h1>plain</h1>' }));
    expect(html).toContain('plain');
    expect(html).not.toContain('@babel/standalone');
  });
});
