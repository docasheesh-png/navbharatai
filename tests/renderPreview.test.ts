import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { renderPreview } from '../src/server/runtime/renderPreview';
import { isReactProject } from '../src/server/runtime/ReactPreview';
import { isVueProject } from '../src/server/runtime/VuePreview';

const vfsFrom = (files: Record<string, string>) => VirtualFileSystem.fromRecord(files);

describe('isReactProject', () => {
  it('returns true when package.json lists react as dependency', () => {
    const vfs = vfsFrom({ 'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }) });
    expect(isReactProject(vfs)).toBe(true);
  });

  it('returns true when package.json lists react as devDependency', () => {
    const vfs = vfsFrom({ 'package.json': JSON.stringify({ devDependencies: { react: '^18.0.0' } }) });
    expect(isReactProject(vfs)).toBe(true);
  });

  it('returns true when a .tsx file is present (no package.json)', () => {
    const vfs = vfsFrom({ 'src/App.tsx': 'export default function App() { return null; }' });
    expect(isReactProject(vfs)).toBe(true);
  });

  it('returns true when a .jsx file is present', () => {
    const vfs = vfsFrom({ 'App.jsx': 'export default () => null;' });
    expect(isReactProject(vfs)).toBe(true);
  });

  it('returns false for a plain HTML project', () => {
    const vfs = vfsFrom({ 'index.html': '<html><body>hello</body></html>' });
    expect(isReactProject(vfs)).toBe(false);
  });

  it('handles malformed package.json gracefully', () => {
    const vfs = vfsFrom({ 'package.json': 'not json { bad' });
    expect(() => isReactProject(vfs)).not.toThrow();
  });
});

describe('isVueProject', () => {
  it('returns true when package.json lists vue', () => {
    const vfs = vfsFrom({ 'package.json': JSON.stringify({ dependencies: { vue: '^3.0.0' } }) });
    expect(isVueProject(vfs)).toBe(true);
  });

  it('returns true when a .vue file is present', () => {
    const vfs = vfsFrom({ 'App.vue': '<template><div>hello</div></template>' });
    expect(isVueProject(vfs)).toBe(true);
  });

  it('returns false for a React project', () => {
    const vfs = vfsFrom({ 'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }) });
    expect(isVueProject(vfs)).toBe(false);
  });
});

describe('renderPreview dispatch', () => {
  it('dispatches to static preview for plain HTML', () => {
    const vfs = vfsFrom({ 'index.html': '<html><body>static</body></html>' });
    const output = renderPreview(vfs);
    expect(output).toContain('static');
    // Static preview returns the HTML as-is (no CDN bundle injected)
    expect(output).not.toContain('babel.min.js');
  });

  it('dispatches to react preview when react is listed', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'index.html': '<html><body></body></html>',
      'src/main.tsx': 'import React from "react"; const App = () => <div>hi</div>; export default App;',
    });
    const output = renderPreview(vfs);
    // React preview injects Babel CDN
    expect(output).toContain('babel.min.js');
  });

  it('dispatches to vue preview when a .vue file is present (returns HTML doc)', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { vue: '^3.0.0' } }),
      'index.html': '<html><body><script type="module" src="src/main.js"></script></body></html>',
      'src/main.js': "import { createApp } from 'vue'; import App from './App.vue'; createApp(App).mount('#app');",
      'App.vue': '<template><div>hello vue</div></template>',
    });
    const output = renderPreview(vfs);
    // Vue preview returns an HTML document (either with CDN or an error page)
    expect(output).toMatch(/<!doctype html/i);
  });
});
