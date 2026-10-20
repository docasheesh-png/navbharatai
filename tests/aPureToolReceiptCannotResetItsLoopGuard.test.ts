import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import type { ToolUse, TurnRunner, TurnResult } from '../src/server/AgentV3/ClaudeClient';
import { ToolDispatcher, type ActuatorPort, type SubAgentSpawn } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { catalogForTools } from '../src/server/AgentV3/ToolCatalog';
import { PLAN_YOURSELF_NOTE, roleConfig } from '../src/server/AgentV3/AgentRegistry';

afterEach(() => vi.unstubAllEnvs());

class ReceiptSandbox implements ActuatorPort {
  files = new Map<string, string>();
  writes = 0;
  commands = 0;
  async readFile(_workspace: string, path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }
  async writeFile(_workspace: string, path: string, content: string): Promise<void> {
    this.writes++;
    this.files.set(path, content);
  }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { this.commands++; return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(): Promise<string> { return 'https://example.test'; }
}

const task = (role: string, i: number): ToolUse => ({ id: `task-${i}`, name: 'task', input: { role, instruction: 'Plan the work.' } });
const recipe = (input: Record<string, unknown>, i: number): ToolUse => ({ id: `recipe-${i}`, name: 'run_recipe', input });

async function runScript(script: ToolUse[][], options: {
  guardOff?: boolean;
  stopBeforeDispatch?: boolean;
  unknownReceipt?: boolean;
  unknownCounter?: boolean;
  workerWrites?: boolean;
} = {}) {
  vi.stubEnv('AGENTV3_DONE_SIGNAL', 'off');
  vi.stubEnv('AGENTV3_LOOP_GUARD', options.guardOff ? 'off' : 'on');
  const sandbox = new ReceiptSandbox();
  const events = new AgentEventStream();
  const state = new WorkspaceState(events);
  let spawned = 0;
  const spawn: SubAgentSpawn = async () => {
    spawned++;
    if (options.workerWrites) {
      const path = `src/worker-${spawned}.css`;
      await sandbox.writeFile('pure-tool-receipt', path, 'main { margin: 0; }');
      return { summary: 'Wrote the requested source.', written: [path] };
    }
    // A real worker can give this advice too. Its successful call is not the dispatcher's pure refusal.
    return { summary: PLAN_YOURSELF_NOTE, written: [] };
  };
  const dispatcher = new ToolDispatcher(sandbox, 'pure-tool-receipt', state, events, spawn);
  const initialChanges = dispatcher.changeCount();
  if (options.unknownCounter) vi.spyOn(dispatcher, 'changeCount').mockReturnValue(NaN);
  const receipts = new Map<string, Awaited<ReturnType<ToolDispatcher['dispatch']>>>();
  const originalDispatch = dispatcher.dispatch.bind(dispatcher);
  const dispatch = vi.spyOn(dispatcher, 'dispatch').mockImplementation(async (...args) => {
    const actual = await originalDispatch(...args);
    const result = options.unknownReceipt ? { ...actual, content: 'Unknown successful tool response.' } : actual;
    receipts.set(result.tool_use_id, result); // the deadline wrapper enters dispatch twice for non-task tools
    return result;
  });
  const abort = new AbortController();
  const messages: string[] = [];
  let modelCalls = 0;
  const client: TurnRunner = { runTurn: async (params): Promise<TurnResult> => {
    messages.push(JSON.stringify(params.messages));
    const tools = script[modelCalls++] ?? [];
    if (options.stopBeforeDispatch && modelCalls === 1) abort.abort();
    return {
      text: tools.length ? '' : 'Finished.', toolUses: tools,
      stopReason: tools.length ? 'tool_use' : 'end_turn', usage: { inputTokens: 20, outputTokens: 10 },
      rawContent: tools.length ? tools.map((tool) => ({ type: 'tool_use', ...tool })) : [{ type: 'text', text: 'Finished.' }],
    };
  } };
  const result = await new AgentRunner({
    client, dispatcher, state, events, model: 'test', system: 'Use the supplied tools.',
    tools: catalogForTools(roleConfig('architect').tools), maxSteps: 40, signal: abort.signal,
  }).run('Inspect the available tools.');
  return { result, sandbox, spawned, dispatcher, dispatch, receipts: [...receipts.values()], messages: messages.join('\n'), modelCalls, initialChanges };
}

const pureCalls = [
  ...['requirement', 'planner', 'product'].map((role) => ({ label: `planning role ${role}`, call: (i: number) => task(role, i) })),
  { label: 'recipe list', call: (i: number) => recipe({ name: 'list' }, i) },
  { label: 'unknown recipe catalog help', call: (i: number) => recipe({ name: 'not-a-real-recipe' }, i) },
  { label: 'empty recipe catalog help', call: (i: number) => recipe({}, i) },
  { label: 'required recipe input help', call: (i: number) => recipe({ name: 'generate_cache' }, i) },
];

describe('a successful pure tool receipt cannot create fresh loop epochs', () => {
  it.each(pureCalls)('$label reaches a bounded honest ending instead of resetting itself fifteen times', async ({ call }) => {
    const out = await runScript(Array.from({ length: 15 }, (_, i) => [call(i)]));
    expect(out.result.ok).toBe(false);
    expect(out.result.summary).toContain('steps that do nothing');
    expect(out.receipts).toHaveLength(8);
    expect(out.receipts.every((receipt) => receipt.is_error === false)).toBe(true);
    expect(out.messages).toContain('LOOP GUARD — FINAL');
    expect(out.messages).not.toContain('This call is banned for the rest');
    expect(out.messages).not.toContain('The published preview is already current');
    expect(out.initialChanges).toBe(0);
    expect(out.dispatcher.changeCount()).toBe(0);
    expect(out.sandbox.writes).toBe(0);
    expect(out.sandbox.commands).toBe(0);
    expect(out.spawned).toBe(0);
  });

  it.each([false, true])('a real worker remains useful, including advice without file writes (writes %s)', async (workerWrites) => {
    const out = await runScript(Array.from({ length: 12 }, (_, i) => [task('frontend', i)]), { workerWrites });
    expect(out.result.ok).toBe(true);
    expect(out.spawned).toBe(12);
    expect(out.receipts).toHaveLength(12);
    expect(out.messages).not.toContain('LOOP GUARD');
    if (workerWrites) expect(out.dispatcher.changeCount()).toBeGreaterThan(0);
  });

  it.each([
    { name: 'generate_datetime' }, // empty input is valid and actually runs this recipe
    { name: 'generate_cache', input: { provider: 'redis' } },
  ])('a valid recipe executes and keeps its mutation semantics: $name', async (input) => {
    const out = await runScript(Array.from({ length: 12 }, (_, i) => [recipe(input, i)]));
    expect(out.result.ok).toBe(true);
    expect(out.receipts).toHaveLength(12);
    expect(out.sandbox.writes).toBeGreaterThan(0);
    expect(out.dispatcher.changeCount()).toBeGreaterThan(0);
    expect(out.messages).not.toContain('LOOP GUARD');
  });

  it('a real change after FINAL resets its no-op ending even in a mixed turn', async () => {
    const out = await runScript([
      ...Array.from({ length: 7 }, (_, i) => [task('planner', i)]),
      [{ id: 'edit', name: 'write_file', input: { path: 'src/style.css', content: 'main { margin: 0; }' } }, task('planner', 7)],
      [task('planner', 8)], [task('planner', 9)],
    ]);
    expect(out.result.ok).toBe(true);
    expect(out.sandbox.files.get('src/style.css')).toContain('margin: 0');
    expect(out.receipts).toHaveLength(11);
    expect(out.result.summary).not.toContain('steps that do nothing');
  });

  it.each([
    { guardOff: true }, { unknownReceipt: true }, { unknownCounter: true },
  ])('an off guard or unknown receipt/change evidence stays conservative: %j', async (options) => {
    const out = await runScript(Array.from({ length: 12 }, (_, i) => [recipe({ name: 'list' }, i)]), options);
    expect(out.result.ok).toBe(true);
    expect(out.receipts).toHaveLength(12);
    expect(out.messages).not.toContain('LOOP GUARD');
  });

  it('Stop still prevents the queued planning call from being dispatched', async () => {
    const out = await runScript([[task('planner', 0)]], { stopBeforeDispatch: true });
    expect(out.dispatch).not.toHaveBeenCalled();
    expect(out.spawned).toBe(0);
    expect(out.sandbox.writes).toBe(0);
  });
});
