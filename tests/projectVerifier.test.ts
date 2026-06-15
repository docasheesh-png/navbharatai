import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { verifyProject } from '../src/server/project/ProjectVerifier';

const vfsFrom = (f: Record<string, string>) => VirtualFileSystem.fromRecord(f);

describe('verifyProject', () => {
  it('passes a clean static project', () => {
    const r = verifyProject(vfsFrom({
      'index.html': '<link rel="stylesheet" href="style.css"><script src="app.js"></script>',
      'style.css': 'body{}', 'app.js': 'var a=1;',
    }));
    expect(r.ok).toBe(true);
    expect(r.errors).toBe(0);
    expect(r.warnings).toBe(0);
  });

  it('flags invalid JSON as an error', () => {
    const r = verifyProject(vfsFrom({ 'index.html': '<h1>x</h1>', 'data.json': '{ bad json' }));
    expect(r.ok).toBe(false);
    expect(r.errors).toBe(1);
    expect(r.issues[0].message).toMatch(/Invalid JSON/);
  });

  it('flags a missing entry for a static project', () => {
    const r = verifyProject(vfsFrom({ 'style.css': 'body{}' }));
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => /No entry point/.test(i.message))).toBe(true);
  });

  it('warns on broken local references but does not flag CDN urls', () => {
    const r = verifyProject(vfsFrom({
      'index.html': '<link rel="stylesheet" href="missing.css"><script src="https://cdn.x/y.js"></script><img src="logo.png">',
      'logo.png': 'data:image/png;base64,AAA',
    }));
    expect(r.warnings).toBe(1); // only missing.css
    expect(r.issues.some(i => /missing\.css/.test(i.message))).toBe(true);
    expect(r.issues.some(i => /cdn\.x/.test(i.message))).toBe(false);
    expect(r.ok).toBe(true); // warnings don't fail the project
  });

  it('does not flag missing entry when package.json present (build project)', () => {
    const r = verifyProject(vfsFrom({ 'package.json': JSON.stringify({ name: 'x' }), 'src/main.tsx': 'x' }));
    expect(r.issues.some(i => /No entry point/.test(i.message))).toBe(false);
    expect(r.ok).toBe(true);
  });
});
