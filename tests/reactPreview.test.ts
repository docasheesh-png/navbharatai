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

  it('embeds the entry from index.html script src', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain('"entry":"src/main.jsx"');
  });

  it('falls back to a clear notice when no entry module exists', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord({ 'foo.txt': 'x' }));
    expect(html).toContain('No React entry module found');
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
