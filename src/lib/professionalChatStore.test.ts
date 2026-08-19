import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  activeKey, archiveKey, endProfessionalChat, readActive, readArchive, hasRealExchange,
  resumeArchived, deleteArchived, MAX_ARCHIVED_PER_PROFESSIONAL, type KeyValueStore, type ProfMsg,
} from './professionalChatStore';

/** An in-memory store, optionally refusing writes over a byte budget (a full localStorage). */
function memStore(budget = Infinity): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      const others = [...data.entries()].filter(([key]) => key !== k).reduce((n, [, val]) => n + val.length, 0);
      if (others + v.length > budget) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k) => { data.delete(k); },
  };
}

const chat = (n: number): ProfMsg[] => [
  { role: 'assistant', content: 'Namaste! I am Lawyer AI.' },
  ...Array.from({ length: n }, (_, i) => ({ role: 'user' as const, content: `question ${i}` })),
];

describe('professionalChatStore — ✕ actually ends the conversation', () => {
  it('clears the live slot, so reopening the professional starts fresh', () => {
    const s = memStore();
    s.setItem(activeKey('lawyer_ai'), JSON.stringify(chat(2)));

    endProfessionalChat(s, 'lawyer_ai', 111);

    // THE BUG: ProfessionalChat restores from this exact key on mount. While it survived a ✕, the chat
    // came straight back on reopen — which is what "chat close nahi hota" actually was.
    expect(s.getItem(activeKey('lawyer_ai'))).toBeNull();
    expect(readActive(s, 'lawyer_ai')).toEqual([]);
  });

  it('ARCHIVES the transcript rather than deleting it — history is not collateral damage', () => {
    const s = memStore();
    const before = chat(2);
    s.setItem(activeKey('lawyer_ai'), JSON.stringify(before));

    expect(endProfessionalChat(s, 'lawyer_ai', 111)).toBe(true);

    const archived = readArchive(s, 'lawyer_ai');
    expect(archived).toHaveLength(1);
    expect(archived[0].endedAt).toBe(111);
    expect(archived[0].messages).toEqual(before);
  });

  it('does not archive a professional the user only looked at (greeting only)', () => {
    const s = memStore();
    s.setItem(activeKey('vastu_ai'), JSON.stringify([{ role: 'assistant', content: 'Namaste!' }]));

    expect(endProfessionalChat(s, 'vastu_ai', 5)).toBe(false);
    expect(readArchive(s, 'vastu_ai')).toEqual([]);
    expect(s.getItem(activeKey('vastu_ai'))).toBeNull(); // still closed
  });

  it('keeps the newest conversations and drops the oldest past the cap', () => {
    const s = memStore();
    for (let i = 1; i <= MAX_ARCHIVED_PER_PROFESSIONAL + 3; i++) {
      s.setItem(activeKey('teacher_ai'), JSON.stringify(chat(1)));
      endProfessionalChat(s, 'teacher_ai', i);
    }
    const archived = readArchive(s, 'teacher_ai');
    expect(archived).toHaveLength(MAX_ARCHIVED_PER_PROFESSIONAL);
    expect(archived[0].endedAt).toBe(MAX_ARCHIVED_PER_PROFESSIONAL + 3); // newest first
    expect(archived.some((c) => c.endedAt === 1)).toBe(false);
  });

  it('still closes when the browser cannot store the archive at all', () => {
    // The deliberate trade-off: a ✕ that refuses to close is the very complaint being fixed.
    const s = memStore(10); // room for nothing
    s.data.set(activeKey('kisan_ai'), JSON.stringify(chat(2))); // seed past the budget

    expect(endProfessionalChat(s, 'kisan_ai', 7)).toBe(false);
    expect(s.getItem(activeKey('kisan_ai'))).toBeNull();
  });

  it('survives corrupt storage instead of throwing into the close handler', () => {
    const s = memStore();
    s.setItem(activeKey('chef_ai'), '{not json');
    s.setItem(archiveKey('chef_ai'), 'also not json');

    expect(() => endProfessionalChat(s, 'chef_ai', 1)).not.toThrow();
    expect(readArchive(s, 'chef_ai')).toEqual([]);
  });
});

describe('professionalChatStore — reopening an ended conversation', () => {
  it('makes the clicked conversation live again', () => {
    const s = memStore();
    const first = chat(2);
    s.setItem(activeKey('finance_ai'), JSON.stringify(first));
    endProfessionalChat(s, 'finance_ai', 100);

    expect(resumeArchived(s, 'finance_ai', 100, 200)).toBe(true);
    expect(readActive(s, 'finance_ai')).toEqual(first);
    expect(readArchive(s, 'finance_ai').some((c) => c.endedAt === 100)).toBe(false);
  });

  it('parks the currently-live conversation instead of overwriting it', () => {
    const s = memStore();
    const old = chat(2);
    s.setItem(activeKey('finance_ai'), JSON.stringify(old));
    endProfessionalChat(s, 'finance_ai', 100);

    const current = chat(4);
    s.setItem(activeKey('finance_ai'), JSON.stringify(current));
    resumeArchived(s, 'finance_ai', 100, 200);

    expect(readActive(s, 'finance_ai')).toEqual(old);
    // The conversation that was live is NOT lost — it moved into the archive.
    expect(readArchive(s, 'finance_ai').find((c) => c.endedAt === 200)?.messages).toEqual(current);
  });

  it('reports honestly when the conversation is no longer there', () => {
    expect(resumeArchived(memStore(), 'finance_ai', 999)).toBe(false);
  });

  it('deletes exactly one ended conversation', () => {
    const s = memStore();
    for (const t of [1, 2, 3]) {
      s.setItem(activeKey('yoga_ai'), JSON.stringify(chat(1)));
      endProfessionalChat(s, 'yoga_ai', t);
    }
    deleteArchived(s, 'yoga_ai', 2);
    expect(readArchive(s, 'yoga_ai').map((c) => c.endedAt)).toEqual([3, 1]);
  });
});

describe('hasRealExchange', () => {
  it('needs a user message with actual text', () => {
    expect(hasRealExchange([{ role: 'assistant', content: 'hi' }])).toBe(false);
    expect(hasRealExchange([{ role: 'user', content: '   ' }])).toBe(false);
    expect(hasRealExchange([{ role: 'user', content: 'help me' }])).toBe(true);
  });
});

// ── The wiring guard ─────────────────────────────────────────────────────────
// The module above is only worth anything if App's ✕ actually calls it. It did not for ~70 of the
// professionals, which is the bug; a unit test of the helper alone would have passed the whole time.

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/** Comments describe the fix; only CODE proves it. (This guard has fired on its own prose before.) */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('App.closeTab ends professional chats by RULE, not per-professional branches', () => {
  const app = codeOnly(src('src/App.tsx'));

  it('imports and calls endProfessionalChat inside the close handler', () => {
    expect(app).toContain("from './lib/professionalChatStore'");
    expect(app).toMatch(/endProfessionalChat\(/);
  });

  it('decides by PROFESSIONAL_CHATS membership, so a new professional is covered on the day it ships', () => {
    const at = app.indexOf('const closeTab');
    expect(at).toBeGreaterThan(-1);
    const body = app.slice(at, app.indexOf('const scrollRef', at));
    expect(body).toMatch(/PROFESSIONAL_CHATS\[/);
    expect(body).toMatch(/endProfessionalChat\(/);
  });

  it('the chat and the history view read the key from the shared module, not their own string', () => {
    for (const f of ['src/components/professionals/ProfessionalChat.tsx', 'src/components/professionals/ProfessionalHistoryView.tsx']) {
      const body = codeOnly(src(f));
      expect(body).toContain('professionalChatStore');
      expect(body).not.toMatch(/`prof_\$\{[^}]+\}_messages`/);
    }
  });
});
