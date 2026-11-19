// 🔴 Q-2916 (failedbr #2475, aba63ead): the explorer repair had 150 s and spent them on reads and then a `task` call — a
// fresh specialist with an empty context, still editing when the budget ended, so the pass was undone. A time-boxed
// repair the platform re-checks now has no delegation, and a WITHHELD tool is refused even if the model names it.
// Reversion: drop 'task' from DELEGATION_TOOLS, or the isWithheldTool check in AgentRunner, and this fails.
import { describe, it, expect } from 'vitest';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { ToolDispatcher, type ActuatorPort, type SubAgentSpawn } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog, taskToolDef } from '../src/server/AgentV3/ToolCatalog';

/** What the build's architect is offered — the catalog plus `task` (the shape the #2475 repair inherited). */
const architectTools = () => [...defaultToolCatalog(), taskToolDef()];
import { withoutPlatformCheckTools, isWithheldTool, REPAIR_WITHHELD_TOOLS } from '../src/server/AgentV3/repairScope';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}
const scripted = (m: unknown[]): MessagesCreateClient => { let i = 0; return { messages: { create: async () => (m[i++] ?? { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' }) as never } }; };
const delegateTurn = { content: [{ type: 'tool_use', id: 't1', name: 'task', input: { role: 'debugger', instruction: 'fix the covered buttons' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } };

function runWith(tools: ReturnType<typeof architectTools>, withheldTools?: ReadonlySet<string>) {
  let spawned = 0;
  const spawn: SubAgentSpawn = async () => { spawned++; return { ok: true, summary: 'ok', written: [] }; };
  const stream = new AgentEventStream();
  const state = new WorkspaceState(stream);
  const runner = new AgentRunner({
    client: new ClaudeClient(scripted([delegateTurn])),
    dispatcher: new ToolDispatcher(new FakeActuator(), 'ws-q2916', state, stream, spawn),
    state, events: stream, model: 'test', system: 'repair', tools, ...(withheldTools ? { withheldTools } : {}),
  });
  return { run: () => runner.run('2 buttons did not work'), spawned: () => spawned };
}

describe('a time-boxed, platform-checked repair does not delegate', () => {
  it("the repair's tool list has no `task`", () => {
    const names = withoutPlatformCheckTools(architectTools()).map((t) => t.name);
    expect(names).not.toContain('task');
    expect(names).not.toContain('screenshot');
    expect(names).toContain('edit_file');
  });

  it('a repair that names `task` anyway is refused, and no specialist is spawned', async () => {
    const r = runWith(withoutPlatformCheckTools(architectTools()), REPAIR_WITHHELD_TOOLS);
    await r.run();
    expect(r.spawned()).toBe(0);
  });

  it('a runner that IS offered `task` (the architect) still delegates', async () => {
    const r = runWith(architectTools());
    await r.run();
    expect(r.spawned()).toBe(1);
  });

  it('only a runner that DECLARES withheld tools refuses them — the architect is untouched', async () => {
    expect(isWithheldTool('task', REPAIR_WITHHELD_TOOLS, new Set(['edit_file']))).toBe(true);
    expect(isWithheldTool('task', REPAIR_WITHHELD_TOOLS, new Set(['task']))).toBe(false);
    expect(isWithheldTool('task', undefined, new Set(['edit_file']))).toBe(false);
    // A runner with no declaration that names `task` while it is not listed (the architect's dynamic toolset shape)
    // still delegates exactly as before.
    const r = runWith(defaultToolCatalog());
    await r.run();
    expect(r.spawned()).toBe(1);
  });

  it('all three platform-checked repairs in the route declare it', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect((src.match(/withoutPlatformCheckTools\(baseRunnerOpts\.tools\), withheldTools: REPAIR_WITHHELD_TOOLS/g) ?? []).length).toBe(3);
  });
});
