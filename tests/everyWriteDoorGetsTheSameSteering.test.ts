// AUTOPSY 6bae5835 (2026-09-27) — the write-time accessibility/design note (autopsy 31dc61fd) reached
// ONE write door of four. The typecheck reached all four; the label nudge only `write_file`. So a
// label left out in an `edit_file`, `write_files_batch` or `replace_symbol` was never mentioned while
// the file was open, and the release gate found it after the app was proven green — when Green Freeze
// forbids the repair. One helper (`writeSteeringNotes`) now serves every door.

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: 't1', name, input });

const LABELLED = `export default function TasksPanel() {
  return (
    <form>
      <label htmlFor="task">Task</label>
      <input id="task" name="task" type="text" />
    </form>
  );
}
`;
const UNLABELLED_INPUT = '<input name="due" type="date" />';

describe('🔴 the label nudge reaches every write door, not only write_file', () => {
  let act: FakeActuator;
  let d: ToolDispatcher;
  beforeEach(() => {
    act = new FakeActuator();
    const stream = new AgentEventStream();
    d = new ToolDispatcher(act, 'ws-steer', new WorkspaceState(stream), stream);
  });

  it('write_file (the door that always had it)', async () => {
    const res = await d.dispatch(call('write_file', { path: 'src/components/TasksPanel.tsx', content: LABELLED.replace('</form>', `  ${UNLABELLED_INPUT}\n    </form>`) }), 'architect');
    expect(res.content).toMatch(/label/i);
  });

  it('edit_file — the dominant door on an edit build', async () => {
    act.files.set('src/components/TasksPanel.tsx', LABELLED);
    const clean = await d.dispatch(call('edit_file', { path: 'src/components/TasksPanel.tsx', old_string: 'type="text"', new_string: 'type="search"' }), 'architect');
    expect(clean.content).not.toMatch(/no label|aria-label/i);
    const res = await d.dispatch(call('edit_file', {
      path: 'src/components/TasksPanel.tsx',
      old_string: '    </form>',
      new_string: `      ${UNLABELLED_INPUT}\n    </form>`,
    }), 'architect');
    expect(res.content).toMatch(/Edited src\/components\/TasksPanel\.tsx/);
    expect(res.content).toMatch(/aria-label|<label/i);
  });

  it('write_files_batch — each file is judged on its own', async () => {
    const res = await d.dispatch(call('write_files_batch', { files: [
      { path: 'src/components/Good.tsx', content: LABELLED },
      { path: 'src/components/Bad.tsx', content: LABELLED.replace('</form>', `  ${UNLABELLED_INPUT}\n    </form>`) },
    ] }), 'architect');
    expect(res.content).toMatch(/Bad\.tsx/);
    expect(res.content).toMatch(/aria-label|<label/i);
  });
});
