/**
 * failedbr #677 / #669 (queue Q-3223): "Now I'll dispatch three specialists…" was cut off at max_tokens with no tool
 * call, twice. Each spent an "act now" nudge, the run counted as built-nothing, and EMPTY_BUILD_RETRY threw away twelve
 * minutes of planning. A truncated announcement is continued with its own allowance; it is not a model that chose
 * not to act.
 */
import { describe, expect, it } from 'vitest';
import { AgentRunner, cutOffBeforeActing, CUT_OFF_STEER, MAX_CUT_OFF_CONTINUES } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

const cutOff = { content: [{ type: 'text', text: 'Now I\'ll dispatch three specialists: the designer will' }], stop_reason: 'max_tokens', usage: { input_tokens: 100, output_tokens: 8000 } };

function run(script: unknown[]) {
  let i = 0;
  const seen: unknown[] = [];
  const client: MessagesCreateClient = { messages: { create: async (req: unknown) => { seen.push(req); const m = script[i] ?? { content: [{ type: 'text', text: 'end' }], stop_reason: 'end_turn' }; i++; return m as never; } } };
  const actuator = new FakeActuator();
  const stream = new AgentEventStream();
  const state = new WorkspaceState(stream);
  const runner = new AgentRunner({
    client: new ClaudeClient(client), dispatcher: new ToolDispatcher(actuator, 'ws-q3223', state, stream), state, events: stream,
    model: 'test-model', system: 'You are the Architect.', tools: defaultToolCatalog(), expectsArtifacts: true,
  });
  return { runner, actuator, seen };
}

describe('a reply cut off before it acted is continued', () => {
  it('three cut-off announcements, then a write: the build lands (the old nudges alone ran out after two)', async () => {
    const { runner, actuator, seen } = run([
      cutOff, cutOff, cutOff,
      { content: [{ type: 'tool_use', id: 't1', name: 'write_file', input: { path: 'index.html', content: '<h1>Library</h1>' } }], stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 40 } },
      { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 5 } },
    ]);
    const result = await runner.run('Build a library attendance app');
    expect(actuator.files.get('index.html')).toBe('<h1>Library</h1>');
    expect(result.ok).toBe(true);
    expect(JSON.stringify(seen)).toContain('Your previous reply was cut off at the output limit');
  });

  it('the shape: words, no tool call, stopped by the limit — never an empty starved turn or a finished reply', () => {
    const base = { truncated: true, toolUses: 0, text: 'Now I will', starved: false, expectsArtifacts: true };
    expect(cutOffBeforeActing(base)).toBe(true);
    expect(cutOffBeforeActing({ ...base, truncated: false })).toBe(false);
    expect(cutOffBeforeActing({ ...base, toolUses: 1 })).toBe(false);
    expect(cutOffBeforeActing({ ...base, starved: true })).toBe(false);
    expect(cutOffBeforeActing({ ...base, text: '  ' })).toBe(false);
    expect(cutOffBeforeActing({ ...base, expectsArtifacts: false })).toBe(false);
    expect(MAX_CUT_OFF_CONTINUES).toBe(2);
    expect(CUT_OFF_STEER).toMatch(/Do NOT restate the plan/);
  });
});
