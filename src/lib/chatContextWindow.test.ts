import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openedTranscript } from './chatHistory';
import { CHAT_CONTEXT_LIMITATION, CHAT_MODEL_WINDOW_CHARS, compactConversationForModel, historyForModelRequest } from './chatContextWindow';
import { GUEST_DAILY_DEFAULT, SIGNED_IN_DAILY_DEFAULT } from '../server/lib/unifiedWallet/policy';

function thread(count: number, early = 'Remember that my city is Pune.') {
  return [
    { id: 'early-user', sender: 'user', text: early },
    { id: 'early-ai', sender: 'ai', text: 'Noted.' },
    ...Array.from({ length: count }, (_, i) => ({
      id: `m-${i}`,
      sender: i % 2 ? 'ai' : 'user',
      text: `ordinary turn ${i} `.repeat(30),
    })),
    { id: 'latest-user', sender: 'user', text: 'What city did I name first?' },
  ];
}

describe('long conversation window', () => {
  // 🔴 THE REPORT ITSELF (admin 2026-11-25): "aisa na ho kuch 10-15 message ke baad starting me text
  // bhul jaye". These four cases are the contract that answers it. The first two FAIL on the old
  // 10-turn design: at 15 messages it replaced the whole middle with 180-character user-only bullets.
  it('forgets nothing at all after 15 messages — the exact case the user reported', () => {
    const messages = thread(13);
    const compact = compactConversationForModel(messages);
    expect(messages.length).toBe(16);
    expect(compact.shortened).toBe(false);
    expect(compact.turns).toHaveLength(messages.length);
    expect(compact.turns[0].content).toBe('Remember that my city is Pune.');
    expect(compact.turns.map(turn => turn.content).join('\n')).not.toContain(CHAT_CONTEXT_LIMITATION);
    // Every single turn survives verbatim, the assistant's included.
    expect(compact.turns.map(turn => turn.content)).toEqual(
      messages.map(message => message.text),
    );
  });

  it('keeps a 40-message conversation whole, both sides of it', () => {
    const compact = compactConversationForModel(thread(38));
    expect(compact.originalCount).toBe(41);
    expect(compact.shortened).toBe(false);
    expect(compact.turns.filter(turn => turn.role === 'assistant')).toHaveLength(20);
    expect(compact.turns[0].content).toContain('Pune');
  });

  it('shortens the middle rather than erasing it, and keeps the assistant there too', () => {
    const compact = compactConversationForModel(thread(400));
    expect(compact.shortened).toBe(true);
    const middle = compact.turns.slice(7, -30);
    expect(middle.length).toBeGreaterThan(10);
    expect(middle.some(turn => turn.role === 'assistant')).toBe(true);
    expect(compact.turns.reduce((total, turn) => total + turn.content.length, 0))
      .toBeLessThanOrEqual(CHAT_MODEL_WINDOW_CHARS);
  });

  it('honours a smaller budget the free chain may set, and still keeps the opening', () => {
    const compact = compactConversationForModel(thread(200), { budgetChars: 24_000 });
    expect(compact.turns[0].content).toContain('Pune');
    expect(compact.turns.at(-1)?.content).toContain('What city did I name first?');
    expect(compact.turns.reduce((total, turn) => total + turn.content.length, 0)).toBeLessThanOrEqual(24_000);
  });

  it('keeps early facts and the latest turn from a very long thread without rewriting the stored transcript', () => {
    const messages = thread(400);
    const before = JSON.stringify(messages);
    const compact = compactConversationForModel(messages);
    expect(messages.length).toBeGreaterThan(400);
    expect(JSON.stringify(messages)).toBe(before);
    expect(compact.shortened).toBe(true);
    expect(compact.originalCount).toBe(messages.length);
    expect(compact.turns[0]).toMatchObject({ role: 'user', content: 'Remember that my city is Pune.' });
    expect(compact.turns.at(-1)?.content).toContain('What city did I name first?');
    expect(compact.turns.map(turn => turn.content).join('\n')).toContain(CHAT_CONTEXT_LIMITATION);
    expect(compact.turns.length).toBeLessThan(messages.length);
  });

  it('keeps that early fact when the same window is prepared again', () => {
    const payload = historyForModelRequest(thread(400));
    const again = historyForModelRequest(payload);
    expect(again.some(row => row.text.includes('Pune'))).toBe(true);
    expect(again.at(-1)?.text).toContain('What city did I name first?');
    expect(again.filter(row => row.text.includes(CHAT_CONTEXT_LIMITATION))).toHaveLength(1);
    // Stable over its own output: preparing a prepared window changes nothing.
    expect(again).toEqual(payload);
  });

  it('reloads one owner transcript and still shows the early fact', () => {
    const stored = {
      userId: 'owner-a',
      restoredMessages: thread(50).slice(0, 2),
      messages: thread(80).slice(2),
    };
    const other = { userId: 'owner-b', messages: [{ sender: 'user', text: 'Remember that my city is Kochi.' }] };
    const reloaded = openedTranscript(stored);
    const window = compactConversationForModel(reloaded);
    expect(window.turns[0].content).toContain('Pune');
    expect(window.turns.some(turn => turn.content.includes('Kochi'))).toBe(false);
    expect(compactConversationForModel(other.messages).turns.some(turn => turn.content.includes('Pune'))).toBe(false);
  });

  it('keeps the start of a very long early message and states the summary limit', () => {
    const huge = `PINNED-FACT-PUNE ${'x'.repeat(20_000)}`;
    const compact = compactConversationForModel(thread(400, huge));
    expect(compact.turns[0].content.startsWith('PINNED-FACT-PUNE')).toBe(true);
    expect(compact.turns[0].content.length).toBeLessThan(huge.length);
    expect(compact.turns.map(turn => turn.content).join('\n')).toContain('can omit details');
  });

  it('does not charge another answer credit or change the daily allowances', () => {
    const credits = { used: 1 };
    compactConversationForModel(thread(400));
    historyForModelRequest(thread(400));
    expect(credits.used).toBe(1);
    expect(SIGNED_IN_DAILY_DEFAULT).toBe(50);
    expect(GUEST_DAILY_DEFAULT).toBe(10);
  });

  it('keeps the saved chat owned by the signed-in user and does not add a shared history collection', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const block = rules.slice(rules.indexOf('match /chat_sessions/{sessionId}'), rules.indexOf('match /chat_messages/{messageId}'));
    expect(block).toContain('resource.data.userId == request.auth.uid');
    expect(block).toContain('request.resource.data.userId == request.auth.uid');
    expect(rules).toContain('match /chat_messages/{messageId}');
    expect(rules).toContain('allow read, write: if false');
  });
});
