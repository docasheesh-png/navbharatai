// BLD-5 / TD-7 / TD-19 — a tsc that did not finish is never "clean", and a file past the
// seed cap is still a node so its import is not a false unresolved.
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { _clearWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';

class TscThrows implements ActuatorPort {
  files = new Map<string, string>([
    ['tsconfig.json', '{}'],
    ['src/App.tsx', 'export default function App(){ return null }'],
  ]);
  async readFile(_w: string, p: string) {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT: ${p}`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand(_w: string, command: string) {
    if (command.includes('tsc')) throw new Error('tsc timed out');
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

class BigTree implements ActuatorPort {
  files = new Map<string, string>();
  constructor() {
    this.files.set('src/App.tsx', "import './f599';\nexport default function App(){ return null }\n");
    this.files.set('tsconfig.json', '{}');
    this.files.set('index.html', '<!doctype html><div id="root"></div>');
    for (let i = 0; i < 600; i++) this.files.set(`src/f${i}.ts`, `export const v${i} = ${i};\n`);
  }
  async readFile(_w: string, p: string) {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT: ${p}`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

describe('a tsc that did not finish is never clean', () => {
  beforeEach(() => _clearWorkspaceMemory());

  it('the typecheck tool says types are NOT verified when tsc throws, and never "type-checks clean"', async () => {
    const d = new ToolDispatcher(new TscThrows(), 'ws-tsc-timeout');
    const out = await d.dispatch({ id: 't', name: 'typecheck', input: {} });
    expect(out.content).toContain('types are NOT verified');
    expect(out.content).not.toContain('type-checks clean');
    expect(d.lastKnownTypeErrors()).toBeNull();
  });

  it('a file past the 500-read cap is still a node, so importing it is not unresolved', async () => {
    const d = new ToolDispatcher(new BigTree(), 'ws-seed-600');
    const report = await d.assessBuildReadiness();
    const hit = (report.blockers ?? []).filter((b) => /f599/.test(b) && /unresolved/i.test(b));
    expect(hit).toEqual([]);
    expect(report.unassessed).not.toBe(true);
  });
});
