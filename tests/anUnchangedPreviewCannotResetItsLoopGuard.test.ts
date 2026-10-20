import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import {
  noteToolEffect, isNoEffectToolCall, newRepeatProbeState, noteMutations,
  collectRepeatProbeSteer, isProbeBanned, isNoOpTurn,
} from '../src/server/AgentV3/RepeatProbeGuard';

afterEach(() => vi.unstubAllEnvs());

class PreviewSandbox implements ActuatorPort {
  files = new Map<string, string>();
  commands: string[] = [];
  async readFile(_workspace: string, path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }
  async writeFile(_workspace: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_workspace: string, command: string) {
    this.commands.push(command);
    return { exitCode: 0, stdout: command.includes('nc -z') ? 'PORT_UP' : '', stderr: '' };
  }
  async getPortUrl(_workspace: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

const preview = (i: number, port = 5173) => ({ id: `preview-${i}`, name: 'update_preview', input: { port } });
const usage = { input_tokens: 30, output_tokens: 18 };

type ScriptTool = { id: string; name: string; input: Record<string, unknown> };

async function runPreviewScript(tools: (ScriptTool | ScriptTool[])[], options: { stopDuringFirst?: boolean } = {}) {
  vi.stubEnv('AGENTV3_DONE_SIGNAL', 'off');
  const actuator = new PreviewSandbox();
  const events = new AgentEventStream();
  const state = new WorkspaceState(events);
  const dispatcher = new ToolDispatcher(actuator, 'unchanged-preview-loop', state, events);
  const firstPublish = await dispatcher.dispatch(preview(-1));
  expect(firstPublish.is_error).toBe(false);
  expect(firstPublish.content).toContain('Live preview published');
  const dispatch = vi.spyOn(dispatcher, 'dispatch');
  const messages: unknown[][] = [];
  let calls = 0;
  const abort = new AbortController();
  const sdk: MessagesCreateClient = { messages: { create: async (request: unknown) => {
    messages.push(structuredClone((request as { messages: unknown[] }).messages));
    const tool = tools[calls++];
    if (options.stopDuringFirst && calls === 1) abort.abort();
    return tool
      ? { content: (Array.isArray(tool) ? tool : [tool]).map((t) => ({ type: 'tool_use', ...t })), stop_reason: 'tool_use', usage } as never
      : { content: [{ type: 'text', text: 'Finished.' }], stop_reason: 'end_turn', usage } as never;
  } } };
  const result = await new AgentRunner({ client: new ClaudeClient(sdk), dispatcher, state, events,
    model: 'test', system: 'Use the published preview.', tools: defaultToolCatalog(), maxSteps: 40,
    signal: abort.signal,
  }).run('Check the preview.');
  // ToolDispatcher re-enters dispatch once to bind the tool signal. Count the runner's calls,
  // not that internal signal wrapper, while still exercising the real dispatcher end to end.
  const runnerDispatches = dispatch.mock.calls.map((args, i) => ({ args, reply: dispatch.mock.results[i].value }))
    .filter(({ args }) => args[2]?.signal !== undefined);
  const replies = await Promise.all(runnerDispatches.map(({ reply }) => reply));
  return { result, dispatch, dispatcher, actuator, calls, messages, runnerDispatches, replies };
}

describe('the report\'s 26 already-published preview results do not buy fresh loop epochs', () => {
  it('the real dispatcher shortcut reaches FINAL and ends a run of unchanged calls before all26 can run', async () => {
    // 618b1c30 calls14,15,32..36,41,43..55,93,113,114,123,124:26 unchanged results;
    // calls43..55 alone were13 consecutive, while every call reset its own loop epoch.
    const out = await runPreviewScript(Array.from({ length: 26 }, (_, i) => preview(i)));
    expect(out.result.ok).toBe(false);
    expect(out.result.summary).toContain('steps that do nothing');
    expect(out.runnerDispatches).toHaveLength(8);
    expect(out.calls).toBeLessThan(13);
    expect(JSON.stringify(out.messages)).toContain('LOOP GUARD — FINAL');
    expect(JSON.stringify(out.messages)).not.toContain('This call is banned for the rest');
    expect(out.replies.every((reply) => reply.content.includes('already published and no file has changed'))).toBe(true);
  });

  it('a real edit after FINAL resets the epoch and its no-op ending; a needed preview in that same turn still runs', async () => {
    const edit = { id: 'source-edit', name: 'write_file', input: { path: 'src/style.css', content: 'main { margin: 0; }' } };
    const script: (ScriptTool | ScriptTool[])[] = [
      ...Array.from({ length: 7 }, (_, i) => preview(i)),
      [edit, preview(7)],
      preview(8), preview(9),
    ];
    const out = await runPreviewScript(script);
    expect(out.result.ok).toBe(true);
    expect(out.calls).toBe(script.length + 1);
    expect(out.actuator.files.get('src/style.css')).toBe('main { margin: 0; }');
    expect(out.replies.filter((reply) => reply.content.includes('Live preview published'))).toHaveLength(1);
    expect(out.result.summary).not.toContain('steps that do nothing');
  });

  it('an actual rebuild with no file diff remains useful, so26successful publish calls are not ended by this rule', async () => {
    vi.stubEnv('AGENTV3_SKIP_UNCHANGED_PREVIEW', 'off');
    const out = await runPreviewScript(Array.from({ length: 26 }, (_, i) => preview(i)));
    expect(out.result.ok).toBe(true);
    expect(out.runnerDispatches).toHaveLength(26);
    expect(out.replies.every((reply) => reply.content.includes('Live preview published'))).toBe(true);
    expect(JSON.stringify(out.messages)).not.toContain('LOOP GUARD — FINAL');
  });

  it('a newly requested port can still be published with the same source tree', async () => {
    const out = await runPreviewScript([preview(0, 3000), preview(1, 8080), preview(2, 5173)]);
    expect(out.replies.every((reply) => reply.content.includes('Live preview published'))).toBe(true);
    expect(out.result.ok).toBe(true);
  });

  it('Stop still prevents a queued preview from being dispatched or recorded as useful evidence', async () => {
    const out = await runPreviewScript([preview(0)], { stopDuringFirst: true });
    expect(out.dispatch).not.toHaveBeenCalled();
    expect(out.calls).toBe(1);
    expect(out.result.summary).not.toContain('steps that do nothing');
  });

  it('three or more real rebuilds in one model turn never receive an already-current steer', async () => {
    vi.stubEnv('AGENTV3_SKIP_UNCHANGED_PREVIEW', 'off');
    const out = await runPreviewScript(Array.from({ length: 4 }, (_, turn) =>
      Array.from({ length: 3 }, (_, n) => preview(turn * 3 + n))));
    expect(out.runnerDispatches).toHaveLength(12);
    expect(out.replies.every((reply) => reply.content.includes('Live preview published'))).toBe(true);
    expect(JSON.stringify(out.messages)).not.toContain('LOOP GUARD');
    expect(out.result.ok).toBe(true);
  });
});

describe('only an observed successful no-change receipt can lose its mutation semantics', () => {
  const unchanged = { is_error: false, content: 'The live preview on port 5173 is already published and no file has changed since — nothing to refresh. Do NOT call update_preview again until you change a file.' };

  it('all26exact receipts reach the repeat counter rather than26fresh epochs; previews are never banned', () => {
    const state = newRepeatProbeState();
    const nudges: number[] = [];
    for (let i = 0; i < 26; i++) {
      const call = preview(i);
      noteToolEffect(state, call, unchanged, 32, 32);
      noteMutations(state, [call]);
      if (collectRepeatProbeSteer(state, [call])) nudges.push(i + 1);
      expect(isProbeBanned(state, call.name, call.input)).toBe(false);
      expect(isNoOpTurn([call], () => false, (tu) => isNoEffectToolCall(state, tu))).toBe(true);
    }
    expect(state.mutations).toBe(0);
    expect(nudges).toEqual([3, 6, 12, 24]);
  });

  it.each([
    { before: null, after: null, result: unchanged },
    { before: NaN, after: NaN, result: unchanged },
    { before: 32, after: 33, result: unchanged },
    { before: 32, after: 32, result: { ...unchanged, is_error: true } },
    { before: 32, after: 32, result: { is_error: false, content: 'Live preview published after a managed server heal.' } },
    { before: 32, after: 32, result: { is_error: false, content: 'An unknown preview result.' } },
  ])('keeps rebuild/heal, failed and unknown evidence conservative: %j', ({ before, after, result }) => {
    const state = newRepeatProbeState();
    const call = preview(0);
    noteToolEffect(state, call, result, before, after);
    expect(isNoEffectToolCall(state, call)).toBe(false);
    noteMutations(state, [call]);
    expect(state.mutations).toBe(1);
    expect(isNoOpTurn([call], () => false, (tu) => isNoEffectToolCall(state, tu))).toBe(false);
    expect(collectRepeatProbeSteer(state, [call, call, call])).toBeNull(); // same-turn real/failed batch
  });

  it('a reused tool ID cannot retain stale no-effect evidence after a real publish or make another tool inert', () => {
    const state = newRepeatProbeState();
    const call = preview(0);
    noteToolEffect(state, call, unchanged, 32, 32);
    expect(isNoEffectToolCall(state, { ...call, name: 'write_file' })).toBe(false);
    noteToolEffect(state, call, { is_error: false, content: 'Live preview published.' }, 32, 32);
    expect(isNoEffectToolCall(state, call)).toBe(false);
  });

  it('a real mutation in a mixed turn invalidates already-current receipts before counting the new epoch', () => {
    const state = newRepeatProbeState();
    const previews = Array.from({ length: 6 }, (_, i) => preview(i));
    for (const call of previews) noteToolEffect(state, call, unchanged, 32, 32);
    const write = { id: 'write', name: 'write_file', input: { path: 'src/style.css' } };
    noteMutations(state, [...previews, write]);
    expect(state.mutations).toBe(1);
    expect(collectRepeatProbeSteer(state, [...previews, write])).toBeNull();
  });
});
