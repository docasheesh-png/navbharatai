import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { PreviewService } from '../src/server/runtime/PreviewService';
import { StaticRuntime } from '../src/server/runtime/StaticRuntime';

describe('StaticRuntime', () => {
  it('starts, serves HTML, reports status, stops', async () => {
    const rt = new StaticRuntime();
    const vfs = VirtualFileSystem.fromRecord({ 'index.html': '<h1>hi</h1>', 'script.js': 'var a=1;' });
    const { url, sessionId } = await rt.start('p1', vfs);
    expect(url).toBe(`/preview/${sessionId}`);
    expect(await rt.status(sessionId)).toBe('ready');
    expect(rt.getHtml(sessionId)).toContain('var a=1;'); // inlined
    await rt.stop(sessionId);
    expect(await rt.status(sessionId)).toBe('stopped');
    expect(rt.getHtml(sessionId)).toBeUndefined();
  });
});

describe('PreviewService', () => {
  it('starts a working static preview for a pure HTML app', async () => {
    const svc = new PreviewService();
    const vfs = VirtualFileSystem.fromRecord({ 'index.html': '<link rel="stylesheet" href="s.css">', 's.css': 'body{}' });
    const r = await svc.startPreview('p1', vfs);
    expect(r.ok).toBe(true);
    expect(r.target).toBe('static');
    expect(r.url).toMatch(/^\/preview\//);
    expect(svc.static.getHtml(r.sessionId!)).toContain('body{}');
  });

  it('returns an honest not-ready result for a Vite (webcontainer) app', async () => {
    const svc = new PreviewService();
    const vfs = VirtualFileSystem.fromRecord({
      'package.json': JSON.stringify({ devDependencies: { vite: '^5' } }), 'index.html': 'x',
    });
    const r = await svc.startPreview('p2', vfs);
    expect(r.ok).toBe(false);
    expect(r.target).toBe('webcontainer');
    expect(r.reason).toMatch(/not provisioned/i);
  });

  it('returns an honest not-ready result for an Express (server) app', async () => {
    const svc = new PreviewService();
    const vfs = VirtualFileSystem.fromRecord({ 'package.json': JSON.stringify({ dependencies: { express: '^4' } }) });
    const r = await svc.startPreview('p3', vfs);
    expect(r.ok).toBe(false);
    expect(r.target).toBe('server-container');
  });
});
