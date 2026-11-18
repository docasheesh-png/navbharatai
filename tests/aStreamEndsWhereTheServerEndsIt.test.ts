// A STREAM ENDS WHERE THE SERVER ENDS IT (owner 2026-11-18, Test Chat Bot: "ab ye mitrify response band kar gaya" —
// HTTP 200, 3144 ms, MITRIFY_INCOMPLETE_STREAM).
//
// The CLASS: an SSE reader that only looks at events followed by a blank line. An event the server ends the stream with
// — `data: [DONE]` as the last bytes, or `[DONE]\n` — stayed unread in the buffer, and a stream that finishes with
// `finish_reason: "stop"` but no `[DONE]` was never accepted at all. Complete answers were reported as incomplete.
// Mitrify and Qubax (first in the live chat chain) carried the same reader; both now go through `sseFrames.ts`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMitrifyClient } from '../src/server/lib/mitrify';
import { takeSseEvents, chunkSaysStop } from '../src/server/lib/sseFrames';

const data = (o: unknown) => `data: ${JSON.stringify(o)}`;
const ANSWER = data({ choices: [{ index: 0, delta: { content: 'Hello' } }] });
const STOP = data({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });

async function mitrify(body: string): Promise<string> {
  vi.stubGlobal('fetch', async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  const client = createMitrifyClient({ MITRIFY_API_KEY: 'sk-test-key-123456', MITRIFY_BASE_URL: 'https://mitrify.com/v1', MITRIFY_MODEL: 'm' } as never, () => {});
  try {
    await client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: true } as never,
      { signal: new AbortController().signal, maxAttempts: 1, onChunk: async () => {} } as never);
    return 'ok';
  } catch (e) { return (e as { code?: string }).code ?? 'error'; }
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('1 · Mitrify accepts every normal way a stream ends', () => {
  const ok: Record<string, string> = {
    'the textbook ending': `${ANSWER}\n\n${STOP}\n\ndata: [DONE]\n\n`,
    '[DONE] as the very last bytes, no blank line': `${ANSWER}\n\n${STOP}\n\ndata: [DONE]`,
    '[DONE] followed by a single newline': `${ANSWER}\n\n${STOP}\n\ndata: [DONE]\n`,
    'finish_reason "stop" and no [DONE] at all': `${ANSWER}\n\n${STOP}\n\n`,
    'CRLF line endings': `${ANSWER}\r\n\r\n${STOP}\r\n\r\ndata: [DONE]`,
  };
  for (const [name, body] of Object.entries(ok)) it(name, async () => expect(await mitrify(body)).toBe('ok'));
});

describe('2 · a stream that was really cut off still fails', () => {
  it('content, then the connection closes — no stop, no [DONE]', async () => {
    expect(await mitrify(`${ANSWER}\n\n`)).toBe('MITRIFY_INCOMPLETE_STREAM');
    expect(await mitrify(ANSWER)).toBe('MITRIFY_INCOMPLETE_STREAM');
  });
});

describe('3 · the shared splitter', () => {
  it('holds back a partial event mid-stream and releases it at the end', () => {
    expect(takeSseEvents('data: a\n\ndata: b', false)).toEqual({ events: ['data: a'], rest: 'data: b' });
    expect(takeSseEvents('data: a\n\ndata: b', true)).toEqual({ events: ['data: a', 'data: b'], rest: '' });
    expect(takeSseEvents('data: a\n\n\n', true).events).toEqual(['data: a']);
  });
  it('recognises a normal finish', () => {
    expect(chunkSaysStop({ choices: [{ finish_reason: 'stop' }] })).toBe(true);
    expect(chunkSaysStop({ choices: [{ finish_reason: 'length' }] })).toBe(false);
    expect(chunkSaysStop(null)).toBe(false);
  });
});

describe('4 · CENSUS: the readers that had the defect use the shared splitter', () => {
  for (const file of ['src/server/lib/mitrify.ts', 'src/server/lib/qubax.ts']) {
    it(file, () => {
      const code = readFileSync(resolve(__dirname, '..', file), 'utf8');
      expect(code).toContain(file.endsWith('qubax.ts') ? 'takeSseEvents(pending, true)' : 'takeSseEvents(pending, item.done)');
      expect(code).not.toMatch(/indexOf\('\\n\\n'\)/);
    });
  }
});
