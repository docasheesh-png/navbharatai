import { describe, it, expect, vi } from 'vitest';
import { OpenAiToolRunner, type OpenAiChatClient } from './OpenAiToolRunner';
import type { ClaudeToolDef, RunTurnParams } from '../ClaudeClient';

const TOOLS: ClaudeToolDef[] = [
  { name: 'write_file', description: 'Write', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
];

function clientReturning(completion: unknown): { client: OpenAiChatClient; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue(completion);
  return { client: { chat: { completions: { create } } } as unknown as OpenAiChatClient, create };
}

const baseParams = (over: Partial<RunTurnParams> = {}): RunTurnParams => ({
  model: 'claude-sonnet-4-6',
  system: 'You build apps.',
  messages: [{ role: 'user', content: 'make a calculator' }],
  tools: TOOLS,
  ...over,
});

describe('OpenAiToolRunner', () => {
  it('translates the request and parses a tool-call reply into a TurnResult', async () => {
    const { client, create } = clientReturning({
      choices: [{
        message: { role: 'assistant', content: 'creating', tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path":"index.js"}' } },
        ] },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    });
    const runner = new OpenAiToolRunner(client, { model: 'grok-4' });
    const res = await runner.runTurn(baseParams());

    // The provider's own model id is used, not the Anthropic model id.
    const callArgs = create.mock.calls[0][0];
    expect(callArgs.model).toBe('grok-4');
    expect(callArgs.tool_choice).toBe('auto');
    expect(callArgs.messages[0]).toEqual({ role: 'system', content: 'You build apps.' });
    expect(callArgs.tools[0].function.name).toBe('write_file');

    expect(res.stopReason).toBe('tool_use');
    expect(res.toolUses).toEqual([{ id: 'c1', name: 'write_file', input: { path: 'index.js' } }]);
    expect(res.usage).toEqual({ inputTokens: 50, outputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  });

  it('handles a plain text turn and invokes onText', async () => {
    const { client } = clientReturning({
      choices: [{ message: { role: 'assistant', content: 'All done.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });
    const onText = vi.fn();
    const runner = new OpenAiToolRunner(client);
    const res = await runner.runTurn(baseParams({ onText }));
    expect(res.text).toBe('All done.');
    expect(res.stopReason).toBe('end_turn');
    expect(onText).toHaveBeenCalledWith('All done.');
  });

  it('omits tools when the turn has none', async () => {
    const { client, create } = clientReturning({ choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] });
    const runner = new OpenAiToolRunner(client);
    await runner.runTurn(baseParams({ tools: undefined }));
    const callArgs = create.mock.calls[0][0];
    expect(callArgs.tools).toBeUndefined();
    expect(callArgs.tool_choice).toBeUndefined();
  });

  it('falls back to params.model when no option model is set, and propagates errors', async () => {
    const create = vi.fn().mockRejectedValue(new Error('grok 503'));
    const client = { chat: { completions: { create } } } as unknown as OpenAiChatClient;
    const runner = new OpenAiToolRunner(client);
    await expect(runner.runTurn(baseParams())).rejects.toThrow('grok 503');
  });

  it('does NOT send a thinking field by default (standard OpenAI providers like Grok)', async () => {
    const { client, create } = clientReturning({ choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }] });
    const runner = new OpenAiToolRunner(client, { model: 'grok-4' });
    await runner.runTurn(baseParams({ thinking: true }));
    expect(create.mock.calls[0][0].thinking).toBeUndefined();
  });

  it('with thinkingControl, forwards the turn thinking toggle to GLM (enabled/disabled)', async () => {
    const { client, create } = clientReturning({ choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }] });
    const runner = new OpenAiToolRunner(client, { model: 'glm-5.2', thinkingControl: true });
    await runner.runTurn(baseParams({ thinking: true }));
    expect(create.mock.calls[0][0].thinking).toEqual({ type: 'enabled' });
    await runner.runTurn(baseParams({ thinking: false }));
    expect(create.mock.calls[1][0].thinking).toEqual({ type: 'disabled' });
  });

  it('with thinkingControl but no thinking flag on the turn, sends no thinking field', async () => {
    const { client, create } = clientReturning({ choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }] });
    const runner = new OpenAiToolRunner(client, { model: 'glm-5.2', thinkingControl: true });
    await runner.runTurn(baseParams({ thinking: undefined }));
    expect(create.mock.calls[0][0].thinking).toBeUndefined();
  });

  it('uses the turn maxTokens, else the option default', async () => {
    const { client, create } = clientReturning({ choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }] });
    const runner = new OpenAiToolRunner(client, { defaultMaxTokens: 4096 });
    await runner.runTurn(baseParams({ maxTokens: 1234 }));
    expect(create.mock.calls[0][0].max_tokens).toBe(1234);
    await runner.runTurn(baseParams({ maxTokens: undefined }));
    expect(create.mock.calls[1][0].max_tokens).toBe(4096);
  });

  // A HUNG GLM/KIMI CALL CANNOT BLOCK THE BUILD ANYMORE (autopsy of build a487e019, 2026-08-18). This
  // runner serves GLM + Kimi — the cheap floor that LEADS every build — and had NO per-call timeout,
  // so one call ran 244 SECONDS returning 248 tokens and ate ~6 min of a 12-min build, invisible to the
  // "2 timeouts → bench" resilience because it never threw a timeout. Now it does, exactly like Gemini/Claude.
  describe('per-call timeout — the missing bound that let a call hang 244s', () => {
    const hanging = (): OpenAiChatClient => ({
      chat: { completions: { create: () => new Promise(() => { /* never settles — a stalled connection */ }) } },
    } as unknown as OpenAiChatClient);

    it('rejects when the call exceeds timeoutMs, so the orchestrator can fall through', async () => {
      const runner = new OpenAiToolRunner(hanging(), { timeoutMs: 20 });
      await expect(runner.runTurn(baseParams())).rejects.toThrow();
    });

    it('the rejection SAYS "timed out", so isTimeout benches a repeatedly-stalling provider', async () => {
      const runner = new OpenAiToolRunner(hanging(), { timeoutMs: 20 });
      await expect(runner.runTurn(baseParams())).rejects.toThrow(/timed out/i);
    });

    it('timeoutMs: 0 disables the bound (a fast call still returns normally)', async () => {
      const { client } = clientReturning({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] });
      const res = await new OpenAiToolRunner(client, { timeoutMs: 0 }).runTurn(baseParams());
      expect(res.text).toBe('ok');
    });

    it('a normal fast call is untouched (the default 120s bound never fires on real work)', async () => {
      const { client } = clientReturning({ choices: [{ message: { role: 'assistant', content: 'built it' }, finish_reason: 'stop' }] });
      const res = await new OpenAiToolRunner(client).runTurn(baseParams());
      expect(res.text).toBe('built it');
    });
  });
});
