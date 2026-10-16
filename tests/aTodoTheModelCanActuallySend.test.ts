/**
 * Q-1083 — a whole turn lost to a field we already knew.
 *
 * Build 7805e6d7 (session report 12ef62b2): `TOOL_ERROR — Tool call failed: update_todo: item 1 is
 * missing a title` (architect, 0 s). **Item ONE, not item zero**, which is the tell: the model sent a
 * complete first item and then, for the next one, sent what it was actually changing — an id and a
 * status. For a tool literally called `update_todo` that is a reasonable thing to send.
 *
 * The schema does say `required: ['id','title','status']`, so the call WAS malformed — that half is the
 * model's error and is not excused here. What is ours is the response: the entire call was thrown away,
 * and with it the turn, while the stored list ALREADY HELD that id's title. Rejecting a call whose
 * missing field we can look up is self-inflicted waste. The same build also lost six turns to
 * `update_todo` doing nothing else (Q-987's class, fixed separately by #3743's `todoOnlyTurn`).
 *
 * 🔒 EVERY BRANCH HERE CAN ONLY RESCUE A CALL THAT USED TO THROW. None changes a call that already
 * worked, and the honest throw stays for the one case that genuinely cannot be answered — a NEW id with
 * no title anywhere. That is what the second half of this file asserts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';

/** `update_todo` touches no file and runs no command, so the actuator is never reached. */
class NullActuator implements ActuatorPort {
  async readFile(): Promise<string> { throw new Error('ENOENT'); }
  async writeFile(): Promise<void> { /* nothing */ }
  async listFiles(): Promise<string[]> { return []; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

function dispatcherWith(todos: Array<{ id: string; title: string; status: string }>) {
  const stream = new AgentEventStream();
  const state = new WorkspaceState(stream);
  if (todos.length) state.setTodos(todos as never);
  const d = new ToolDispatcher(new NullActuator(), 'ws-q1083', state, stream);
  return { d, state };
}

/**
 * The real entry point, exactly as a model's turn reaches it.
 *
 * `dispatch` RETURNS the failure as text rather than throwing — that is how a tool error reaches the
 * model — so the assertions below read the returned string. Written first with `rejects.toThrow`, which
 * passed nothing and proved only that my helper was wrong.
 */
const run = async (d: ToolDispatcher, todos: unknown): Promise<string> => {
  const r = await d.dispatch({ id: 'call-1', name: 'update_todo', input: { todos } } as never);
  return r.content;
};

describe('🔴 the reported call now works, because the title was already on the list', () => {
  it('an item sent as id + status keeps its stored title', async () => {
    const { d, state } = dispatcherWith([
      { id: '1', title: 'Scaffold the editor', status: 'done' },
      { id: '2', title: 'Wire the timeline', status: 'pending' },
    ]);
    // Exactly the reported shape: item 0 complete, item 1 carrying only what changed.
    const out = await run(d, [
      { id: '1', title: 'Scaffold the editor', status: 'done' },
      { id: '2', status: 'in_progress' },
    ]);
    expect(out).toContain('Updated');
    const after = state.snapshot().todos;
    expect(after.find((t) => t.id === '2')?.title).toBe('Wire the timeline');
    expect(after.find((t) => t.id === '2')?.status).toBe('in_progress');
  });

  it('a bare string item is read as a title', async () => {
    const { d, state } = dispatcherWith([]);
    await run(d, ['Install ffmpeg', 'Wire the converter']);
    expect(state.snapshot().todos.map((t) => t.title)).toEqual(['Install ffmpeg', 'Wire the converter']);
  });

  it('a whitespace-only title is not a title, but a stored one still rescues it', async () => {
    const { d, state } = dispatcherWith([{ id: 'a', title: 'Real work', status: 'pending' }]);
    await run(d, [{ id: 'a', title: '   ', status: 'done' }]);
    expect(state.snapshot().todos.find((t) => t.id === 'a')?.title).toBe('Real work');
  });
});

describe('🔒 nothing that worked before behaves differently', () => {
  it('a complete list is unchanged', async () => {
    const { d, state } = dispatcherWith([]);
    await run(d, [
      { id: '1', title: 'One', status: 'pending' },
      { id: '2', title: 'Two', status: 'in_progress', owner: 'architect' },
    ]);
    const t = state.snapshot().todos;
    expect(t.map((x) => [x.id, x.title, x.status])).toEqual([['1', 'One', 'pending'], ['2', 'Two', 'in_progress']]);
    expect(t[1].owner).toBe('architect');
  });

  it('an unknown status still falls back to pending, and a non-array is still refused', async () => {
    const { d, state } = dispatcherWith([]);
    await run(d, [{ id: '1', title: 'One', status: 'nonsense' }]);
    expect(state.snapshot().todos[0].status).toBe('pending');
    expect(await run(d, 'not an array')).toMatch(/todos must be an array/);
  });

  it('🔴 the honest refusal STAYS for the one case nothing can answer — a new id with no title', async () => {
    const { d, state } = dispatcherWith([{ id: '1', title: 'Known', status: 'pending' }]);
    const msg = await run(d, [{ id: '99', status: 'done' }]);
    expect(msg).toMatch(/no title/);
    // …and the message is now actionable: it says what it looked for and could not find.
    expect(msg).toMatch(/is not one of the 1 todo\(s\) already on the list/);
    expect(msg).toMatch(/Send the title with it/);
    // The plan is untouched by a refused call — a half-applied list would be worse than a refusal.
    expect(state.snapshot().todos.map((t) => t.id)).toEqual(['1']);
  });

  it('the schema still REQUIRES the title — this rescues a malformed call, it does not bless one', () => {
    const catalog = readFileSync('src/server/AgentV3/ToolCatalog.ts', 'utf8');
    const decl = catalog.slice(catalog.indexOf("name: 'update_todo'"), catalog.indexOf("name: 'update_todo'") + 1200);
    expect(decl).toContain("required: ['id', 'title', 'status']");
  });

  it('the dispatcher hands the stored list in — without it the lookup cannot happen', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(src).toContain('parseTodos(input, this.state?.snapshot().todos ?? [])');
    // No second, private copy of the title rule.
    expect((src.match(/function titleOf\(/g) ?? []).length).toBe(1);
  });
});
