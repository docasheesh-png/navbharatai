// Autopsy 12c642ed (2026-09-30). The frontend sub-agent wrote App.tsx and was told its classes had no
// rules; it then rewrote src/index.css three times, and nothing re-asked the question after a stylesheet
// write — so 41 classes were still undefined at the end and cost a 184 s heal. A stylesheet write now
// re-checks every screen written this build and says what is STILL missing.
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_ws: string, p: string): Promise<string> {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT: ${p}`);
    return f;
  }
  async writeFile(_ws: string, p: string, content: string): Promise<void> { this.files.set(p, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}
const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: 't1', name, input });
const APP = 'export default function App() { return <div className="app-header"><span className="brand-icon" /><form className="filters-card" /></div>; }\n';

describe('a stylesheet write re-asks the question', () => {
  let act: FakeActuator;
  let d: ToolDispatcher;
  beforeEach(() => {
    act = new FakeActuator();
    act.files.set('src/index.css', 'body { margin: 0; }\n');
    const stream = new AgentEventStream();
    d = new ToolDispatcher(act, 'ws-css-recheck', new WorkspaceState(stream), stream);
  });

  it('🔴 a sheet that defines only some of them names the ones still missing', async () => {
    const first = await d.dispatch(call('write_file', { path: 'src/App.tsx', content: APP }), 'frontend');
    expect(first.content).toMatch(/\.app-header, \.brand-icon, \.filters-card[\s\S]*UNSTYLED/);
    const sheet = await d.dispatch(call('write_file', { path: 'src/index.css', content: 'body { margin: 0; }\n.app-header { display: flex; }\n' }), 'frontend');
    expect(sheet.content).toMatch(/src\/App\.tsx uses \.brand-icon, \.filters-card/);
    expect(sheet.content).not.toMatch(/\.app-header,/);
  });

  it('a sheet that defines all of them says nothing', async () => {
    await d.dispatch(call('write_file', { path: 'src/App.tsx', content: APP }), 'frontend');
    const sheet = await d.dispatch(call('write_file', { path: 'src/index.css', content: '.app-header{}\n.brand-icon{}\n.filters-card{}\n' }), 'frontend');
    expect(sheet.content).not.toMatch(/UNSTYLED/);
  });

  it('a sheet written before any screen says nothing', async () => {
    const sheet = await d.dispatch(call('write_file', { path: 'src/index.css', content: 'body{}\n' }), 'frontend');
    expect(sheet.content).not.toMatch(/UNSTYLED/);
  });
});
