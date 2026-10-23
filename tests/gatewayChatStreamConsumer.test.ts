import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { consumeChatResponseStream, ChatStreamTerminalError } from '../src/lib/chatResponseStream';
const stream = (frames: string) => new Response(frames).body!;
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
describe('actual Free-chat consumer handles selected server error and EOF', () => {
  it('keeps the real early-admission unavailable notice and recognizes failure without DONE', async () => {
    const reply = 'The AI service is temporarily unavailable. Please try again later.';
    const result = await consumeChatResponseStream(stream(frame({ c: reply, error: reply, code: 'INFERENCE_GATEWAY_UNAVAILABLE' })), true, vi.fn());
    expect(result).toEqual({ text: reply, failure: { message: reply, code: 'INFERENCE_GATEWAY_UNAVAILABLE', partial: false } });
  });
  it('preserves partial text and the server interruption notice without treating EOF as success', async () => {
    const result = await consumeChatResponseStream(stream(frame({ c: 'A partial answer' }) + frame({ c: '\n\nThis reply was interrupted. Please retry when the service is available.' })
      + frame({ error: 'The selected AI route stopped.', code: 'INFERENCE_GATEWAY_INTERRUPTED', partial: true })), true, vi.fn());
    expect(result.text).toContain('A partial answer'); expect(result.text).toContain('interrupted'); expect(result.text).not.toContain('▋');
    expect(result.failure).toMatchObject({ code: 'INFERENCE_GATEWAY_INTERRUPTED', partial: true });
    expect(new ChatStreamTerminalError(result.failure!).message).toBe('The selected AI route stopped.');
  });
  it('stops immediately on a terminal error even if the server socket never closes', async () => {
    const cancel = vi.fn(); const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(frame({ error: 'Unavailable', code: 'INFERENCE_GATEWAY_UNAVAILABLE' }))); }, cancel });
    expect((await consumeChatResponseStream(body, true, vi.fn())).failure?.message).toBe('Unavailable'); expect(cancel).toHaveBeenCalledOnce();
  });
  it('handles split frames and keeps status out of the saved answer', async () => {
    const encoded = new TextEncoder().encode(frame({ s: 'Looking up sources' }) + frame({ c: 'Answer' }) + 'data: [DONE]\n\n');
    const body = new ReadableStream<Uint8Array>({ start(c) { for (const byte of encoded) c.enqueue(new Uint8Array([byte])); c.close(); } });
    expect(await consumeChatResponseStream(body, true, vi.fn())).toEqual({ text: 'Answer' });
  });
  it('recognizes the real code-plus-content gateway frame without an error property', async () => {
    const result = await consumeChatResponseStream(stream(frame({ c: 'Unavailable', code: 'INFERENCE_GATEWAY_UNAVAILABLE' })), true, vi.fn());
    expect(result).toEqual({ text: 'Unavailable', failure: { code: 'INFERENCE_GATEWAY_UNAVAILABLE', message: 'Unavailable', partial: false } });
  });
  it('does not report truncated SSE EOF as completed', async () => {
    const result = await consumeChatResponseStream(stream(frame({ c: 'Partial' })), true, vi.fn());
    expect(result.text).toBe('Partial'); expect(result.failure).toMatchObject({ code: 'STREAM_INTERRUPTED', partial: true });
  });
  it('preserves legacy plain text and successful SSE', async () => {
    expect(await consumeChatResponseStream(stream('legacy answer'), false, vi.fn())).toEqual({ text: 'legacy answer' });
    expect(await consumeChatResponseStream(stream(frame({ c: 'answer' }) + 'data: [DONE]\n\n'), true, vi.fn())).toEqual({ text: 'answer' });
  });
  it('the real hook uses this consumer, routes terminal failures before success, disables retry and always clears loading', () => {
    const code = readFileSync('src/hooks/useChatEngine.ts', 'utf8');
    expect(code).toContain('await consumeChatResponseStream(response.body, isSSE');
    expect(code.indexOf('if (streamed.failure) throw new ChatStreamTerminalError')).toBeLessThan(code.indexOf('AI Response received via'));
    expect(code).toMatch(/streamingMsgId !== null/);
    expect(code).toMatch(/error instanceof ChatStreamTerminalError[\s\S]*?return;[\s\S]*?finally \{\s*setIsLoadingForTab\(false\)/);
  });
});
