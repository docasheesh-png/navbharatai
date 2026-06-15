import { describe, it, expect, vi } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { ServerContainerRuntime } from '../src/server/runtime/ServerContainerRuntime';
import { HealthStatus } from '../src/server/PreviewRunner/PreviewHealthChecker';

function makeRuntime(overrides: any = {}) {
  const calls: any = { install: [], launch: [], terminate: [], released: [] };
  const deps = {
    materialize: () => ({ dir: '/tmp/fake-ws', fileCount: 3 }),
    launcher: {
      detectPackageManager: async () => 'npm',
      installDependencies: () => ['npm', ['install']],
      getStartCommand: () => ['npm', ['run', 'dev']],
    } as any,
    sandbox: {
      launch: (...a: any[]) => { calls.launch.push(a); return 1234; },
      terminate: (d: string) => calls.terminate.push(d),
      onProcessLifecycle: () => {},
    } as any,
    portManager: {
      allocatePort: async () => 3005,
      releasePort: (p: number) => calls.released.push(p),
    } as any,
    healthChecker: { check: async () => HealthStatus.HEALTHY } as any,
    installer: async (dir: string, cmd: string, args: string[]) => { calls.install.push([dir, cmd, args]); },
    ...overrides,
  };
  return { rt: new ServerContainerRuntime(deps), calls };
}

describe('ServerContainerRuntime', () => {
  it('orchestrates materialize → install → launch → health → ready url', async () => {
    const { rt, calls } = makeRuntime();
    const vfs = VirtualFileSystem.fromRecord({ 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }) });
    const { url, sessionId } = await rt.start('proj', vfs);
    expect(url).toBe('http://localhost:3005');
    expect(calls.install).toHaveLength(1);
    expect(calls.install[0][1]).toBe('npm');
    expect(calls.launch).toHaveLength(1);
    expect(await rt.status(sessionId)).toBe('ready');
  });

  it('marks error when health check times out', async () => {
    const { rt } = makeRuntime({ healthChecker: { check: async () => HealthStatus.TIMEOUT } });
    const vfs = VirtualFileSystem.fromRecord({ 'package.json': '{}' });
    const { sessionId } = await rt.start('proj', vfs);
    expect(await rt.status(sessionId)).toBe('error');
  });

  it('stop terminates, releases port, and clears the session', async () => {
    const { rt, calls } = makeRuntime();
    const vfs = VirtualFileSystem.fromRecord({ 'package.json': '{}' });
    const { sessionId } = await rt.start('proj', vfs);
    await rt.stop(sessionId);
    expect(calls.terminate).toContain('/tmp/fake-ws');
    expect(calls.released).toContain(3005);
    expect(await rt.status(sessionId)).toBe('stopped');
  });

  it('cleans up and rethrows when install fails', async () => {
    const { rt, calls } = makeRuntime({
      installer: async () => { throw new Error('npm install failed'); },
    });
    const vfs = VirtualFileSystem.fromRecord({ 'package.json': '{}' });
    await expect(rt.start('proj', vfs)).rejects.toThrow(/install failed/);
    expect(calls.released).toContain(3005); // port released on failure
  });
});
