import { describe, it, expect, vi } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { PreviewService } from '../src/server/runtime/PreviewService';
import { StaticRuntime } from '../src/server/runtime/StaticRuntime';
import type { PreviewRuntime } from '../src/server/runtime/RuntimeRouter';

describe('StaticRuntime', () => {
  it('starts, serves HTML, reports status, stops', async () => {
    const rt = new StaticRuntime();
    const vfs = VirtualFileSystem.fromRecord({ 'index.html': '<h1>hi</h1><script src="script.js"></script>', 'script.js': 'var a=1;' });
    const { url, sessionId } = await rt.start('p1', vfs);
    expect(url).toBe(`/preview/${sessionId}`);
    expect(await rt.status(sessionId)).toBe('ready');
    expect(rt.getHtml(sessionId)).toContain('<h1>hi</h1>');
    expect(rt.getHtml(sessionId)).toContain('var a=1;'); // script.js inlined
    await rt.stop(sessionId);
    expect(await rt.status(sessionId)).toBe('stopped');
    expect(rt.getHtml(sessionId)).toBeUndefined();
  });
});

/** Minimal fake server-container runtime for routing tests. */
function fakeServerRuntime(): PreviewRuntime & { started: string[] } {
  const started: string[] = [];
  return {
    target: 'server-container',
    started,
    async start(projectId) { started.push(projectId); return { url: 'http://localhost:3001', sessionId: 'srv-1' }; },
    async stop() {},
    async status() { return 'ready'; },
  };
}

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

  it('routes an Express/Node app to the server-container runtime', async () => {
    const fake = fakeServerRuntime();
    const svc = new PreviewService({ serverRuntime: fake });
    const vfs = VirtualFileSystem.fromRecord({ 'package.json': JSON.stringify({ dependencies: { express: '^4' } }) });
    const r = await svc.startPreview('p3', vfs);
    expect(r.ok).toBe(true);
    expect(r.target).toBe('server-container');
    expect(r.url).toBe('http://localhost:3001');
    expect(fake.started).toEqual(['p3']);
  });

  it('serverTarget delegates to the server runtime (and null when absent)', async () => {
    const fake = { ...fakeServerRuntime(), getTarget: (id: string) => id === 'srv-1' ? { host: 'localhost', port: 3007, origin: 'http://localhost:3007' } : null };
    const svc = new PreviewService({ serverRuntime: fake as any });
    expect(svc.serverTarget('srv-1')).toEqual({ host: 'localhost', port: 3007, origin: 'http://localhost:3007' });
    expect(svc.serverTarget('nope')).toBeNull();
  });

  it('previews a Vite frontend in-browser as a static bundle (no infra)', async () => {
    const svc = new PreviewService();
    const vfs = VirtualFileSystem.fromRecord({
      'package.json': JSON.stringify({ devDependencies: { vite: '^5' }, dependencies: { react: '^18' } }),
      'index.html': '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': 'console.log("hi")',
    });
    const r = await svc.startPreview('p2', vfs);
    expect(r.ok).toBe(true);
    expect(r.target).toBe('static');
  });

  it('falls back to static preview for a non-vite package.json frontend (BUG A5 fix)', async () => {
    // Previously returned ok: false for webcontainer target. Now falls back to static so
    // users always get a preview rather than a hard failure.
    const svc = new PreviewService();
    const vfs = VirtualFileSystem.fromRecord({
      'package.json': JSON.stringify({ dependencies: { svelte: '^4' } }), 'index.html': 'x',
    });
    const r = await svc.startPreview('p3', vfs);
    expect(r.ok).toBe(true);
    expect(r.target).toBe('static');
    expect(r.url).toMatch(/^\/preview\//);
  });
});
