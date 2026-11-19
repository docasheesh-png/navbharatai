// 🔴 failedbr #2431 (21d59838): `run_recipe` was called with generate_otp eight times, each 0 s, and nothing was written.
// `run_recipe` read only a nested `input` object, so the flat shape a model naturally writes — `{ name, provider }` —
// lost `provider`; the recipe answered "pass provider" and the model repeated itself. Arguments beside `name` now count.
// (The answer for a genuinely missing argument stays a non-error receipt: the do-nothing loop guard bounds a repeat of it
// — tests/aPureToolReceiptCannotResetItsLoopGuard.) Reversion: read only `input` again and this fails.
import { describe, it, expect } from 'vitest';
import { recipeArguments, ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

describe('recipeArguments', () => {
  it('a nested input wins; otherwise everything beside name', () => {
    expect(recipeArguments({ name: 'generate_otp', input: { provider: 'msg91' } })).toEqual({ provider: 'msg91' });
    expect(recipeArguments({ name: 'generate_otp', provider: 'msg91' })).toEqual({ provider: 'msg91' });
    expect(recipeArguments({ name: 'generate_datetime' })).toEqual({});
    expect(recipeArguments({ name: 'x', input: {} , provider: 'twilio' })).toEqual({ provider: 'twilio' });
  });
});

describe('end to end: the #2431 call shape runs the recipe', () => {
  it('run_recipe({ name: "generate_otp", provider: "msg91" }) writes the OTP route', async () => {
    const actuator = new FakeActuator();
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(actuator, 'ws-2431c', new WorkspaceState(stream), stream);
    const r = await (d as unknown as { dispatch: (c: { id: string; name: string; input: Record<string, unknown> }) => Promise<{ content: string; is_error: boolean }> })
      .dispatch({ id: 'r1', name: 'run_recipe', input: { name: 'generate_otp', provider: 'msg91' } });
    expect(r.is_error).toBe(false);
    expect(r.content).toMatch(/Wired msg91 phone-OTP/);
    expect(actuator.files.size).toBeGreaterThan(0);
  });
});
