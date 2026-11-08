import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openedTranscript } from './chatHistory';
import { CHAT_CONTEXT_LIMITATION, compactConversationForModel, historyForModelRequest } from './chatContextWindow';
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
  it('keeps early facts and the latest turn from 100 messages without rewriting the stored transcript', () => {
    const messages = thread(100);
    const before = JSON.stringify(messages);
    const compact = compactConversationForModel(messages);
    expect(messages.length).toBeGreaterThan(100);
    expect(JSON.stringify(messages)).toBe(before);
    expect(compact.shortened).toBe(true);
    expect(compact.originalCount).toBe(messages.length);
    expect(compact.turns[0]).toMatchObject({ role: 'user', content: 'Remember that my city is Pune.' });
    expect(compact.turns.at(-1)?.content).toContain('What city did I name first?');
    expect(compact.turns.map(turn => turn.content).join('\n')).toContain(CHAT_CONTEXT_LIMITATION);
    expect(compact.turns.length).toBeLessThan(messages.length);
  });

  it('keeps that early fact when the same window is prepared again', () => {
    const payload = historyForModelRequest(thread(120));
    const again = historyForModelRequest(payload);
    expect(again.some(row => row.text.includes('Pune'))).toBe(true);
    expect(again.at(-1)?.text).toContain('What city did I name first?');
    expect(again.filter(row => row.text.includes(CHAT_CONTEXT_LIMITATION))).toHaveLength(1);
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
    const compact = compactConversationForModel(thread(100, huge));
    expect(compact.turns[0].content.startsWith('PINNED-FACT-PUNE')).toBe(true);
    expect(compact.turns[0].content.length).toBeLessThan(huge.length);
    expect(compact.turns.map(turn => turn.content).join('\n')).toContain('can omit details');
  });

  it('does not charge another answer credit or change the daily allowances', () => {
    const credits = { used: 1 };
    compactConversationForModel(thread(100));
    historyForModelRequest(thread(100));
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
