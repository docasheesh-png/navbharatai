import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  activeKey, archiveKey, conversationsKey, endProfessionalChat, endConversation, readArchive, hasRealExchange,
  resumeArchived, deleteArchived, deleteOpenConversation, readOpenConversations, readConversation, saveConversation,
  latestOpenConversationId, newConversationId, serverConversationId, legacyConversationId, isLegacyConversationId, archivedResumeId,
  MAX_ARCHIVED_PER_PROFESSIONAL, MAX_OPEN_PER_PROFESSIONAL, type KeyValueStore, type ProfMsg,
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

const chat = (n: number, tag = 'question'): ProfMsg[] => [
  { role: 'assistant', content: 'Namaste! I am Lawyer AI.' },
  ...Array.from({ length: n }, (_, i) => ({ role: 'user' as const, content: `${tag} ${i}` })),
];

describe('professionalChatStore — one professional, MANY conversations (admin 2026-09-21)', () => {
  it('two conversations of the same professional are stored side by side, never over each other', () => {
    const s = memStore();
    saveConversation(s, 'teacher_ai', 'c-A', chat(2, 'algebra'), 10);
    saveConversation(s, 'teacher_ai', 'c-B', chat(1, 'history'), 20);
    saveConversation(s, 'teacher_ai', 'c-A', chat(3, 'algebra'), 30);

    expect(readConversation(s, 'teacher_ai', 'c-A')).toEqual(chat(3, 'algebra'));
    expect(readConversation(s, 'teacher_ai', 'c-B')).toEqual(chat(1, 'history'));
    expect(readOpenConversations(s, 'teacher_ai').map((c) => c.id)).toEqual(['c-A', 'c-B']); // newest activity first
    expect(latestOpenConversationId(s, 'teacher_ai')).toBe('c-A');
    expect(readConversation(s, 'teacher_ai', 'nope')).toEqual([]);
    expect(latestOpenConversationId(s, 'chef_ai')).toBeNull();
  });

  it('a conversation id has the shape the server accepts, and the legacy one is never sent', () => {
    const id = newConversationId(1_700_000_000_000);
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(newConversationId()).not.toBe(newConversationId());
    expect(serverConversationId(id)).toBe(id);
    expect(serverConversationId(legacyConversationId('lawyer_ai'))).toBeUndefined();
    expect(isLegacyConversationId(legacyConversationId('lawyer_ai'))).toBe(true);
    expect(isLegacyConversationId(id)).toBe(false);
    // The legacy id is per PROFESSIONAL — two experts' pre-change chats are two windows, never one.
    expect(legacyConversationId('lawyer_ai')).not.toBe(legacyConversationId('teacher_ai'));
    // …and it can never pass the server's id shape, even if it leaked.
    expect(legacyConversationId('lawyer_ai')).not.toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('a chat that was live BEFORE this change is surfaced as the legacy conversation and migrated on its first save', () => {
    const s = memStore();
    const before = chat(2);
    s.setItem(activeKey('lawyer_ai'), JSON.stringify(before));

    const legacy = legacyConversationId('lawyer_ai');
    expect(readOpenConversations(s, 'lawyer_ai').map((c) => c.id)).toEqual([legacy]);
    expect(readConversation(s, 'lawyer_ai', legacy)).toEqual(before);

    saveConversation(s, 'lawyer_ai', legacy, chat(3), 50);
    expect(s.getItem(activeKey('lawyer_ai'))).toBeNull();                       // old key gone
    expect(s.getItem(conversationsKey('lawyer_ai'))).not.toBeNull();            // lives under the new one
    expect(readConversation(s, 'lawyer_ai', legacy)).toEqual(chat(3));
    // …and it is still ONE conversation, not a copy under each key.
    expect(readOpenConversations(s, 'lawyer_ai')).toHaveLength(1);
  });

  it('a newer conversation is "latest" over the legacy one, which sorts last', () => {
    const s = memStore();
    s.setItem(activeKey('lawyer_ai'), JSON.stringify(chat(2)));
    saveConversation(s, 'lawyer_ai', 'c-new', chat(1), 99);
    expect(latestOpenConversationId(s, 'lawyer_ai')).toBe('c-new');
    expect(readOpenConversations(s, 'lawyer_ai').map((c) => c.id)).toEqual(['c-new', legacyConversationId('lawyer_ai')]);
  });

  it('over the open cap, the oldest REAL conversation is archived and a welcome-only one is let go', () => {
    const s = memStore();
    saveConversation(s, 'chef_ai', 'glance', [{ role: 'assistant', content: 'hi' }], 1); // welcome only
    for (let i = 1; i <= MAX_OPEN_PER_PROFESSIONAL; i++) saveConversation(s, 'chef_ai', `c${i}`, chat(1), 10 + i);
    expect(readOpenConversations(s, 'chef_ai')).toHaveLength(MAX_OPEN_PER_PROFESSIONAL);
    expect(readOpenConversations(s, 'chef_ai').some((c) => c.id === 'glance')).toBe(false);
    expect(readArchive(s, 'chef_ai')).toEqual([]); // nothing real was pushed out yet

    saveConversation(s, 'chef_ai', 'c-extra', chat(1), 100);
    expect(readOpenConversations(s, 'chef_ai').some((c) => c.id === 'c1')).toBe(false);
    expect(readArchive(s, 'chef_ai')[0]).toMatchObject({ conversationId: 'c1', endedAt: 100 });
  });
});

describe('professionalChatStore — ✕ actually ends the conversation', () => {
  it('ends ONE conversation: archives it and removes it from the open ones; the others stay open', () => {
    const s = memStore();
    saveConversation(s, 'lawyer_ai', 'c-A', chat(2, 'A'), 1);
    saveConversation(s, 'lawyer_ai', 'c-B', chat(2, 'B'), 2);

    expect(endConversation(s, 'lawyer_ai', 'c-A', 111)).toBe(true);

    expect(readOpenConversations(s, 'lawyer_ai').map((c) => c.id)).toEqual(['c-B']);
    const archived = readArchive(s, 'lawyer_ai');
    expect(archived).toHaveLength(1);
    expect(archived[0]).toEqual({ endedAt: 111, conversationId: 'c-A', messages: chat(2, 'A') });
  });

  it('closing the PROFESSIONAL ends every open conversation it holds (what a parent-close means now)', () => {
    const s = memStore();
    saveConversation(s, 'lawyer_ai', 'c-A', chat(2, 'A'), 1);
    saveConversation(s, 'lawyer_ai', 'c-B', chat(2, 'B'), 2);
    s.setItem(activeKey('lawyer_ai'), JSON.stringify(chat(1, 'legacy')));

    expect(endProfessionalChat(s, 'lawyer_ai', 111)).toBe(true);

    expect(readOpenConversations(s, 'lawyer_ai')).toEqual([]);
    expect(s.getItem(activeKey('lawyer_ai'))).toBeNull();
    expect(readArchive(s, 'lawyer_ai')).toHaveLength(3);
  });

  it('a legacy conversation is archived WITHOUT a conversation id — resuming it starts a fresh one', () => {
    const s = memStore();
    s.setItem(activeKey('lawyer_ai'), JSON.stringify(chat(2)));
    endConversation(s, 'lawyer_ai', legacyConversationId('lawyer_ai'), 5);
    expect(readArchive(s, 'lawyer_ai')[0].conversationId).toBeUndefined();
    expect(s.getItem(activeKey('lawyer_ai'))).toBeNull();
  });

  it('does not archive a professional the user only looked at (greeting only)', () => {
    const s = memStore();
    saveConversation(s, 'vastu_ai', 'c-1', [{ role: 'assistant', content: 'Namaste!' }], 1);

    expect(endConversation(s, 'vastu_ai', 'c-1', 5)).toBe(false);
    expect(readArchive(s, 'vastu_ai')).toEqual([]);
    expect(readOpenConversations(s, 'vastu_ai')).toEqual([]); // still closed
  });

  it('keeps the newest ended conversations and drops the oldest past the cap', () => {
    const s = memStore();
    for (let i = 1; i <= MAX_ARCHIVED_PER_PROFESSIONAL + 3; i++) {
      saveConversation(s, 'teacher_ai', `c${i}`, chat(1), i);
      endConversation(s, 'teacher_ai', `c${i}`, i);
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

    expect(endConversation(s, 'kisan_ai', legacyConversationId('kisan_ai'), 7)).toBe(false);
    expect(s.getItem(activeKey('kisan_ai'))).toBeNull();
    expect(readOpenConversations(s, 'kisan_ai')).toEqual([]);
  });

  it('under quota pressure the conversation being TYPED IN is kept and the older real one is archived, not lost', () => {
    // A store whose OPEN list refuses to grow past one conversation (the archive key is unconstrained,
    // so the assertion is about the shedding ORDER, not about byte arithmetic).
    const oneOpen = JSON.stringify([{ id: 'c-old', messages: chat(3, 'old'), startedAt: 1, updatedAt: 1 }]).length + 8;
    const base = memStore();
    const s: KeyValueStore = {
      ...base,
      setItem: (k, v) => {
        if (k === conversationsKey('gk_ai') && v.length > oneOpen) throw new Error('QuotaExceededError');
        base.setItem(k, v);
      },
    };
    saveConversation(s, 'gk_ai', 'c-old', chat(3, 'old'), 1);
    saveConversation(s, 'gk_ai', 'c-now', chat(3, 'now'), 2);
    expect(readConversation(s, 'gk_ai', 'c-now')).toEqual(chat(3, 'now'));
    expect(readOpenConversations(s, 'gk_ai').some((c) => c.id === 'c-old')).toBe(false);
    expect(readArchive(s, 'gk_ai').some((c) => c.conversationId === 'c-old')).toBe(true);
  });

  it('survives corrupt storage instead of throwing into the close handler', () => {
    const s = memStore();
    s.setItem(activeKey('chef_ai'), '{not json');
    s.setItem(conversationsKey('chef_ai'), '[{"broken":');
    s.setItem(archiveKey('chef_ai'), 'also not json');

    expect(() => endProfessionalChat(s, 'chef_ai', 1)).not.toThrow();
    expect(readArchive(s, 'chef_ai')).toEqual([]);
    expect(readOpenConversations(s, 'chef_ai')).toEqual([]);
  });
});

describe('professionalChatStore — reopening an ended conversation', () => {
  it('makes the clicked conversation open again, under the SAME id it had (so its memory continues)', () => {
    const s = memStore();
    const first = chat(2);
    saveConversation(s, 'finance_ai', 'c-first', first, 1);
    endConversation(s, 'finance_ai', 'c-first', 100);

    expect(resumeArchived(s, 'finance_ai', 100, 200)).toBe('c-first');
    expect(readConversation(s, 'finance_ai', 'c-first')).toEqual(first);
    expect(readArchive(s, 'finance_ai').some((c) => c.endedAt === 100)).toBe(false);
  });

  it('a record archived before ids existed resumes under a FRESH id', () => {
    const s = memStore();
    s.setItem(archiveKey('finance_ai'), JSON.stringify([{ endedAt: 100, messages: chat(2) }]));
    const id = resumeArchived(s, 'finance_ai', 100, 200);
    expect(id).toMatch(/^c_/);
    expect(readConversation(s, 'finance_ai', id!)).toEqual(chat(2));
  });

  it('does NOT disturb the other open conversations — there is no single live slot to park any more', () => {
    const s = memStore();
    saveConversation(s, 'finance_ai', 'c-old', chat(2, 'old'), 1);
    endConversation(s, 'finance_ai', 'c-old', 100);
    saveConversation(s, 'finance_ai', 'c-current', chat(4, 'current'), 150);

    resumeArchived(s, 'finance_ai', 100, 200);

    expect(readOpenConversations(s, 'finance_ai').map((c) => c.id).sort()).toEqual(['c-current', 'c-old']);
    expect(readConversation(s, 'finance_ai', 'c-current')).toEqual(chat(4, 'current'));
    expect(readArchive(s, 'finance_ai')).toEqual([]);
  });

  it('reports honestly when the conversation is no longer there', () => {
    expect(resumeArchived(memStore(), 'finance_ai', 999)).toBeNull();
  });

  it('deletes exactly one ended conversation, and exactly one open one', () => {
    const s = memStore();
    for (const t of [1, 2, 3]) {
      saveConversation(s, 'yoga_ai', `c${t}`, chat(1), t);
      endConversation(s, 'yoga_ai', `c${t}`, t);
    }
    deleteArchived(s, 'yoga_ai', 2);
    expect(readArchive(s, 'yoga_ai').map((c) => c.endedAt)).toEqual([3, 1]);

    saveConversation(s, 'yoga_ai', 'open-1', chat(1), 10);
    saveConversation(s, 'yoga_ai', 'open-2', chat(1), 11);
    deleteOpenConversation(s, 'yoga_ai', 'open-1');
    expect(readOpenConversations(s, 'yoga_ai').map((c) => c.id)).toEqual(['open-2']);
    expect(readArchive(s, 'yoga_ai')).toHaveLength(2); // a delete never archives
  });
});

// ── THE REVIEW'S FINDINGS, each locked to its exact failure (2026-09-21, same day) ─────────────────
describe('the migrated legacy conversation survives everything its siblings do', () => {
  it('ending or deleting a SIBLING never drops the migrated legacy conversation, and closing the tab archives both', () => {
    const s = memStore();
    const legacy = legacyConversationId('teacher_ai');
    const before = chat(3, 'pre-upgrade');
    s.setItem(activeKey('teacher_ai'), JSON.stringify(before));
    saveConversation(s, 'teacher_ai', legacy, before, 1000);          // the window's mount effect migrates it
    saveConversation(s, 'teacher_ai', 'N1', chat(2, 'n1'), 2000);      // Mode picker → New chat

    expect(endConversation(s, 'teacher_ai', 'N1', 3000)).toBe(true);   // ✕ on N1's chip
    expect(readOpenConversations(s, 'teacher_ai').map((c) => c.id)).toEqual([legacy]);
    expect(readConversation(s, 'teacher_ai', legacy)).toEqual(before);

    deleteOpenConversation(s, 'teacher_ai', 'c_other');                // History delete / Clear on any sibling
    expect(readConversation(s, 'teacher_ai', legacy)).toEqual(before);

    expect(endConversation(s, 'teacher_ai', legacy, 4000)).toBe(true); // closing the tab
    expect(readArchive(s, 'teacher_ai')).toHaveLength(2);
    expect(readOpenConversations(s, 'teacher_ai')).toEqual([]);
  });

  it('a save of a DIFFERENT conversation carries the un-migrated legacy into the new key AND removes the old key', () => {
    const s = memStore();
    const legacy = legacyConversationId('teacher_ai');
    s.setItem(activeKey('teacher_ai'), JSON.stringify(chat(2, 'old')));
    saveConversation(s, 'teacher_ai', 'N1', [{ role: 'assistant', content: 'hi' }], 10);
    expect(s.getItem(activeKey('teacher_ai'))).toBeNull();
    expect(readOpenConversations(s, 'teacher_ai').map((c) => c.id)).toEqual(['N1', legacy]);
    expect(readOpenConversations(s, 'teacher_ai').filter((c) => isLegacyConversationId(c.id))).toHaveLength(1);
  });

  it('once the cap archives the legacy record it is NOT resurrected from the old key on every read and save', () => {
    const s = memStore();
    s.setItem(activeKey('teacher_ai'), JSON.stringify(chat(2, 'old')));
    s.setItem(archiveKey('teacher_ai'), JSON.stringify([{ endedAt: 5, conversationId: 'real-closed', messages: chat(1, 'closed') }]));
    for (let i = 1; i <= MAX_OPEN_PER_PROFESSIONAL + 1; i++) saveConversation(s, 'teacher_ai', `c${i}`, chat(1), 100 + i);
    const legacyArchived = readArchive(s, 'teacher_ai').filter((c) => c.conversationId === undefined || isLegacyConversationId(c.conversationId ?? ''));
    expect(legacyArchived).toHaveLength(1);
    expect(readOpenConversations(s, 'teacher_ai').some((c) => isLegacyConversationId(c.id))).toBe(false);
    const archiveBefore = readArchive(s, 'teacher_ai').length;
    for (let i = 0; i < 3; i++) saveConversation(s, 'teacher_ai', `c${MAX_OPEN_PER_PROFESSIONAL + 1}`, chat(2 + i), 500 + i);
    expect(readArchive(s, 'teacher_ai')).toHaveLength(archiveBefore);
    expect(readArchive(s, 'teacher_ai').some((c) => c.conversationId === 'real-closed')).toBe(true);
  });
});

describe('the archive id is unique, so one row never speaks for its sibling', () => {
  it('two windows of one expert closed in the SAME millisecond get distinct endedAt stamps', () => {
    const s = memStore();
    saveConversation(s, 'teacher_ai', 'W1', chat(2, 'w1'), 1);
    saveConversation(s, 'teacher_ai', 'W2', chat(2, 'w2'), 2);
    expect(endProfessionalChat(s, 'teacher_ai', 111)).toBe(true);
    const stamps = readArchive(s, 'teacher_ai').map((c) => c.endedAt);
    expect(new Set(stamps).size).toBe(2);
    const [a, b] = stamps;
    // Resuming ONE leaves the other in the archive; deleting ONE leaves the other too.
    expect(resumeArchived(s, 'teacher_ai', a, 200)).toBeTruthy();
    expect(readArchive(s, 'teacher_ai').map((c) => c.endedAt)).toEqual([b]);
    deleteArchived(s, 'teacher_ai', b);
    expect(readArchive(s, 'teacher_ai')).toEqual([]);
    expect(readOpenConversations(s, 'teacher_ai')).toHaveLength(1);
  });
});

describe('the window is decided BEFORE the archive is touched', () => {
  it('archivedResumeId peeks without writing, and resumeArchived honours the pre-decided id', () => {
    const s = memStore();
    saveConversation(s, 'teacher_ai', 'c-first', chat(2), 1);
    endConversation(s, 'teacher_ai', 'c-first', 100);
    const open = s.getItem(conversationsKey('teacher_ai'));
    const archive = s.getItem(archiveKey('teacher_ai'));
    expect(archivedResumeId(s, 'teacher_ai', 100)).toBe('c-first');
    expect(archivedResumeId(s, 'teacher_ai', 999)).toBeNull();
    expect(s.getItem(conversationsKey('teacher_ai'))).toBe(open);   // byte-identical: nothing moved
    expect(s.getItem(archiveKey('teacher_ai'))).toBe(archive);
    expect(resumeArchived(s, 'teacher_ai', 100, 200, 'c-first')).toBe('c-first');
    expect(readConversation(s, 'teacher_ai', 'c-first')).toEqual(chat(2));
  });

  it('a pre-id record peeks a FRESH id, and the same id is what the resume opens under', () => {
    const s = memStore();
    s.setItem(archiveKey('teacher_ai'), JSON.stringify([{ endedAt: 100, messages: chat(2) }]));
    const id = archivedResumeId(s, 'teacher_ai', 100, 5);
    expect(id).toMatch(/^c_/);
    expect(resumeArchived(s, 'teacher_ai', 100, 5, id)).toBe(id);
    expect(readConversation(s, 'teacher_ai', id!)).toEqual(chat(2));
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

  it('imports and calls endConversation inside the close handler', () => {
    expect(app).toContain("from './lib/professionalChatStore'");
    expect(app).toMatch(/endConversation\(/);
  });

  it('decides by PROFESSIONAL_CHATS membership, so a new professional is covered on the day it ships', () => {
    const at = app.indexOf('const closeTab');
    expect(at).toBeGreaterThan(-1);
    const body = app.slice(at, app.indexOf('const closeChatWindow', at));
    expect(body).toMatch(/PROFESSIONAL_CHATS\[/);
    // Every WINDOW of the closing expert is ended — and only the windows (2026-09-21), never every
    // stored conversation: one the user never closed must not be closed for them.
    expect(body).toContain('for (const w of windowsOf(openChats, v)) endConversation(store, v, w.id);');
    expect(body).not.toContain('endProfessionalChat(');
  });

  it('closing ONE window ends ONE conversation, and the last window closes the tab through closeTab', () => {
    const at = app.indexOf('const closeChatWindow');
    expect(at).toBeGreaterThan(-1);
    const body = app.slice(at, app.indexOf('const scrollRef', at));
    expect(body).toContain('endConversation(store, closed.professionalId, id)');
    expect(body).toContain('closeTab(undefined, closed.professionalId as ViewType)');
  });

  it('the chat and the history view read the key from the shared module, not their own string', () => {
    for (const f of ['src/components/professionals/ProfessionalChat.tsx', 'src/components/professionals/ProfessionalHistoryView.tsx']) {
      const body = codeOnly(src(f));
      expect(body).toContain('professionalChatStore');
      expect(body).not.toMatch(/`prof_\$\{[^}]+\}_messages`/);
      expect(body).not.toMatch(/`prof_\$\{[^}]+\}_conversations`/);
    }
  });

  it('the chat component never touches localStorage by key for its transcript — the store is the only door', () => {
    const body = codeOnly(src('src/components/professionals/ProfessionalChat.tsx'));
    expect(body).not.toContain('localStorage.getItem(storeKey)');
    expect(body).not.toContain('localStorage.setItem(storeKey');
    expect(body).toContain('saveConversation(');
    expect(body).toContain('readConversation(');
  });
});
