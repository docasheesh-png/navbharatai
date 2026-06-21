import { describe, it, expect } from 'vitest';
import { StaticRuntime } from '../src/server/runtime/StaticRuntime';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

function vfs(files: Record<string, string>) {
  return VirtualFileSystem.fromRecord(files);
}

describe('StaticRuntime', () => {
  it('start() returns a url and sessionId', async () => {
    const runtime = new StaticRuntime();
    const result = await runtime.start('proj-1', vfs({ 'index.html': '<h1>hi</h1>' }));
    expect(result.url).toBeTruthy();
    expect(result.sessionId).toBeTruthy();
  });

  it('url is /preview/<sessionId>', async () => {
    const runtime = new StaticRuntime();
    const result = await runtime.start('proj-1', vfs({ 'index.html': '<h1>hi</h1>' }));
    expect(result.url).toBe(`/preview/${result.sessionId}`);
  });

  it('status() is "ready" after start()', async () => {
    const runtime = new StaticRuntime();
    const { sessionId } = await runtime.start('proj-1', vfs({ 'index.html': '<h1>hi</h1>' }));
    expect(await runtime.status(sessionId)).toBe('ready');
  });

  it('status() is "stopped" for unknown sessionId', async () => {
    const runtime = new StaticRuntime();
    expect(await runtime.status('nonexistent')).toBe('stopped');
  });

  it('stop() removes the session', async () => {
    const runtime = new StaticRuntime();
    const { sessionId } = await runtime.start('proj-1', vfs({ 'index.html': '<h1>hi</h1>' }));
    await runtime.stop(sessionId);
    expect(await runtime.status(sessionId)).toBe('stopped');
  });

  it('getHtml() returns the built HTML', async () => {
    const runtime = new StaticRuntime();
    const { sessionId } = await runtime.start('proj-1', vfs({ 'index.html': '<h1>Hello</h1>' }));
    const html = runtime.getHtml(sessionId);
    expect(html).toBeTruthy();
    expect(typeof html).toBe('string');
  });

  it('getHtml() returns undefined for unknown sessionId', () => {
    const runtime = new StaticRuntime();
    expect(runtime.getHtml('nonexistent')).toBeUndefined();
  });
});
