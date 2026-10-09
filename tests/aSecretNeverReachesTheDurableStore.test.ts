import { describe, expect, it, vi } from 'vitest';
import { normalizeFileMapKeys, toDurableFileKey } from '../src/server/lib/workspacePath';
import { recordingActuator } from '../src/server/AgentV3/recordedWrites';
import { ALWAYS_WRITE_SECRETS } from '../src/server/AgentV3/ToolDispatcher';
import { makeDispatcher } from './helpers/dispatcherHarness';

describe('a live env file never becomes a durable project file (TD-1)', () => {
  it('refuses .env and .env.local, and keeps examples and ordinary source', () => {
    expect(toDurableFileKey('.env')).toBeNull();
    expect(toDurableFileKey('/home/user/workspace/server/.env.local')).toBeNull();
    expect(toDurableFileKey('.env.example')).toBe('.env.example');
    expect(toDurableFileKey('src/env.ts')).toBe('src/env.ts');
  });

  it('drops .env when a file map is normalized', () => {
    const out = normalizeFileMapKeys({ '.env': 'A=1', 'src/a.ts': 'x' });
    expect(out.files).toEqual({ 'src/a.ts': 'x' });
    expect(out.files['.env']).toBeUndefined();
  });

  it('writes the vault into the sandbox and never tells the durable callback', async () => {
    const spy = vi.fn();
    const { act, d } = makeDispatcher({ onFileWrite: spy });
    d.setUserSecrets({ OPENAI_API_KEY: 'sk-FAKE' });
    await d.ensureUserSecretsEnvFile(ALWAYS_WRITE_SECRETS);
    expect(act.files.get('.env') ?? '').toContain('OPENAI_API_KEY=sk-FAKE');
    expect(spy.mock.calls.some((c) => String(c[0]).split('/').pop() === '.env')).toBe(false);
  });

  it('recordingActuator notes source files and skips a vault env file', async () => {
    const inner = {
      files: new Map<string, string>(),
      async writeFile(_ws: string, path: string, content: string) { this.files.set(path, content); },
    };
    const spy = vi.fn();
    const wrapped = recordingActuator(inner, 'ws-1', spy);
    await wrapped.writeFile('ws-1', '.env', 'A=1');
    await wrapped.writeFile('ws-1', 'src/a.ts', 'x');
    expect(inner.files.get('.env')).toBe('A=1');
    expect(spy).not.toHaveBeenCalledWith('.env', 'A=1');
    expect(spy).toHaveBeenCalledWith('src/a.ts', 'x');
  });
});
