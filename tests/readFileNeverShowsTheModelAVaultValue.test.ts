import { describe, expect, it } from 'vitest';
import { SECRET_MASK } from '../src/server/AgentV3/secretFileView';
import { makeDispatcher, toolCall } from './helpers/dispatcherHarness';

describe('read_file never shows the model a vault value (TD-5)', () => {
  it('masks a vault key and a secret-shaped name, and keeps a plain port and a comment', async () => {
    const { act, d } = makeDispatcher();
    d.setUserSecrets({ OPENAI_API_KEY: 'sk-FAKEvalue0123456789abcd' });
    act.files.set('.env', 'OPENAI_API_KEY=sk-FAKEvalue0123456789abcd\nPORT=3000\n# note\n');
    const res = await d.dispatch(toolCall('read_file', { path: '.env' }), 'architect');
    expect(res.is_error).not.toBe(true);
    expect(res.content).toContain(`OPENAI_API_KEY=${SECRET_MASK}`);
    expect(res.content).toContain('PORT=3000');
    expect(res.content).toContain('# note');
    expect(res.content).not.toContain('sk-FAKEvalue0123456789abcd');
  });

  it('returns a stub for a service-account file', async () => {
    const { act, d } = makeDispatcher();
    const body = '{"type":"service_account","private_key":"not-a-real-key"}';
    act.files.set('serviceAccount.json', body);
    const res = await d.dispatch(toolCall('read_file', { path: 'serviceAccount.json' }), 'architect');
    expect(res.content).toContain('[credential file — contents hidden,');
    expect(res.content).toContain('bytes]');
    expect(res.content).not.toContain('not-a-real-key');
  });

  it('refuses to write the hidden placeholder back into .env', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('.env', 'OPENAI_API_KEY=sk-FAKEvalue0123456789abcd\n');
    const res = await d.dispatch(toolCall('write_file', {
      path: '.env',
      content: `OPENAI_API_KEY=${SECRET_MASK}\n`,
    }), 'architect');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('hidden placeholder');
    expect(act.files.get('.env')).toBe('OPENAI_API_KEY=sk-FAKEvalue0123456789abcd\n');
  });
});

describe('command output that reaches the model is redacted (TD-6)', () => {
  it('run_tests does not echo a key printed by the suite', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('package.json', JSON.stringify({ scripts: { test: 'vitest run' } }));
    act.commandResult = { exitCode: 1, stdout: 'OPENAI_API_KEY=sk-FAKEvalue0123456789abcd\n1 failed', stderr: '' };
    const res = await d.dispatch(toolCall('run_tests', {}), 'architect');
    expect(res.content).not.toContain('sk-FAKEvalue0123456789abcd');
  });

  it('run_migrations does not echo a key printed by the migrator', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('prisma/schema.prisma', 'datasource db { provider = "postgresql" }');
    act.commandResult = { exitCode: 1, stdout: '', stderr: 'OPENAI_API_KEY=sk-FAKEvalue0123456789abcd' };
    const res = await d.dispatch(toolCall('run_migrations', {}), 'architect');
    expect(res.content).not.toContain('sk-FAKEvalue0123456789abcd');
  });
});
