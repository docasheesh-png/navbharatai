import { describe, it, expect } from 'vitest';
import { pickFreeChatResume, isFreeSession, RESUME_VISIBLE_MESSAGES } from '../src/lib/freeChatResume';
import type { LastPlace } from '../src/lib/lastPlace';

/**
 * Putting the Free chat's conversation back — with its OWN id.
 *
 * 🔴 The defect these exist to make impossible is not "the messages did not come back". It is that
 * App.tsx's save effect writes `messages: <whatever is on screen>` into the saved session, so
 * anything dropped while resuming is DELETED from the user's conversation the next time they type.
 */

const msg = (id: string, text = 'hello') => ({ id, text, sender: 'user', timestamp: '2026-01-01T00:00:00Z' }) as any;
const ai = (id: string, text = 'hi') => ({ id, text, sender: 'ai', timestamp: '2026-01-01T00:00:00Z' }) as any;

const session = (over: Record<string, any> = {}) => ({
  id: 's1', title: 'A chat', lastUpdated: '2026-01-02T00:00:00Z',
  messages: [msg('m1'), ai('m2')], agent: 'navbharatai', ...over,
}) as any;

const at = (view: string, sessionId?: string): LastPlace => ({ view, at: 1, ...(sessionId ? { sessionId } : {}) });

describe('isFreeSession — a negative test, deliberately', () => {
  it('a plain free session is free', () => {
    expect(isFreeSession(session())).toBe(true);
  });

  it('an UNRECOGNISED agent is still free — it is what the Free surface saved', () => {
    // A positive test for 'navbharatai' would make sessions from an older build silently vanish.
    expect(isFreeSession(session({ agent: 'some-old-agent-nobody-remembers' }))).toBe(true);
    expect(isFreeSession(session({ agent: undefined }))).toBe(true);
  });

  it('Pro, Doctor, v5.0 and legacy Vishwakarma sessions are NOT free', () => {
    expect(isFreeSession(session({ agent: 'navbharatai-pro' }))).toBe(false);
    expect(isFreeSession(session({ agent: 'sda' }))).toBe(false);
    expect(isFreeSession(session({ agent: 'agentv3' }))).toBe(false);
    expect(isFreeSession(session({ agent: 'vishwakarma_pro' }))).toBe(false);
    expect(isFreeSession(session({ id: 'v3_abc' }))).toBe(false);
    expect(isFreeSession(session({ meta: { tab: 'nbi_pro_chat' } }))).toBe(false);
  });

  it('reads the CURRENT agent first — a session that changed hands belongs to where it is now', () => {
    expect(isFreeSession(session({ currentAgent: 'navbharatai-pro', agent: 'navbharatai' }))).toBe(false);
  });
});

describe('pickFreeChatResume — which conversation, and how much of it', () => {
  it('nothing to resume means nothing changes', () => {
    expect(pickFreeChatResume([], null)).toBeNull();
    expect(pickFreeChatResume(null, null)).toBeNull();
    expect(pickFreeChatResume('not an array' as unknown, null)).toBeNull();
    expect(pickFreeChatResume([session({ agent: 'navbharatai-pro' })], null)).toBeNull();
  });

  it('resumes the newest free conversation when nothing was remembered', () => {
    const older = session({ id: 'old', lastUpdated: '2026-01-01T00:00:00Z' });
    const newer = session({ id: 'new', lastUpdated: '2026-02-01T00:00:00Z' });
    expect(pickFreeChatResume([older, newer], null)?.sessionId).toBe('new');
  });

  it('🔒 the REMEMBERED conversation beats the newest — another device syncing must not hijack it', () => {
    const older = session({ id: 'old', lastUpdated: '2026-01-01T00:00:00Z' });
    const newer = session({ id: 'new', lastUpdated: '2026-02-01T00:00:00Z' });
    expect(pickFreeChatResume([older, newer], at('nbi_chat', 'old'))?.sessionId).toBe('old');
  });

  it('a remembered place on ANOTHER surface does not steer the free chat', () => {
    const a = session({ id: 'a', lastUpdated: '2026-02-01T00:00:00Z' });
    const b = session({ id: 'b', lastUpdated: '2026-01-01T00:00:00Z' });
    expect(pickFreeChatResume([a, b], at('teacher_ai'))?.sessionId).toBe('a');
  });

  it('a remembered id that no longer exists falls back to the newest, never to nothing', () => {
    expect(pickFreeChatResume([session({ id: 'a' })], at('nbi_chat', 'deleted'))?.sessionId).toBe('a');
  });

  it('a conversation that never happened is not resumed into', () => {
    // Landing on a greeting that looks like a fresh chat, while the app quietly adopted an old
    // session's id, is worse than starting fresh.
    expect(pickFreeChatResume([session({ messages: [] })], null)).toBeNull();
    expect(pickFreeChatResume([session({ messages: [ai('welcome')] })], null)).toBeNull();
    expect(pickFreeChatResume([session({ messages: [ai('lang-picker')] })], null)).toBeNull();
    expect(pickFreeChatResume([session({ messages: [msg('m1', '   ')] })], null)).toBeNull();
  });

  it('a session with no id is skipped rather than resumed into nothing', () => {
    expect(pickFreeChatResume([session({ id: '' }), session({ id: 'ok' })], null)?.sessionId).toBe('ok');
  });
});

describe('🔴 what must NEVER be dropped', () => {
  it('EVERY live message comes back — dropping one deletes it from the saved conversation', () => {
    const many = Array.from({ length: 300 }, (_, i) => msg(`m${i}`, `turn ${i}`));
    const out = pickFreeChatResume([session({ messages: many })], null);
    expect(out?.messages).toHaveLength(300);
    expect(out?.messages[0]?.id).toBe('m0');
    expect(out?.messages[299]?.id).toBe('m299');
  });

  it('the already-collapsed older turns ARE trimmed — nothing rewrites that field', () => {
    const older = Array.from({ length: 100 }, (_, i) => msg(`old${i}`));
    const out = pickFreeChatResume([session({ restoredMessages: older, messages: [msg('live')] })], null);
    expect(out?.messages).toHaveLength(RESUME_VISIBLE_MESSAGES + 1);
    // the TAIL of the older turns, not the head — the context nearest the conversation
    expect(out?.messages[0]?.id).toBe(`old${100 - RESUME_VISIBLE_MESSAGES}`);
    expect(out?.messages.at(-1)?.id).toBe('live');
  });

  it('older turns come BEFORE the live ones, so the transcript reads in order', () => {
    const out = pickFreeChatResume(
      [session({ restoredMessages: [msg('older')], messages: [msg('newer')] })], null,
    );
    expect(out?.messages.map((m: any) => m.id)).toEqual(['older', 'newer']);
  });

  it('a malformed restoredMessages is ignored rather than crashing the first frame', () => {
    const out = pickFreeChatResume([session({ restoredMessages: 'nope', messages: [msg('a')] })], null);
    expect(out?.messages.map((m: any) => m.id)).toEqual(['a']);
  });

  it('a conversation whose only real content is in the OLDER half still resumes', () => {
    const out = pickFreeChatResume(
      [session({ restoredMessages: [msg('real')], messages: [ai('welcome')] })], null,
    );
    expect(out?.sessionId).toBe('s1');
  });
});
