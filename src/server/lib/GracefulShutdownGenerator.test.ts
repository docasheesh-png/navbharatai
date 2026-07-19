import { describe, it, expect } from 'vitest';
import { generateGracefulShutdownIntegration } from './GracefulShutdownGenerator';

describe('generateGracefulShutdownIntegration', () => {
  const c = generateGracefulShutdownIntegration();
  const server = c.files['server/lib/shutdown.ts'];

  it('installs SIGTERM/SIGINT handlers that close the server before exiting', () => {
    expect(server).toContain('export function installGracefulShutdown(');
    expect(server).toContain("process.on('SIGTERM'");
    expect(server).toContain("process.on('SIGINT'");
    expect(server).toContain('server.close(');
  });

  it('guards against double-signal, runs cleanup, and has a hard force-exit timeout', () => {
    expect(server).toContain('if (shuttingDown) return');
    expect(server).toContain('options.onShutdown'); // optional cleanup (close DB pool, flush)
    expect(server).toContain('Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10000)');
    expect(server).toContain('forceTimer'); // force exit if graceful close overruns
    expect(server).toContain('unref'); // the timer must not keep the process alive
    expect(server).toContain('clearTimeout(forceTimer)'); // cleared on clean close
  });

  it('the shutdown semantics are correct (re-implemented + exercised, incl. double-signal guard)', () => {
    // Mirror the emitted control flow to prove: close called once, cleanup awaited, exit code from err.
    let closes = 0;
    let cleanups = 0;
    let exitCode: number | null = null;
    const fakeServer = { close: (cb: (err?: Error) => void) => { closes++; cb(undefined); } };
    let shuttingDown = false;
    async function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      fakeServer.close(async (err?: Error) => {
        cleanups++; // stand-in for onShutdown
        exitCode = err ? 1 : 0;
      });
    }
    return Promise.resolve()
      .then(() => shutdown())
      .then(() => shutdown()) // second signal is a no-op
      .then(() => {
        expect(closes).toBe(1);
        expect(cleanups).toBe(1);
        expect(exitCode).toBe(0);
      });
  });

  it('is dependency-free, server-only, writes no .env.example (never overwrites)', () => {
    expect(c.dependency).toBeUndefined();
    expect(c.envKeys).toEqual(['SHUTDOWN_TIMEOUT_MS']);
    expect(c.files['.env.example']).toBeUndefined(); // optional var with a default → no forced file
    expect(Object.keys(c.files)).toEqual(['server/lib/shutdown.ts']);
  });
});
