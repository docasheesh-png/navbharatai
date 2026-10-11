import { describe, expect, it } from 'vitest';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { FakeActuator, toolCall } from './helpers/dispatcherHarness';

describe('migrations run like bash (TD-15)', () => {
  it('writes the vault .env before the migrate command and redacts the secret', async () => {
    const act = new FakeActuator();
    act.files.set('prisma/schema.prisma', 'datasource db {\n  provider = "sqlite"\n  url = "file:./dev.db"\n}\n');
    act.files.set('package.json', JSON.stringify({ dependencies: { prisma: '^6.1.0' } }));
    const order: string[] = [];
    act.writeFile = async (_ws: string, path: string, content: string) => {
      order.push(`write:${path}`);
      act.files.set(path, content);
    };
    act.runCommand = async (_ws: string, command: string) => {
      order.push(`run:${command}`);
      act.commands.push(command);
      return { exitCode: 1, stdout: '', stderr: 'postgres://u:FAKEPASS@h/db refused' };
    };
    const seen: { command: string; stdout: string; stderr: string }[] = [];
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const d = new ToolDispatcher(
      act, 'ws-mig', state, stream,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'vite-react',
      (r) => seen.push({ command: r.command, stdout: r.stdout, stderr: r.stderr }),
    );
    d.setUserSecrets({ DATABASE_URL: 'postgres://u:FAKEPASS@h/db' });

    const res = await d.dispatch(toolCall('run_migrations', {}), 'backend');
    expect(String(res.content)).not.toContain('FAKEPASS');
    const envAt = order.indexOf('write:.env');
    const migAt = order.findIndex((s) => s.startsWith('run:') && s.includes('prisma'));
    expect(envAt).toBeGreaterThanOrEqual(0);
    expect(migAt).toBeGreaterThan(envAt);
    expect(act.files.get('.env')).toContain('DATABASE_URL');
    expect(seen.length).toBeGreaterThan(0);
    for (const row of seen) {
      expect(row.command + row.stdout + row.stderr).not.toContain('FAKEPASS');
    }
    expect(seen.some((row) => row.stderr.includes('[REDACTED:credential]'))).toBe(true);
  });
});
