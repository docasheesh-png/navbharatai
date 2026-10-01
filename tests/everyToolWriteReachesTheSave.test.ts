// AUTOPSY 1389f0d5 (2026-09-30): "SAVED_SOURCE_DIVERGES — src/App.tsx".
//
// The model edited src/App.tsx twice with edit_file (both recorded for the save), then rewrote the App
// component with replace_symbol — which wrote to the sandbox and recorded nothing. The durable save lets
// recorded writes win, so the user's saved project, their GitHub push and the preview copy got the App
// from BEFORE replace_symbol, while every browser check had looked at the one after it. Locked here:
//   1. replace_symbol (and every other tool write) reaches onFileWrite with the content the sandbox has;
//   2. a write the call site records itself is reported once, not twice;
//   3. the platform's own starter files stay unrecorded, as before (they are not the build's work);
//   4. the route flushes before the save, and nothing in the dispatcher writes around the wrapper.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { recordingActuator } from '../src/server/AgentV3/recordedWrites';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
let n = 0;
const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: `t${++n}`, name, input });

class MemActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT ${p}`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

function setup() {
  const act = new MemActuator();
  const captured: Array<[string, string]> = [];
  const saved = new Map<string, string>(); // what the route's `writtenFiles` would hold
  const d = new ToolDispatcher(act, 'ws-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    (p, c) => { captured.push([p, c]); saved.set(p, c); });
  return { act, captured, saved, d };
}

const APP_V1 = `import './calculator.css';\n\nexport default function App() {\n  return <div className="calc">1</div>;\n}\n`;

describe('1 · replace_symbol reaches the saved project', () => {
  it('🔴 the report sequence: edit_file, then replace_symbol — the save holds what the sandbox runs', async () => {
    const { act, saved, d } = setup();
    act.files.set('src/App.tsx', APP_V1);
    await d.dispatch(call('edit_file', { path: 'src/App.tsx', old_string: '<div className="calc">1</div>', new_string: '<div className="calc">2</div>' }));
    expect(saved.get('src/App.tsx')).toContain('>2<');
    const r = await d.dispatch(call('replace_symbol', {
      path: 'src/App.tsx', symbol: 'App',
      code: 'export default function App() {\n  return <nav className="app-nav">Genesis 4 PDF</nav>;\n}',
    }));
    expect(r.is_error).toBe(false);
    expect(act.files.get('src/App.tsx')).toContain('Genesis 4 PDF');
    expect(saved.get('src/App.tsx')).toBe(act.files.get('src/App.tsx'));
  });

  it('a generator tool that writes without recording is recorded when the call ends', async () => {
    const { act, saved, d } = setup();
    act.files.set('package.json', JSON.stringify({ name: 'x', dependencies: { react: '^18.0.0' } }));
    await d.dispatch(call('generate_release_notes', { features: ['Calculator'], path: 'RELEASE_NOTES.md' }));
    expect(act.files.has('RELEASE_NOTES.md')).toBe(true);
    expect(saved.get('RELEASE_NOTES.md')).toBe(act.files.get('RELEASE_NOTES.md'));
  });
});

describe('2 · reported once', () => {
  it('🔒 write_file and edit_file are captured exactly once each', async () => {
    const { captured, d } = setup();
    await d.dispatch(call('write_file', { path: 'src/a.ts', content: 'export const a = 1;\n' }));
    await d.dispatch(call('edit_file', { path: 'src/a.ts', old_string: '= 1', new_string: '= 2' }));
    expect(captured.filter(([p]) => p === 'src/a.ts').map(([, c]) => c)).toEqual(['export const a = 1;\n', 'export const a = 2;\n']);
  });
  it('the wrapper forwards every other member and ignores other workspaces', async () => {
    const inner = new MemActuator();
    const seen: string[] = [];
    const w = recordingActuator(inner, 'ws-1', (p) => seen.push(p));
    await w.writeFile('ws-2', 'x.ts', '1');
    await w.writeFile('ws-1', 'y.ts', '2');
    expect(seen).toEqual(['y.ts']);
    expect(await w.listFiles()).toEqual(['x.ts', 'y.ts']);
    expect(await w.readFile('ws-1', 'y.ts')).toBe('2');
  });
  it('a write that throws is not recorded', async () => {
    const seen: string[] = [];
    const w = recordingActuator({ writeFile: async () => { throw new Error('refused'); } }, 'ws-1', (p) => seen.push(p));
    await expect(w.writeFile('ws-1', 'a.ts', '1')).rejects.toThrow('refused');
    expect(seen).toEqual([]);
  });
});

describe('3 · the structure that keeps it true', () => {
  const src = read('src/server/AgentV3/ToolDispatcher.ts');
  it('🔒 the dispatcher\'s actuator IS the recording wrapper, and the raw one writes only our starter', () => {
    expect(src).toMatch(/this\.actuator = recordingActuator\(actuatorRaw, workspaceId,/);
    expect(src.match(/_rawActuator\.writeFile\(/g)?.length).toBe(1);
    const at = src.indexOf('_rawActuator.writeFile(');
    expect(src.lastIndexOf('private async ensureViteScaffold', at)).toBeGreaterThan(src.lastIndexOf('private async ', at) - 1);
  });
  it('🔒 every tool call flushes, and the route flushes before the durable save', () => {
    expect(src).toMatch(/finally \{\s*this\.flushUnrecordedWrites\(\);/);
    const route = read('src/server/routes/agentv3.ts');
    // BOTH durable saves — the normal settle and the deadline finalizer — flush first.
    const saves = [...route.matchAll(/for \(const \[p, c\] of writtenFiles\) toSave\[p\] = c;/g)].map((m) => m.index!);
    expect(saves.length).toBe(2);
    for (const save of saves) {
      const before = route.slice(Math.max(0, save - 1500), save);
      expect(before).toMatch(/[dD]ispatcher(ForFlush\?)?\.flushUnrecordedWrites\(\)/);
    }
  });
});
