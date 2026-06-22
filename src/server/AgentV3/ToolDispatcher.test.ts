import { describe, it, expect, beforeEach } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from './ToolDispatcher';
import { defaultToolCatalog, CATALOG_TOOL_NAMES } from './ToolCatalog';
import { WorkspaceState } from './WorkspaceState';
import { AgentEventStream } from './AgentEventStream';
import type { ToolUse } from './ClaudeClient';
import type { AgentEvent } from './types';

/** An in-memory fake sandbox implementing just the ActuatorPort slice. */
class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  commands: string[] = [];
  commandResult = { exitCode: 0, stdout: '', stderr: '' };

  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async listFiles(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async runCommand(_ws: string, command: string) {
    this.commands.push(command);
    return this.commandResult;
  }
  async getPortUrl(_ws: string, port: number): Promise<string> {
    return `https://sandbox-${port}.example.dev`;
  }
}

function call(name: string, input: Record<string, unknown>, id = 't1'): ToolUse {
  return { id, name, input };
}

describe('ToolCatalog', () => {
  it('exposes exactly the documented tools with required schemas', () => {
    const catalog = defaultToolCatalog();
    expect(catalog.map((t) => t.name).sort()).toEqual([...CATALOG_TOOL_NAMES].sort());
    for (const tool of catalog) {
      expect(tool.input_schema.type).toBe('object');
      expect(typeof tool.description).toBe('string');
    }
  });
});

describe('ToolDispatcher', () => {
  let act: FakeActuator;
  let state: WorkspaceState;
  let stream: AgentEventStream;
  let events: AgentEvent[];
  let d: ToolDispatcher;

  beforeEach(() => {
    act = new FakeActuator();
    stream = new AgentEventStream();
    events = [];
    stream.subscribe((e) => events.push(e), false);
    state = new WorkspaceState(stream);
    d = new ToolDispatcher(act, 'ws-1', state, stream);
  });

  it('write_file creates a file, records the change, emits events', async () => {
    const res = await d.dispatch(call('write_file', { path: 'src/App.tsx', content: 'hello' }), 'frontend');
    expect(res.is_error).toBe(false);
    expect(act.files.get('src/App.tsx')).toBe('hello');
    expect(state.snapshot().files).toEqual([{ path: 'src/App.tsx', kind: 'create' }]);
    expect(events.find((e) => e.type === 'tool_call')).toBeTruthy();
    expect(events.find((e) => e.type === 'tool_result' && e.ok)).toBeTruthy();
    expect(events.find((e) => e.type === 'file_changed')).toBeTruthy();
  });

  it('write_file on an existing path records a modify', async () => {
    act.files.set('a.ts', 'old');
    await d.dispatch(call('write_file', { path: 'a.ts', content: 'new' }));
    expect(state.snapshot().files[0].kind).toBe('modify');
  });

  it('read_file returns contents', async () => {
    act.files.set('a.ts', 'CONTENT');
    const res = await d.dispatch(call('read_file', { path: 'a.ts' }));
    expect(res.content).toBe('CONTENT');
    expect(res.is_error).toBe(false);
  });

  it('read_file on a missing file returns an honest is_error (not a throw)', async () => {
    const res = await d.dispatch(call('read_file', { path: 'nope.ts' }));
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('Error:');
  });

  it('edit_file replaces a unique string and emits a diff', async () => {
    act.files.set('a.ts', 'const x = 1;\nconst y = 2;');
    const res = await d.dispatch(call('edit_file', { path: 'a.ts', old_string: 'const x = 1;', new_string: 'const x = 42;' }));
    expect(res.is_error).toBe(false);
    expect(act.files.get('a.ts')).toBe('const x = 42;\nconst y = 2;');
    expect(events.find((e) => e.type === 'diff')).toBeTruthy();
  });

  it('edit_file errors when old_string is not unique', async () => {
    act.files.set('a.ts', 'dup\ndup');
    const res = await d.dispatch(call('edit_file', { path: 'a.ts', old_string: 'dup', new_string: 'x' }));
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('not unique');
  });

  it('edit_file errors when old_string is absent', async () => {
    act.files.set('a.ts', 'abc');
    const res = await d.dispatch(call('edit_file', { path: 'a.ts', old_string: 'zzz', new_string: 'x' }));
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('not found');
  });

  it('bash runs the command and records terminal output', async () => {
    act.commandResult = { exitCode: 0, stdout: 'hello\n', stderr: '' };
    const res = await d.dispatch(call('bash', { command: 'echo hello' }));
    expect(act.commands).toContain('echo hello');
    expect(res.content).toContain('exit=0');
    expect(state.snapshot().terminalLines.length).toBe(1);
  });

  it('grep shells out with a quoted pattern', async () => {
    act.commandResult = { exitCode: 0, stdout: 'a.ts:1:foo', stderr: '' };
    const res = await d.dispatch(call('grep', { pattern: 'foo' }));
    expect(act.commands[0]).toContain('grep -rn');
    expect(res.content).toContain('foo');
  });

  it('glob matches workspace files by pattern', async () => {
    act.files.set('src/a.ts', '');
    act.files.set('src/b.tsx', '');
    act.files.set('readme.md', '');
    const res = await d.dispatch(call('glob', { pattern: 'src/**/*.ts' }));
    expect(res.content).toContain('src/a.ts');
    expect(res.content).not.toContain('readme.md');
  });

  it('update_todo replaces the todo list and emits todo_updated', async () => {
    const res = await d.dispatch(
      call('update_todo', { todos: [{ id: '1', title: 'scaffold', status: 'in_progress' }] }),
    );
    expect(res.is_error).toBe(false);
    expect(state.snapshot().todos).toEqual([{ id: '1', title: 'scaffold', status: 'in_progress' }]);
    expect(events.find((e) => e.type === 'todo_updated')).toBeTruthy();
  });

  it('update_preview resolves the sandbox URL and emits a preview event', async () => {
    const res = await d.dispatch(call('update_preview', { port: 5173 }));
    expect(res.is_error).toBe(false);
    expect(res.content).toContain('https://sandbox-5173.example.dev');
    const ev = events.find((e) => e.type === 'preview');
    expect(ev && ev.type === 'preview' && ev.url).toBe('https://sandbox-5173.example.dev');
  });

  it('update_preview errors honestly when the sandbox has no port mapping', async () => {
    const noPort = new ToolDispatcher(
      { readFile: act.readFile.bind(act), writeFile: act.writeFile.bind(act), listFiles: act.listFiles.bind(act), runCommand: act.runCommand.bind(act) },
      'ws-1',
      state,
      stream,
    );
    const res = await noPort.dispatch(call('update_preview', { port: 3000 }));
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('not available');
  });

  it('creates a real git checkpoint after a write when a checkpointer is wired', async () => {
    const checkpointer = {
      checkpoint: async (message: string) => ({ id: 'c1', sha: 'deadbeef', message, ts: 1 }),
    };
    const dWithGit = new ToolDispatcher(act, 'ws-1', state, stream, undefined, checkpointer);
    await dWithGit.dispatch(call('write_file', { path: 'a.ts', content: 'x' }));
    const checkpoints = state.snapshot().checkpoints;
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].sha).toBe('deadbeef');
  });

  it('unknown tool returns an honest error', async () => {
    const res = await d.dispatch(call('teleport', {}));
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('Unknown tool');
  });

  it('missing required arg returns an honest error', async () => {
    const res = await d.dispatch(call('write_file', { path: 'a.ts' })); // no content
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('content');
  });
});
