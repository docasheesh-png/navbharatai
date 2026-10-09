/**
 * TD-3: codemod_move_file must not `rm` the only copy when a write failed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { _clearWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { FakeActuator, toolCall } from './helpers/dispatcherHarness';

class FailingDest extends FakeActuator {
  override async writeFile(ws: string, p: string, c: string): Promise<void> {
    if (p === 'src/new/B.tsx') throw new Error('EIO');
    return super.writeFile(ws, p, c);
  }
}

function dispatcher(act: FakeActuator, ws: string) {
  const stream = new AgentEventStream();
  const state = new WorkspaceState(stream);
  return new ToolDispatcher(act, ws, state, stream);
}

function seed(act: FakeActuator) {
  act.files.set('src/B.tsx', 'export const B = 1;\n');
  act.files.set('src/App.tsx', "import { B } from './B';\nexport const App = B;\n");
}

describe('a moved file is never lost when the write fails (TD-3)', () => {
  beforeEach(() => { _clearWorkspaceMemory(); });

  it('does not delete the source when the destination write throws', async () => {
    const act = new FailingDest();
    seed(act);
    const d = dispatcher(act, 'ws-move-fail');
    const res = await d.dispatch(toolCall('codemod_move_file', { from: 'src/B.tsx', to: 'src/new/B.tsx' }), 'architect');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('was NOT deleted');
    expect(res.content).toContain('src/new/B.tsx');
    expect(act.files.has('src/B.tsx')).toBe(true);
    expect(act.commands.some((c) => c.includes("rm -f 'src/B.tsx'"))).toBe(false);
  });

  it('on the happy path the old file is removed and the result is not an error', async () => {
    const act = new FakeActuator();
    const orig = act.runCommand.bind(act);
    act.runCommand = async (ws, command) => {
      const r = await orig(ws, command);
      const m = /^rm -f '([^']+)'$/.exec(command);
      if (m && r.exitCode === 0) act.files.delete(m[1]);
      return r;
    };
    seed(act);
    const d = dispatcher(act, 'ws-move-ok');
    const res = await d.dispatch(toolCall('codemod_move_file', { from: 'src/B.tsx', to: 'src/new/B.tsx' }), 'architect');
    expect(res.is_error).toBe(false);
    expect(act.files.has('src/B.tsx')).toBe(false);
    expect(act.files.get('src/new/B.tsx')).toContain('export const B');
    expect(act.commands.some((c) => c.includes("rm -f 'src/B.tsx'"))).toBe(true);
  });
});
