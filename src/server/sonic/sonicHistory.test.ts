import { describe, it, expect } from 'vitest';
import { normalizeSeededHistory } from './sonicHistory';

describe('normalizeSeededHistory — seeded voice history must NOT start on the assistant (admin real run 2026-07-14)', () => {
  it('THE bug: a chat that opens with an assistant welcome → leading assistant turn(s) dropped', () => {
    // Nova Sonic rejected this exact shape: "First message in chat history should not be Assistant."
    const out = normalizeSeededHistory([
      { role: 'assistant', content: 'Namaste, Doctor. I am SDA…' }, // the welcome — must be dropped
      { role: 'user', content: '45 year old male, fever 3 days' },
      { role: 'assistant', content: 'Any travel history or danger signs?' },
    ]);
    expect(out[0].role).toBe('user');
    expect(out.map((t) => t.role)).toEqual(['user', 'assistant']);
  });

  it('drops MULTIPLE leading assistant turns until the first user turn', () => {
    const out = normalizeSeededHistory([
      { role: 'assistant', content: 'welcome' },
      { role: 'assistant', content: 'still me' },
      { role: 'user', content: 'hello' },
    ]);
    expect(out).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('a history with NO user turn seeds NOTHING (never starts a session on the assistant)', () => {
    expect(normalizeSeededHistory([{ role: 'assistant', content: 'only me' }])).toEqual([]);
    expect(normalizeSeededHistory([])).toEqual([]);
    expect(normalizeSeededHistory(undefined)).toEqual([]);
    expect(normalizeSeededHistory(null)).toEqual([]);
  });

  it('drops empty/whitespace turns and caps to the last N', () => {
    const out = normalizeSeededHistory([
      { role: 'user', content: '  ' },                 // empty → dropped
      { role: 'user', content: 'first real' },
      { role: 'assistant', content: 'reply' },
    ]);
    expect(out).toEqual([{ role: 'user', content: 'first real' }, { role: 'assistant', content: 'reply' }]);

    const many = Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `m${i}` }));
    const capped = normalizeSeededHistory(many, 6);
    expect(capped.length).toBeLessThanOrEqual(6);
    expect(capped[0].role).toBe('user'); // still starts with user after capping
  });

  it('an already-clean user-first history is unchanged', () => {
    const h: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' },
    ];
    expect(normalizeSeededHistory(h)).toEqual(h);
  });
});
