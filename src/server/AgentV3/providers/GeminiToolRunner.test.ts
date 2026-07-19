import { describe, it, expect, vi } from 'vitest';
import { GeminiToolRunner, type GeminiGenAiClient } from './GeminiToolRunner';
import type { ClaudeToolDef, RunTurnParams } from '../ClaudeClient';

const TOOLS: ClaudeToolDef[] = [
  { name: 'write_file', description: 'Write', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
];

function clientReturning(resp: unknown): { client: GeminiGenAiClient; gen: ReturnType<typeof vi.fn> } {
  const gen = vi.fn().mockResolvedValue(resp);
  return { client: { models: { generateContent: gen } } as unknown as GeminiGenAiClient, gen };
}

const params = (over: Partial<RunTurnParams> = {}): RunTurnParams => ({
  model: 'claude-sonnet-4-6',
  system: 'You build apps.',
  messages: [{ role: 'user', content: 'make a calculator' }],
  tools: TOOLS,
  ...over,
});

describe('GeminiToolRunner', () => {
  it('translates the request and parses a functionCall reply into a TurnResult', async () => {
    const { client, gen } = clientReturning({
      candidates: [{ content: { parts: [
        { text: 'creating' },
        { functionCall: { name: 'write_file', args: { path: 'index.html' } } },
      ] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8 },
    });
    const runner = new GeminiToolRunner(client, { model: 'gemini-2.5-flash' });
    const res = await runner.runTurn(params());

    const callArgs = gen.mock.calls[0][0];
    expect(callArgs.model).toBe('gemini-2.5-flash'); // option model wins over the Anthropic id
    expect(callArgs.config.systemInstruction).toBe('You build apps.');
    expect(callArgs.config.tools[0].functionDeclarations[0].name).toBe('write_file');
    expect(callArgs.contents[0]).toEqual({ role: 'user', parts: [{ text: 'make a calculator' }] });

    expect(res.stopReason).toBe('tool_use');
    expect(res.toolUses).toEqual([{ id: 'gemcall_0', name: 'write_file', input: { path: 'index.html' } }]);
    expect(res.usage.inputTokens).toBe(40);
  });

  it('handles a plain text turn and invokes onText', async () => {
    const { client } = clientReturning({ candidates: [{ content: { parts: [{ text: 'All set.' }] }, finishReason: 'STOP' }] });
    const onText = vi.fn();
    const res = await new GeminiToolRunner(client).runTurn(params({ onText }));
    expect(res.text).toBe('All set.');
    expect(res.stopReason).toBe('end_turn');
    expect(onText).toHaveBeenCalledWith('All set.');
  });

  it('omits tools/config.tools when the turn has none', async () => {
    const { client, gen } = clientReturning({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] });
    await new GeminiToolRunner(client).runTurn(params({ tools: undefined, system: undefined }));
    const cfg = gen.mock.calls[0][0].config;
    expect(cfg.tools).toBeUndefined();
    expect(cfg.systemInstruction).toBeUndefined();
  });

  it('falls back to params.model and propagates errors', async () => {
    const gen = vi.fn().mockRejectedValue(new Error('gemini 503'));
    const client = { models: { generateContent: gen } } as unknown as GeminiGenAiClient;
    await expect(new GeminiToolRunner(client).runTurn(params())).rejects.toThrow('gemini 503');
  });

  it('rejects when the call exceeds timeoutMs — a stalled Vertex/Gemini cannot block the build', async () => {
    const gen = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }));
    const client = { models: { generateContent: gen } } as unknown as GeminiGenAiClient;
    const runner = new GeminiToolRunner(client, { timeoutMs: 20 });
    await expect(runner.runTurn(params())).rejects.toThrow(/exceeded 20ms/);
  });

  it('timeoutMs:0 disables the bound (a fast call still returns normally)', async () => {
    const { client } = clientReturning({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] });
    const res = await new GeminiToolRunner(client, { timeoutMs: 0 }).runTurn(params());
    expect(res.text).toBe('ok');
  });

  it('uses the turn maxTokens else the option default', async () => {
    const { client, gen } = clientReturning({ candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }] });
    const runner = new GeminiToolRunner(client, { defaultMaxTokens: 4096 });
    await runner.runTurn(params({ maxTokens: 2222 }));
    expect(gen.mock.calls[0][0].config.maxOutputTokens).toBe(2222);
    await runner.runTurn(params({ maxTokens: undefined }));
    expect(gen.mock.calls[1][0].config.maxOutputTokens).toBe(4096);
  });
});
