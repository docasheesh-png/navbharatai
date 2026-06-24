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

  it('uses the turn maxTokens, else the option default', async () => {
    const { client, create } = clientReturning({ choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }] });
    const runner = new OpenAiToolRunner(client, { defaultMaxTokens: 4096 });
    await runner.runTurn(baseParams({ maxTokens: 1234 }));
    expect(create.mock.calls[0][0].max_tokens).toBe(1234);
    await runner.runTurn(baseParams({ maxTokens: undefined }));
    expect(create.mock.calls[1][0].max_tokens).toBe(4096);
  });
});
