// failedbr #1326, #1322 (2026-11-20): Nemotron sent `update_todo` as { todos: "[{…}]" } — the array encoded a second time —
// and the tool answered "todos must be an array" seven times; 426 s and 347 s of model turns saved no plan.
import { describe, expect, it } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { withStructuredArguments } from '../src/server/AgentV3/toolArgumentShape';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

class MemActuator implements ActuatorPort {
  async readFile(): Promise<string> { throw new Error('ENOENT'); }
  async writeFile(): Promise<void> {}
  async listFiles(): Promise<string[]> { return []; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

const def = (n: string) => defaultToolCatalog().find((t) => t.name === n);

describe('a structured argument sent as JSON text is read as what it says', () => {
  it('update_todo with a stringified todos array saves the plan (the reported call)', async () => {
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const d = new ToolDispatcher(new MemActuator(), 'ws-todo', state, stream);
    const r = await d.dispatch({ id: 't1', name: 'update_todo', input: { todos: '[{"id":"1","title":"Project list","status":"in_progress"},{"id":"2","title":"BOQ sheet"}]' } });
    expect(r.is_error).toBeFalsy();
    expect(String(r.content)).toMatch(/Updated 2 todo/);
    expect(state.snapshot().todos.map((t) => t.title)).toEqual(['Project list', 'BOQ sheet']);
  });

  it('decodes only declared array/object arguments, and only into the declared shape', () => {
    const todo = def('update_todo');
    expect(withStructuredArguments({ todos: '[]' }, todo)).toEqual({ todos: [] });
    expect(withStructuredArguments({ todos: '{"a":1}' }, todo)).toEqual({ todos: '{"a":1}' }); // object is not the declared array
    expect(withStructuredArguments({ todos: '[not json' }, todo)).toEqual({ todos: '[not json' });
    const already = { todos: [{ id: '1', title: 'x' }] };
    expect(withStructuredArguments(already, todo)).toBe(already);
    // A string argument that happens to look like JSON (file content) is text and stays text.
    const write = { path: 'a.json', content: '["x"]' };
    expect(withStructuredArguments(write, def('write_file'))).toBe(write);
  });

  it('every catalog tool with an array or object argument is covered by the one door', () => {
    const covered = defaultToolCatalog().filter((t) => Object.values(t.input_schema.properties).some((p) => ['array', 'object'].includes(String((p as { type?: unknown }).type))));
    expect(covered.length).toBeGreaterThan(10);
    for (const t of covered) {
      const [key] = Object.entries(t.input_schema.properties).find(([, p]) => ['array', 'object'].includes(String((p as { type?: unknown }).type)))!;
      const shape = (t.input_schema.properties[key] as { type: string }).type;
      const out = withStructuredArguments({ [key]: shape === 'array' ? '[]' : '{}' }, t) as Record<string, unknown>;
      expect(typeof out[key], `${t.name}.${key}`).toBe('object');
    }
  });
});
