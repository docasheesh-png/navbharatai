// 🔴 Q-2946 (failedbr #2437, fe73bca3; admin decision 2026-11-19): the app was 100/100 READY at 525 s; the builder started
// optional palette work and the wallet stop ended the build at 537 s as "did not succeed". Now:
//   layer 1 — a fresh build judged READY by the done signal on a nearly-spent wallet runs no more tools: the next turn can
//             only be the summary, so the build ends through the ordinary success path;
//   layer 2 — any build (an edit too, where "ready" cannot be judged) is told once to finish and skip optional polish.
// No price or charge changes; the wallet stop stays the net. Reversion: drop either layer and its block fails.
import { describe, it, expect, afterEach } from 'vitest';
import { AgentRunner, FINISH_NOW_STEER, FINISH_NOW_REFUSAL, WALLET_NEARLY_SPENT_STEER } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}
const write = (i: number) => ({ content: [{ type: 'tool_use', id: `w${i}`, name: 'write_file', input: { path: `src/f${i}.ts`, content: `export const v${i} = ${i};\n` } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } });

function run(opts: { nearlySpent: boolean; editing: boolean }) {
  const seen: string[] = [];
  let i = 0;
  const client: MessagesCreateClient = { messages: { create: async (params: unknown) => {
    seen.push(JSON.stringify((params as { messages?: unknown }).messages ?? ''));
    return (i < 4 ? write(i++) : { content: [{ type: 'text', text: 'Summary: done.' }], stop_reason: 'end_turn' }) as never;
  } } };
  const actuator = new FakeActuator();
  const stream = new AgentEventStream();
  const state = new WorkspaceState(stream);
  const d = new ToolDispatcher(actuator, 'ws-2946', state, stream);
  (d as unknown as { assessBuildReadiness: () => Promise<unknown> }).assessBuildReadiness = async () => ({ ready: true, score: 100, blockers: [], warnings: [] });
  const runner = new AgentRunner({ client: new ClaudeClient(client), dispatcher: d, state, events: stream, model: 'test', system: 's', tools: defaultToolCatalog(), expectsArtifacts: true, editingExistingApp: opts.editing, finishWhenReady: () => opts.nearlySpent });
  return { result: runner.run('build'), seen: () => seen.join('\n'), files: () => actuator.files };
}

const ENV = { every: process.env.AGENTV3_DONE_SIGNAL_EVERY, min: process.env.AGENTV3_DONE_SIGNAL_MIN_STEP };
afterEach(() => { process.env.AGENTV3_DONE_SIGNAL_EVERY = ENV.every; process.env.AGENTV3_DONE_SIGNAL_MIN_STEP = ENV.min; });

describe('layer 1 — a READY fresh build on a nearly-spent wallet finishes', () => {
  it('after the done signal no more tools run, and the build ends ok', async () => {
    process.env.AGENTV3_DONE_SIGNAL_EVERY = '1'; process.env.AGENTV3_DONE_SIGNAL_MIN_STEP = '1';
    const r = run({ nearlySpent: true, editing: false });
    const out = await r.result;
    expect(r.seen()).toContain('[FINISH NOW]');
    expect(r.seen()).toContain('Not run — the app is ready');
    expect(r.files().size).toBeLessThan(4); // the later writes were refused
    expect(out.ok).toBe(true);
  });
  it('with headroom left, nothing changes', async () => {
    process.env.AGENTV3_DONE_SIGNAL_EVERY = '1'; process.env.AGENTV3_DONE_SIGNAL_MIN_STEP = '1';
    const r = run({ nearlySpent: false, editing: false });
    await r.result;
    expect(r.seen()).not.toContain('[FINISH NOW]');
    expect(r.seen()).not.toContain('[WALLET NEARLY SPENT]');
    expect(r.files().size).toBe(4);
  });
});

describe('layer 2 — any build is told once to finish and skip polish', () => {
  it('an EDIT (no done signal) still gets the instruction, once', async () => {
    const r = run({ nearlySpent: true, editing: true });
    await r.result;
    const all = r.seen();
    expect(all).toContain('[WALLET NEARLY SPENT]');
    expect(all).not.toContain('[FINISH NOW]');
  });
  it('the words', () => {
    expect(FINISH_NOW_STEER).toMatch(/Write your summary/);
    expect(FINISH_NOW_REFUSAL).toMatch(/^Not run/);
    expect(WALLET_NEARLY_SPENT_STEER).toMatch(/Do NOT start optional work/);
  });
});
