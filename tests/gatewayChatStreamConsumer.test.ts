import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { consumeChatResponseStream, ChatStreamTerminalError, gatewayChatFailure } from '../src/lib/chatResponseStream';
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
  it.each(['FREE_ANSWER_DAILY_LIMIT', 'FREE_ANSWER_BUSY', 'FREE_ANSWER_DUPLICATE', 'FREE_ANSWER_ATTEMPT_LIMIT', 'FREE_ANSWER_UNAVAILABLE'])('does not relabel %s as shared overload', code => {
    const reply = 'The original quota or in-flight request notice.';
    expect(gatewayChatFailure({ code, reply })).toEqual({ code, message: reply, partial: false });
  });
  it('recognizes only explicit nonblank maintenance notices and bounds them', () => {
    expect(gatewayChatFailure({ maintenance: true, reply: 'Paused for maintenance' })).toEqual({ code: 'CHAT_MAINTENANCE', message: 'Paused for maintenance', partial: false });
    expect(gatewayChatFailure({ statusUnavailable: true, reply: "NavBharatAI is temporarily unable to respond. Please try again shortly.", maintenance: false })).toEqual({ code: 'CHAT_STATUS_UNAVAILABLE', message: "NavBharatAI is temporarily unable to respond. Please try again shortly.", partial: false });
    expect(gatewayChatFailure({ maintenance: true, reply: '   ', error: 'Recovery in progress' })?.message).toBe('Recovery in progress');
    expect(gatewayChatFailure({ maintenance: true, reply: 'a'.repeat(5000) })?.message).toHaveLength(2000);
    for (const value of [{ maintenance: 'true', reply: 'fake' }, { reply: 'maintenance' }, { maintenance: true }, { maintenance: true, reply: '  ', error: 123 }]) expect(gatewayChatFailure(value)).toBeUndefined();
  });

  it.each([true, false])('returns a terminal partial result when the body read rejects (SSE=%s)', async sse => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const update = vi.fn();
    const pending = consumeChatResponseStream(body, sse, update);
    controller.enqueue(new TextEncoder().encode(sse ? frame({ c: 'Partial answer' }) : 'Partial answer'));
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith('Partial answer'));
    controller.error(new TypeError('Synthetic reader failure'));
    expect(await pending).toEqual({ text: 'Partial answer', failure: {
      code: 'STREAM_INTERRUPTED', message: 'The connection ended before the reply was complete. Please retry when the service is available.', partial: true,
    } });
    expect(body.locked).toBe(false);
  });
  it('does not hide a consumer callback defect as a network interruption', async () => {
    const defect = new Error('Synthetic callback defect');
    await expect(consumeChatResponseStream(stream(frame({ c: 'Answer' })), true, () => { throw defect; })).rejects.toBe(defect);
  });

});
