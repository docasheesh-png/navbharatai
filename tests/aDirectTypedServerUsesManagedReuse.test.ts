import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import {
  buildDepsStaleCheckCommand, buildPortWaitCommand, buildPrebundleStaleCheckCommand,
  detectDevFramework, devServerWatchdogCommand, disableDevServerAutoOpen, ensureHostBinding,
  pinDevServerPort, redirectDevServerOutput, resolvePmScript,
} from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import { __resetDevServerLaunchLog } from '../src/server/AgentV3/devServerLaunchLog';

const ROOT = '/home/user/workspace';
const FOREGROUND = 'fixture: ordinary foreground command';
const pkg = { scripts: { server: 'tsx server/index.ts' } };

/** In-memory SDK boundary only: strings are inspected, never executed or sent to E2B. */
function actuatorWithHealthyServer(command: string) {
  const calls: Array<{ command: string; background?: boolean }> = [];
  const unexpected: string[] = [];
  const resolved = resolvePmScript(command, pkg.scripts);
  const framework = detectDevFramework(resolved);
  const devCommand = redirectDevServerOutput(disableDevServerAutoOpen(
    pinDevServerPort(ensureHostBinding(command, framework, resolved), 3000, framework, resolved),
  ));
  const watchdog = devServerWatchdogCommand({ port: 3000, runCommand: devCommand, cwd: ROOT });
  const responses = new Map([
    [buildPortWaitCommand(3000, 2), 'PORT_UP'],
    [buildDepsStaleCheckCommand(), 'FRESH'],
    [buildPrebundleStaleCheckCommand(), 'FRESH'],
    [watchdog, 'fixture: watchdog armed'],
  ]);
  const sandbox = {
    commands: {
      run: vi.fn(async (text: string, options?: { background?: boolean }) => {
        calls.push({ command: text, background: options?.background });
        if (text === command) return { exitCode: 0, stdout: FOREGROUND, stderr: '' };
        const stdout = responses.get(text);
        if (stdout !== undefined) return { exitCode: 0, stdout, stderr: '' };
        unexpected.push(text);
        throw new Error('Unexpected SDK command in managed-reuse fixture');
      }),
    },
    files: {
      read: async (path: string) => {
        if (path !== `${ROOT}/package.json`) throw new Error('Unexpected SDK file read');
        return JSON.stringify(pkg);
      },
    },
  };
  const act = new E2BActuator('test-only-no-network');
  const injected = act as unknown as { getSandbox: () => Promise<typeof sandbox> };
  injected.getSandbox = async () => sandbox;
  return { act, calls, unexpected, watchdog };
}

describe('direct typed servers use the actuator managed-reuse path', () => {
  beforeEach(() => {
    vi.stubEnv('AGENTV3_DEVSERVER_FASTPATH', 'on');
    vi.stubEnv('AGENTV3_DEVSERVER_LOAD_DOTENV', 'off');
    __resetDevServerLaunchLog();
  });
  afterEach(() => { vi.unstubAllEnvs(); __resetDevServerLaunchLog(); });

  it.each(['npx tsx server/index.ts', 'npm run server'])('reuses the healthy server for %s without a duplicate launch', async (command) => {
    const h = actuatorWithHealthyServer(command);
    const result = await h.act.runCommand(`ws-q2162-${command.startsWith('npx') ? 'direct' : 'script'}`, command);
    expect(h.unexpected).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('dev server already healthy on port 3000 — reused it');
    expect(h.calls.map((call) => call.command)).toEqual([
      buildPortWaitCommand(3000, 2), buildDepsStaleCheckCommand(), buildPrebundleStaleCheckCommand(), h.watchdog,
    ]);
    expect(h.calls.some((call) => call.command === command || call.background === true)).toBe(false);
  });

  it.each([
    'npx tsx scripts/seed.ts',
    'printf "%s" "hint; npx tsx server/index.ts"',
    'printf "%s" "hint; npx tsx server/index.ts; harmless"',
    'node -e "console.log(\'example; npx tsx server/index.ts\')"',
    'npx tsx scripts/seed.ts --label "a && node server.js"',
    'timeout --help 120 npx tsx server/index.ts',
    'npx tsx server/index.ts --help',
    'node --check server.js',
  ])('keeps a one-shot or data-only command on the ordinary foreground path: %s', async (command) => {
    const h = actuatorWithHealthyServer(command);
    const result = await h.act.runCommand('ws-q2162-one-shot', command);
    expect(h.unexpected).toEqual([]);
    expect(result).toMatchObject({ exitCode: 0, stdout: FOREGROUND, stderr: '' });
    expect(h.calls).toEqual([{ command, background: undefined }]);
  });
});
