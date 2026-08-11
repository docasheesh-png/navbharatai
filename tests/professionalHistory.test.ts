import { describe, it, expect, beforeEach } from 'vitest';
import { readProfessionalHistory } from '../src/components/professionals/ProfessionalHistoryView';
import { PROFESSIONAL_CHATS } from '../src/components/professionals/professionalConfigs';

// Professional conversations live ONLY in localStorage (`prof_<id>_messages`), not the Firestore
// chat_sessions the generic history reads — this is why the professional History needs its own source.
// vitest runs in a node env, so stub the localStorage the reader uses.
const store: Record<string, string> = {};
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};

const anyId = Object.keys(PROFESSIONAL_CHATS)[0];

describe('readProfessionalHistory — only the user\'s OWN professional chats, and only real ones', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  it('includes a professional the user actually chatted with (and previews the last message)', () => {
    store[`prof_${anyId}_messages`] = JSON.stringify([
      { role: 'assistant', content: 'welcome' },
      { role: 'user', content: 'my question' },
      { role: 'assistant', content: 'the answer' },
    ]);
    const h = readProfessionalHistory();
    expect(h.map((i) => i.id)).toContain(anyId);
    const item = h.find((i) => i.id === anyId)!;
    expect(item.turns).toBe(1);          // one USER message
    expect(item.preview).toBe('the answer');
    expect(item.name).toBe(PROFESSIONAL_CHATS[anyId].name);
  });

  it('EXCLUDES a welcome-only buffer — a greeting with no user message is not "history"', () => {
    store[`prof_${anyId}_messages`] = JSON.stringify([{ role: 'assistant', content: 'welcome' }]);
    expect(readProfessionalHistory().map((i) => i.id)).not.toContain(anyId);
  });

  it('returns nothing when the user has never opened a professional (no unrelated app/free history leaks in)', () => {
    expect(readProfessionalHistory()).toEqual([]);
  });

  it('ignores a corrupt buffer instead of throwing', () => {
    store[`prof_${anyId}_messages`] = '{not json';
    expect(() => readProfessionalHistory()).not.toThrow();
    expect(readProfessionalHistory()).toEqual([]);
  });
});
