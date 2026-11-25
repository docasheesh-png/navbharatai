import { routeMiddlewareArguments } from './helpers/routeRegistration';
// Forensic audit 2026-10-04 (P1) — a free AI request is bounded before any provider is called.
//
// Free chat and the security scan took unbounded input from signed-in callers who are charged nothing:
// a multi-megabyte prompt overflowed the free model onto PAID rungs, a list of PDFs went to paid vision,
// and the scan sent the whole project (up to 30 MB) to one grounded model call with no rate limit.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  checkChatInput, CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_ATTACHMENTS, CHAT_MAX_VISION_ATTACHMENTS, CHAT_MAX_HISTORY_TURNS, CHAT_MAX_HISTORY_TURN_CHARS,
  CHAT_MAX_HISTORY_CHARS,
} from '../src/server/lib/chatInputLimits';
import { filesForAiReview, SCAN_AI_MAX_CHARS } from '../src/server/routes/audit';

describe('free chat input', () => {
  it('a real conversation passes untouched (what the app itself sends)', () => {
    const history = Array.from({ length: 40 }, (_, i) => ({ sender: i % 2 ? 'ai' : 'user', text: 'x'.repeat(2000) }));
    const r = checkChatInput({ message: 'hello', fileAttachments: [{ name: 'a.png', type: 'image/png', base64: '' }], history });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.history).toEqual(history);
  });

  it('an oversized message is refused with a 413 and an honest reason', () => {
    const r = checkChatInput({ message: 'x'.repeat(CHAT_MAX_MESSAGE_CHARS + 1), fileAttachments: [], history: [] });
    expect(r).toMatchObject({ ok: false, status: 413 });
  });

  it('too many attachments, or too many images/PDFs, are refused', () => {
    const many = Array.from({ length: CHAT_MAX_ATTACHMENTS + 1 }, () => ({ name: 'a.txt', type: 'text/plain', base64: '' }));
    expect(checkChatInput({ message: 'x', fileAttachments: many, history: [] }).ok).toBe(false);
    const pdfs = Array.from({ length: CHAT_MAX_VISION_ATTACHMENTS + 1 }, () => ({ name: 'a.pdf', type: 'application/pdf', base64: '' }));
    expect(checkChatInput({ message: 'x', fileAttachments: pdfs, history: [] }).ok).toBe(false);
  });

  it('a padded history is trimmed, never refused, and the worst case is the CHARACTER bound', () => {
    const history = Array.from({ length: 500 }, () => ({ sender: 'user', text: 'y'.repeat(50_000) }));
    const r = checkChatInput({ message: 'x', fileAttachments: [], history });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Each turn is still clipped, and the whole history is bounded by characters — which is what a
      // provider charges for. 500 × 50,000 used to arrive as 60 × 4,000 = 240,000 characters; the same
      // input now arrives as at most 120,000, so the bound this file exists for is twice as tight.
      expect((r.history[0] as { text: string }).text.length).toBe(CHAT_MAX_HISTORY_TURN_CHARS);
      const chars = r.history.reduce((total, m) => total + String((m as { text?: unknown }).text ?? '').length, 0);
      expect(chars).toBeLessThanOrEqual(CHAT_MAX_HISTORY_CHARS);
      expect(r.history.length).toBeLessThanOrEqual(CHAT_MAX_HISTORY_TURNS);
    }
  });

  it('a real long conversation of short turns is kept, not cut at its oldest end', () => {
    // 🔴 THE REPORTED BUG, at the request bound (admin 2026-11-25): 150 ordinary turns cost a fraction
    // of the bound above, and the old 60-turn cap still threw the first 90 of them away — the opening of
    // the conversation, which is exactly the part the user expects to be remembered.
    const history = Array.from({ length: 150 }, (_, i) => ({ sender: i % 2 ? 'ai' : 'user', text: `turn ${i}` }));
    const r = checkChatInput({ message: 'what did I say first?', fileAttachments: [], history });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.history).toHaveLength(150);
      expect((r.history[0] as { text: string }).text).toBe('turn 0');
    }
  });

  it('the chat handler checks BEFORE any extraction or provider call', () => {
    const src = readFileSync('src/server/routes/chat.ts', 'utf8');
    const check = src.indexOf('checkChatInput({ message, fileAttachments, history })');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(src.indexOf('buildDocumentContext(textAttachments)'));
  });
});

describe('security scan', () => {
  it('the AI review reads within its budget and counts what it left out', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 50; i++) big[`f${i}.ts`] = 'z'.repeat(10_000);
    const r = filesForAiReview(big);
    const used = Object.entries(r.files).reduce((n, [p, c]) => n + p.length + c.length, 0);
    expect(used).toBeLessThanOrEqual(SCAN_AI_MAX_CHARS);
    expect(r.omitted).toBeGreaterThan(0);
    expect(Object.keys(r.files).length + r.omitted).toBe(50);
  });

  it('the route is rate-limited and the prompt reads the bounded set', () => {
    const src = readFileSync('src/server/routes/audit.ts', 'utf8');
    const args = routeMiddlewareArguments(src, '/api/security/scan');
    const limiter = args.indexOf('scanLimiter');
    expect(limiter).toBeGreaterThanOrEqual(0);
    expect(limiter).toBeLessThan(args.length - 1);
    expect(args.at(-1)).toMatch(/^async\s*\(/);
    expect(src).not.toMatch(/JSON\.stringify\(fileMap\)/);
  });
});
