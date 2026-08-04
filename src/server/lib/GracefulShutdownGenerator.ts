// U-4 (verified recipe modules) — graceful-shutdown generator.
//
// The actionable counterpart to the graceful-shutdown ADVISORY analyzer (which only FLAGS an app that
// ignores SIGTERM). On every deploy/restart the platform sends SIGTERM; a server that exits immediately
// drops in-flight requests and cuts open DB connections mid-write. This generator installs a real graceful
// shutdown: stop accepting new connections, let in-flight requests finish, run optional cleanup (close the
// DB pool), then exit — with a hard timeout so a stuck connection can never hang the shutdown forever.
// Dependency-free (Node signals + http server). PURE builder; complete code, no TODO stubs. Unit-tested.

export interface GracefulShutdownConfig {
  files: Record<string, string>;
  envKeys: string[];
  /** Dependency-free — Node process signals + the http server's own close(). */
  dependency?: { name: string; version: string };
  instructions: string;
}

const SHUTDOWN_SERVER = `// Graceful shutdown for a Node http server. On SIGTERM/SIGINT: stop accepting new connections, let in-flight
// requests finish, run optional cleanup (e.g. close a DB pool), then exit — with a hard timeout so a stuck
// connection can't hang the shutdown forever. Call once after the server starts listening.
export interface ShutdownOptions {
  // Milliseconds to wait for in-flight work before forcing exit (SHUTDOWN_TIMEOUT_MS or 10s).
  timeoutMs?: number;
  // Optional async cleanup run after the server stops accepting connections (close DB pools, flush logs, …).
  onShutdown?: () => Promise<void> | void;
}

export function installGracefulShutdown(
  server: { close: (cb: (err?: Error) => void) => void },
  options: ShutdownOptions = {},
): void {
  const timeoutMs = options.timeoutMs ?? Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10000);
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return; // a second signal must not restart the sequence
    shuttingDown = true;
    console.log(\`\${signal} received — shutting down gracefully\`);

    // Force-exit if graceful close overruns the timeout (unref so this timer never keeps the process alive).
    const forceTimer = setTimeout(() => {
      console.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, timeoutMs);
    if (typeof forceTimer.unref === 'function') forceTimer.unref();

    server.close(async (err?: Error) => {
      try {
        if (options.onShutdown) await options.onShutdown();
      } catch (cleanupErr) {
        console.error('Error during shutdown cleanup:', cleanupErr);
      }
      clearTimeout(forceTimer);
      process.exit(err ? 1 : 0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
`;

const INSTRUCTIONS =
  'Graceful shutdown wired at server/lib/shutdown.ts. After the server starts listening, call ' +
  "installGracefulShutdown(server, { onShutdown: async () => { await db.end(); } }). On the SIGTERM every " +
  'deploy sends, it stops taking new connections, lets in-flight requests finish, runs your cleanup, then ' +
  'exits — with a hard timeout (SHUTDOWN_TIMEOUT_MS, default 10s) so a stuck connection can never hang the ' +
  'deploy. No dependency needed; NavBharatAI never stores SHUTDOWN_TIMEOUT_MS.';

export function generateGracefulShutdownIntegration(): GracefulShutdownConfig {
  return {
    files: { 'server/lib/shutdown.ts': SHUTDOWN_SERVER },
    envKeys: ['SHUTDOWN_TIMEOUT_MS'],
    instructions: INSTRUCTIONS,
  };
}
