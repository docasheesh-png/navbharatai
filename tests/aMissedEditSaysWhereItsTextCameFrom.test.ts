// 🔴 Q-2697 / Q-2917 / Q-2926 (autopsies 9ed80cc9, aba63ead #2475, a360bc2c #2466): `edit_file` misses on weak rungs
// were mostly ONE mistake — quoting a version of the file that was not on disk (a refused change, a read from before
// the model's own edit, a version a platform pass replaced) — and the error only said "not found". The miss now names
// where the quote came from. Reversion: drop `withEditMissProvenance` from the edit door, or `fileViews.note` from
// read_file / the refusal, and the end-to-end block fails.
import { describe, it, expect } from 'vitest';
import { FileViews, explainEditMiss } from '../src/server/AgentV3/editProvenance';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const ORIGINAL = `export function App() {\n  return (\n    <main>\n      <WorldMap world={world} />\n      <VirtualJoystick onMove={move} />\n    </main>\n  );\n}\n`;

describe('explainEditMiss — the three #2475 shapes', () => {
  it('a quote from a REFUSED change is named as never saved', () => {
    const v = new FileViews();
    v.note('src/components/BattlegroundGame.tsx', ORIGINAL, 'read');
    v.note('src/components/BattlegroundGame.tsx', ORIGINAL.replace('<main>', '<main>\n      <div className="z-30"><MiniMap />'), 'refused');
    const why = explainEditMiss('src/components/BattlegroundGame.tsx', '<div className="z-30"><MiniMap />', ORIGINAL, v);
    expect(why).toMatch(/REFUSED and never saved/);
  });

  it('a quote from a read that the file has since moved past is named as stale', () => {
    const v = new FileViews();
    v.note('src/App.tsx', ORIGINAL, 'read');
    const now = ORIGINAL.replace('<WorldMap world={world} />', '<BattlegroundGame />');
    expect(explainEditMiss('src/App.tsx', '<WorldMap world={world} />', now, v)).toMatch(/has changed since/);
  });

  it('a quote in no version the model saw is named as reconstructed from memory', () => {
    const v = new FileViews();
    v.note('src/components/MiniMap.tsx', ORIGINAL, 'read');
    expect(explainEditMiss('src/components/MiniMap.tsx', '<button>Move to Mumbai</button>', ORIGINAL, v)).toMatch(/reconstructed\s+from memory/);
    expect(explainEditMiss('src/other.tsx', '<button>Move to Mumbai</button>', ORIGINAL, v)).toMatch(/have not read/);
  });

  it('says nothing when the quote is really there, or too short to judge', () => {
    const v = new FileViews();
    expect(explainEditMiss('src/App.tsx', '<VirtualJoystick onMove={move} />', ORIGINAL, v)).toBe('');
    expect(explainEditMiss('src/App.tsx', 'x', ORIGINAL, v)).toBe('');
  });
});

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

describe('end to end through the real edit door', () => {
  const make = () => {
    const actuator = new FakeActuator();
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(actuator, 'ws-q2697', new WorkspaceState(stream), stream);
    return { actuator, d };
  };
  const run = (d: ToolDispatcher, name: string, input: Record<string, unknown>) =>
    (d as unknown as { dispatch: (c: { id: string; name: string; input: Record<string, unknown> }) => Promise<{ content: string; is_error?: boolean }> })
      .dispatch({ id: `t-${Math.random()}`, name, input });

  it('read → own edit → a stale quote: the miss says the file changed since it was read', async () => {
    const { actuator, d } = make();
    actuator.files.set('src/App.tsx', ORIGINAL);
    await run(d, 'read_file', { path: 'src/App.tsx' });
    const ok = await run(d, 'edit_file', { path: 'src/App.tsx', old_string: '<WorldMap world={world} />', new_string: '<BattlegroundGame />' });
    expect(ok.is_error).toBeFalsy();
    const miss = await run(d, 'edit_file', { path: 'src/App.tsx', old_string: '<WorldMap world={world} />', new_string: '<Game />' });
    expect(miss.is_error).toBe(true);
    expect(miss.content).toMatch(/old_string not found/);
    expect(miss.content).toMatch(/has changed since/);
  });

  it('a refused edit, then "fixing" it: the miss says the refused change was never saved', async () => {
    const { actuator, d } = make();
    actuator.files.set('src/App.tsx', ORIGINAL);
    await run(d, 'read_file', { path: 'src/App.tsx' });
    const refused = await run(d, 'edit_file', { path: 'src/App.tsx', old_string: '<WorldMap world={world} />', new_string: '<WorldMap world={world} />\n      <div className="z-30">{</div>' });
    expect(refused.is_error).toBe(true);
    expect(refused.content).toMatch(/WRITE REJECTED/);
    const miss = await run(d, 'edit_file', { path: 'src/App.tsx', old_string: '<div className="z-30">{</div>', new_string: '<div className="z-30"></div>' });
    expect(miss.is_error).toBe(true);
    expect(miss.content).toMatch(/REFUSED and never saved/);
  });
});
