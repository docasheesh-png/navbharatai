import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Doctor AI (SDA) "not responding" fix (admin 2026-07-30):
 *  A) the client surfaces the server's REAL reason (sign-in / paywall / busy) instead of a blanket
 *     "Service temporarily unavailable" that made every failure look like a dead chat;
 *  B) a free TEXT turn gains a direct-Gemini fallback (Gemini is in the free ladder) so it doesn't
 *     503 when GLM + Vertex are both down; and the honest error messages never leak internals.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const client = read('src/components/sda/SDAChat.tsx');
const route = read('src/server/routes/sda.ts');

describe('SDA client — honest, specific errors', () => {
  it('reads the server error body and maps status codes to real reasons', () => {
    expect(client).toContain('const errData = await res.json().catch');
    expect(client).toContain('res.status === 401');
    expect(client).toContain('res.status === 402');
    expect(client).toMatch(/Please sign in to use Doctor AI/);
    // The old blanket-on-every-failure throw is gone.
    expect(client).not.toContain("if (!res.ok) throw new Error('Service error');");
  });
});

describe('SDA server — free-tier reliability + safe messages', () => {
  it('a free text turn falls back to direct Gemini when the cheap chain is empty', () => {
    expect(route).toContain("!reply && sdaTier === 'free' && sdaGeminiKey && !isImage && !isPDF");
    expect(route).toContain('Free-tier Gemini fallback');
  });

  it('the 503/500 messages are on-brand and never leak internal key/error detail to the doctor', () => {
    expect(route).toContain('Doctor AI is busy right now — please try again in a moment.');
    expect(route).not.toContain("error: 'AI service unavailable. Please check API keys.'");
    expect(route).not.toContain('res.status(500).json({ error: err.message })');
  });
});
