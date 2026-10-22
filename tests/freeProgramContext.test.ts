import { describe, it, expect, afterEach, vi } from 'vitest';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';
import { visibleKnowledgeBase, freeProgramNoteFor, FREE_PROGRAM_PAUSED_NOTE, FREE_PROGRAM_FEATURE_IDS } from '../src/server/AppContext/freeProgramContext';
import { AppContextInjector } from '../src/server/AppContext/AppContextInjector';
import { setFreeProgramPausedHint } from '../src/server/lib/freeProgramHint';

// While the free program is paused no AI may describe it, and none may pretend it never mattered (admin 2026-10-22:
// "user ko lagna hi nahi chahiye ki koi free token system tha bhi").
afterEach(() => { vi.restoreAllMocks(); setFreeProgramPausedHint(null); });

describe('the knowledge base while paused', () => {
  it('hides exactly the free-program entries, and every id it names really exists', () => {
    for (const id of FREE_PROGRAM_FEATURE_IDS) expect(APP_KNOWLEDGE_BASE.some((f) => f.id === id), id).toBe(true);
    const shown = visibleKnowledgeBase(APP_KNOWLEDGE_BASE, true);
    expect(shown.some((f) => f.id === 'referral')).toBe(false);
    expect(shown.length).toBe(APP_KNOWLEDGE_BASE.length - FREE_PROGRAM_FEATURE_IDS.size);
  });
  it('shows everything when the program is live', () => {
    expect(visibleKnowledgeBase(APP_KNOWLEDGE_BASE, false)).toHaveLength(APP_KNOWLEDGE_BASE.length);
  });
});

describe('the standing note', () => {
  it('rides on messages about free things, English and Hinglish, only while paused', () => {
    for (const m of ['how do I get free tokens', 'referral code kahan hai', 'welcome bonus kab milega', 'mera free trial khatam kyun', 'muft token chahiye']) {
      expect(freeProgramNoteFor(m, true), m).toBe(FREE_PROGRAM_PAUSED_NOTE);
      expect(freeProgramNoteFor(m, false), m).toBe('');
    }
    expect(freeProgramNoteFor('make me a todo app', true)).toBe('');
  });
  it('tells the truth without naming a date, a refund or what was removed', () => {
    expect(FREE_PROGRAM_PAUSED_NOTE).toContain('Only Free Chat is free');
    expect(FREE_PROGRAM_PAUSED_NOTE).toMatch(/do not promise any refund, restoration or date/);
  });
});

describe('what the AIs are actually handed', () => {
  it('paused: a "free tokens" question gets the note and never the referral entry', () => {
    setFreeProgramPausedHint(true);
    const ctx = AppContextInjector.getRelevantContext('how do I earn free tokens with referral code?', 'pro_chat');
    expect(ctx).toContain(FREE_PROGRAM_PAUSED_NOTE);
    expect(ctx).not.toContain('Refer a Friend & free-credit rewards');
  });
  it('live: the referral entry is available again and there is no note', () => {
    setFreeProgramPausedHint(false);
    const ctx = AppContextInjector.getRelevantContext('how do I earn free tokens with referral code?', 'pro_chat');
    expect(ctx).not.toContain(FREE_PROGRAM_PAUSED_NOTE);
    expect(ctx).toContain('Refer a Friend');
  });
});
