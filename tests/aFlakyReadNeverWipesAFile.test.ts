import { beforeEach, describe, expect, it } from 'vitest';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { _clearWorkspaceMemory, getWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { FakeActuator, toolCall } from './helpers/dispatcherHarness';

class FlakyRead extends FakeActuator {
  /** Paths whose read throws instead of returning the map. */
  throwOn = new Map<string, Error>();
  override async readFile(ws: string, path: string): Promise<string> {
    const err = this.throwOn.get(path);
    if (err) throw err;
    return super.readFile(ws, path);
  }
}

function harness(act: FlakyRead) {
  const stream = new AgentEventStream();
  const state = new WorkspaceState(stream);
  const d = new ToolDispatcher(act, 'ws-flaky', state, stream);
  return { d };
}

describe('a flaky read never wipes a file', () => {
  beforeEach(() => { _clearWorkspaceMemory(); });

  it('a reset while reading .env does not write the vault merge', async () => {
    const act = new FlakyRead();
    act.files.set('.env', 'DATABASE_URL=postgres://already/there\n');
    act.throwOn.set('.env', new Error('ECONNRESET'));
    const { d } = harness(act);
    d.setUserSecrets({ DATABASE_URL: 'postgres://u:p@h/db' });
    await d.ensureUserSecretsEnvFile('npm run dev');
    expect(act.files.get('.env')).toBe('DATABASE_URL=postgres://already/there\n');
    const audits = getWorkspaceMemory('ws-flaky').snapshot().episodes.map((e) => e.text).join('\n');
    expect(audits).toContain('ENV_MERGE_SKIPPED');
  });

  it('a timed-out read of src/App.tsx refuses the overwrite', async () => {
    const act = new FlakyRead();
    const original = 'export default function App(){ return 1; }\n';
    act.files.set('src/App.tsx', original);
    act.throwOn.set('src/App.tsx', new Error('ETIMEDOUT'));
    const { d } = harness(act);
    const res = await d.dispatch(toolCall('write_file', {
      path: 'src/App.tsx',
      content: 'export default function App(){ return 2; }\n',
    }), 'architect');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('not overwriting');
    expect(act.files.get('src/App.tsx')).toBe(original);
  });

  it('an ENOENT read still allows a create', async () => {
    const act = new FlakyRead();
    act.throwOn.set('src/New.tsx', new Error('ENOENT: src/New.tsx'));
    const { d } = harness(act);
    const res = await d.dispatch(toolCall('write_file', {
      path: 'src/New.tsx',
      content: 'export const created = true;\n',
    }), 'frontend');
    expect(res.is_error).toBe(false);
    expect(act.files.get('src/New.tsx')).toBe('export const created = true;\n');
  });
});
