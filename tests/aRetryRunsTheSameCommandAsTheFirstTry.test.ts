import { describe, expect, it } from 'vitest';
import { pinKnownDepsInInstallCommand } from '../src/server/AgentV3/DependencyAutoFix';
import { quoteShellRouteGroupPaths } from '../src/server/AgentV3/shellCommandSafety';
import { makeDispatcher, toolCall } from './helpers/dispatcherHarness';

const PRISMA_MISSING = 'npx canceled due to missing packages and no YES option';
const CLIENT_NOT_GENERATED = '@prisma/client did not initialize yet — please run prisma generate';

describe('a retry runs the same command as the first try (TD-12)', () => {
  it('pins prisma on the first run and retries that same command', async () => {
    const { act, d } = makeDispatcher();
    const script = [
      { exitCode: 1, stdout: '', stderr: PRISMA_MISSING },
      { exitCode: 0, stdout: 'added', stderr: '' },
      { exitCode: 0, stdout: 'installed', stderr: '' },
    ];
    act.runCommand = async (_ws: string, command: string) => {
      act.commands.push(command);
      return script[Math.min(act.commands.length - 1, script.length - 1)];
    };
    const out = await d.dispatch(toolCall('bash', { command: 'npm i prisma' }), 'backend');
    expect(String(out.content)).toContain('exit=0');
    const pinned = pinKnownDepsInInstallCommand('npm i prisma');
    expect(pinned).toContain('prisma@^6');
    expect(act.commands[0]).toBe(pinned);
    const retries = act.commands.filter((c) => c === act.commands[0]);
    expect(retries.length).toBeGreaterThanOrEqual(2);
    expect(act.commands[2]).toBe(act.commands[0]);
    expect(act.commands.some((c) => c === 'npm i prisma')).toBe(false);
  });

  it('keeps route-group quoting on the retry', async () => {
    const { act, d } = makeDispatcher();
    const script = [
      { exitCode: 1, stdout: '', stderr: CLIENT_NOT_GENERATED },
      { exitCode: 0, stdout: 'generated', stderr: '' },
      { exitCode: 0, stdout: 'shown', stderr: '' },
    ];
    act.runCommand = async (_ws: string, command: string) => {
      act.commands.push(command);
      return script[Math.min(act.commands.length - 1, script.length - 1)];
    };
    const raw = 'cat app/(auth)/page.tsx';
    const quoted = quoteShellRouteGroupPaths(raw);
    expect(quoted).not.toBe(raw);
    const out = await d.dispatch(toolCall('bash', { command: raw }), 'frontend');
    expect(String(out.content)).toContain('exit=0');
    expect(act.commands[0]).toBe(quoted);
    expect(act.commands[2]).toBe(act.commands[0]);
    expect(act.commands[0]).toContain('"app/(auth)/page.tsx"');
  });
});
