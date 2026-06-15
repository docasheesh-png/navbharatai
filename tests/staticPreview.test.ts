import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { buildStaticPreview } from '../src/server/runtime/StaticPreview';

const vfsFrom = (f: Record<string, string>) => VirtualFileSystem.fromRecord(f);

describe('buildStaticPreview', () => {
  it('inlines local stylesheet and script', () => {
    const html = buildStaticPreview(vfsFrom({
      'index.html': '<html><head><link rel="stylesheet" href="style.css"></head><body><script src="script.js"></script></body></html>',
      'style.css': 'body{color:red}',
      'script.js': 'console.log("hi")',
    }));
    expect(html).toContain('<style>');
    expect(html).toContain('body{color:red}');
    expect(html).toContain('console.log("hi")');
    expect(html).not.toContain('href="style.css"');
    expect(html).not.toContain('src="script.js"');
  });

  it('leaves external (CDN) urls untouched', () => {
    const html = buildStaticPreview(vfsFrom({
      'index.html': '<html><head><link rel="stylesheet" href="https://cdn.example.com/x.css"></head><body><script src="https://cdn.example.com/x.js"></script></body></html>',
    }));
    expect(html).toContain('https://cdn.example.com/x.css');
    expect(html).toContain('https://cdn.example.com/x.js');
  });

  it('rewrites a local image to a data-URL', () => {
    const png = Buffer.from('PNGBYTES').toString('base64');
    const html = buildStaticPreview(vfsFrom({
      'index.html': '<img src="logo.png">',
      'logo.png': png, // stored as base64 (binary ext auto-detected)
    }));
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain('src="logo.png"');
  });

  it('preserves module type when inlining', () => {
    const html = buildStaticPreview(vfsFrom({
      'index.html': '<script type="module" src="main.js"></script>',
      'main.js': 'export const x = 1;',
    }));
    expect(html).toContain('<script type="module">');
    expect(html).toContain('export const x = 1;');
  });

  it('synthesizes a shell when no index.html exists', () => {
    const html = buildStaticPreview(vfsFrom({ 'style.css': 'body{}', 'script.js': 'var a=1;' }));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('body{}');
    expect(html).toContain('var a=1;');
  });

  it('resolves nested relative paths against the entry dir', () => {
    const html = buildStaticPreview(vfsFrom({
      'public/index.html': '<link rel="stylesheet" href="css/app.css">',
      'public/css/app.css': '.x{}',
    }), 'public/index.html');
    expect(html).toContain('.x{}');
  });
});
