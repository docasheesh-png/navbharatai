// A RUN THAT ONLY DOES NOTHING ENDS (autopsy d0b2fcd6, 2026-10-07, Q-738).
//
// After "[LOOP GUARD — FINAL] … banned for the rest of this build", the model sent SEVEN more empty `bash`
// calls (17 output tokens each — the provider really sent nothing), each one a full ~94 k-character turn,
// while the narration said "blocking it". Nothing could block a `bash` (a repeated `tsc` is a build
// converging, so `bash` is never refused). The run now ends honestly on the third no-op turn after FINAL.

import { describe, it, expect } from 'vitest';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { isEmptyCommandCall, isNoOpTurn, MAX_NO_OP_TURNS_AFTER_FINAL } from '../src/server/AgentV3/RepeatProbeGuard';

const use = { input_tokens: 5, output_tokens: 17 };
const emptyBash = (id: string) => ({ content: [{ type: 'tool_use', id, name: 'bash', input: { command: '' } }], stop_reason: 'tool_use', usage: use });
const realBash = (id: string) => ({ content: [{ type: 'tool_use', id, name: 'bash', input: { command: 'npx tsc --noEmit' } }], stop_reason: 'tool_use', usage: use });

function scripted(messages: unknown[], calls: { n: number }): MessagesCreateClient {
  return {
    messages: {
      create: async () => {
        const m = messages[calls.n] ?? { content: [{ type: 'text', text: 'end' }], stop_reason: 'end_turn', usage: use };
        calls.n++;
        return m as never;
      },
    },
  };
}

function run(script: unknown[], calls: { n: number }, narrations: string[]) {
  const dispatcher = {
    dispatch: async (tu: { id: string; input: { command?: string } }) => (tu.input?.command
      ? { tool_use_id: tu.id, content: 'exit=0', is_error: false }
      : { tool_use_id: tu.id, content: 'bash was called with an EMPTY command, so nothing ran — this is not a success.', is_error: true }),
  };
  const stream = new AgentEventStream();
  stream.on?.('event', (e: { type?: string; text?: string }) => { if (e?.type === 'narration' && e.text) narrations.push(e.text); });
  return new AgentRunner({
    client: new ClaudeClient(scripted(script, calls)), dispatcher: dispatcher as never, state: new WorkspaceState(stream), events: stream,
    model: 'm', system: 's', tools: defaultToolCatalog(),
  }).run('fix the preview');
}

describe('the pure checks', () => {
  it('an empty or missing command is a no-op; a real one is not', () => {
    expect(isEmptyCommandCall({ name: 'bash', input: { command: '' } })).toBe(true);
    expect(isEmptyCommandCall({ name: 'bash', input: { command: '   ' } })).toBe(true);
    expect(isEmptyCommandCall({ name: 'bash', input: {} })).toBe(true);
    expect(isEmptyCommandCall({ name: 'bash', input: { command: 'ls' } })).toBe(false);
    expect(isEmptyCommandCall({ name: 'read_file', input: {} })).toBe(false);
  });

  it('a turn is a no-op only when EVERY call in it is one', () => {
    const none = () => false;
    expect(isNoOpTurn([{ name: 'bash', input: { command: '' } }], none)).toBe(true);
    expect(isNoOpTurn([{ name: 'bash', input: { command: '' } }, { name: 'bash', input: { command: 'ls' } }], none)).toBe(false);
    expect(isNoOpTurn([], none)).toBe(false);
  });
});

describe('the runner', () => {
  it('🔒 THE REPORT: endless empty bash calls end the run soon after FINAL, honestly — not when the script runs out', async () => {
    const calls = { n: 0 };
    const narrations: string[] = [];
    const script = Array.from({ length: 40 }, (_, i) => emptyBash(`b${i}`));
    const result = await run(script, calls, narrations);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/kept sending steps that do nothing/);
    expect(calls.n).toBeLessThan(15);
    expect(MAX_NO_OP_TURNS_AFTER_FINAL).toBe(3);
  });

  it('a repeated REAL command (a build converging on tsc) is never ended by this rule', async () => {
    const calls = { n: 0 };
    const script = Array.from({ length: 12 }, (_, i) => realBash(`t${i}`));
    const result = await run(script, calls, []);
    expect(result.summary ?? '').not.toMatch(/kept sending steps that do nothing/);
    expect(calls.n).toBeGreaterThanOrEqual(12);
  });
});
