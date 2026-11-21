// failedbr #1275 (2026-11-20): "Create a block game" — the logic files were written, App.tsx never mounted them. The platform
// recorded RENDERED_ONLY_THE_STARTER; the model was told "Live preview published (port 5173 verified UP)" 22 times in a row
// and never learned that what it published was our starter page.
import { describe, expect, it } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { STARTER_ENTRY_CONTENT } from '../src/server/AgentV3/stillTheStarterApp';

class PreviewSandbox implements ActuatorPort {
  constructor(public files: Map<string, string>) {}
  async readFile(_w: string, path: string): Promise<string> {
    const v = this.files.get(path); if (v === undefined) throw new Error(`ENOENT: ${path}`); return v;
  }
  async writeFile(_w: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_w: string, command: string) { return { exitCode: 0, stdout: command.includes('nc -z') ? 'PORT_UP' : '', stderr: '' }; }
  async getPortUrl(_w: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

async function publish(app: string) {
  const events = new AgentEventStream();
  const d = new ToolDispatcher(new PreviewSandbox(new Map([['src/App.tsx', app], ['src/game/loop.ts', 'export const x = 1;']])), 'ws-starter-preview', new WorkspaceState(events), events);
  return String((await d.dispatch({ id: 'p1', name: 'update_preview', input: { port: 5173 } })).content);
}

describe('a preview of the starter page says so to the model (failedbr #1275)', () => {
  it('publishing the untouched starter names it', async () => {
    const r = await publish(STARTER_ENTRY_CONTENT);
    expect(r).toContain('Live preview published');
    expect(r).toMatch(/still the starter template/);
    expect(r).toMatch(/wire the entry to your app/);
  });
  it('publishing a wired app says nothing extra', async () => {
    const r = await publish("import { Game } from './game/Game';\nexport default function App() { return <Game />; }\n");
    expect(r).toContain('Live preview published');
    expect(r).not.toMatch(/starter template/);
  });
});
