// Autopsy 33812996 (2026-09-30). The done check told the builder "the app is complete and healthy —
// 92/100, no blockers" at step 30, while the compile it had just run held type errors in Home.tsx. The
// builder then worked 28 more steps (1191 s). The readiness scan reads code, not the compiler; the
// compiler's own last word is now asked too.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';

class FakeActuator implements ActuatorPort {
  out = { exitCode: 0, stdout: '', stderr: '' };
  async readFile(): Promise<string> { throw new Error('ENOENT'); }
  async writeFile(): Promise<void> { /* nothing */ }
  async listFiles(): Promise<string[]> { return []; }
  async runCommand() { return this.out; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}
const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: 't1', name, input });

describe('the dispatcher remembers the latest compile, whoever ran it', () => {
  it('🔴 a piped shell tsc that exits 0 over real errors counts its errors', async () => {
    const act = new FakeActuator();
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(act, 'ws-done', new WorkspaceState(stream), stream);
    expect(d.lastKnownTypeErrors()).toBeNull();
    act.out = { exitCode: 0, stdout: "src/components/Home.tsx(87,29): error TS2345: Argument of type '\"MUSIC_RECOGNITION\"' is not assignable.\n", stderr: '' };
    await d.dispatch(call('bash', { command: './node_modules/.bin/tsc --noEmit 2>&1 | head -40' }), 'architect');
    expect(d.lastKnownTypeErrors()).toBe(1);
    act.out = { exitCode: 0, stdout: '', stderr: '' };
    await d.dispatch(call('bash', { command: './node_modules/.bin/tsc --noEmit' }), 'architect');
    expect(d.lastKnownTypeErrors()).toBe(0);
  });
  it('a compiler that never ran leaves the last verdict as it was', async () => {
    const act = new FakeActuator();
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(act, 'ws-done-2', new WorkspaceState(stream), stream);
    act.out = { exitCode: 0, stdout: '/bin/bash: line 1: .node_modules/.bin/tsc: No such file or directory\n', stderr: '' };
    await d.dispatch(call('bash', { command: '.node_modules/.bin/tsc --noEmit 2>&1 | head -40' }), 'architect');
    expect(d.lastKnownTypeErrors()).toBeNull();
  });
});

describe('the done check asks it', () => {
  it('the runner withholds "complete" while the latest compile has errors', () => {
    const runner = readFileSync(join(__dirname, '../src/server/AgentV3/AgentRunner.ts'), 'utf8');
    expect(runner).toContain('if (appIsDone(readiness) && !(typeErrors !== null && typeErrors > 0)) {');
  });
});
