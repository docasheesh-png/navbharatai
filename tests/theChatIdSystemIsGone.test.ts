/**
 * ADMIN 2026-09-28: "chat id wala system hata kar, baki ai me jo system hota hai, wahi wala yaha bana
 * do! history me jaisa (chatgpt, claude, grok) karte hai, waise hi navbharatai ka ui/ux ho. yeh chat id
 * wala system band karo."
 *
 * The user report that started it (build 134, 2026-09-25): "when we close the app and reopen it, it
 * doesn't show, and when we tried to search it asks chat id. Also who remembers chat id to search, also
 * chat id doesn't show."
 *
 * What this locks:
 *   1 · the rules (lib/chatHistory.ts) — empty chats, device + cloud merge, the transcript as it was;
 *   2 · the behaviour of opening and starting a chat (useSessionManager, called for real);
 *   3 · the chat-ID system is gone from every surface, and the History actions exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const getDocMock = vi.fn();
vi.mock('../src/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ col, id }),
  getDoc: (ref: unknown) => getDocMock(ref),
  deleteDoc: vi.fn(async () => {}),
}));
vi.mock('../src/lib/authHeaders', () => ({ authedHeaders: async () => ({}) }));

import {
  isEmptyConversation, mergeDeviceSessions, openedTranscript, sameTranscript, sameFileMap,
  cleanTitle, displayTitle, MAX_TITLE_LENGTH,
} from '../src/lib/chatHistory';
import { useSessionManager } from '../src/hooks/useSessionManager';
import { recencyLabel, groupSessionsByRecency } from '../src/components/history/historyGroups';
import { claimDeviceSessions, readDeviceSessionsFor, DEVICE_SESSIONS_KEY, DEVICE_SESSIONS_OWNER_KEY } from '../src/lib/deviceSessions';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
/** Comments stripped — several comments quote what was removed, by name. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n')
  .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

const welcome = { id: 'welcome-1', sender: 'ai', text: 'Welcome to NavBharatAI!' };
const langPicker = { id: 'lang-picker', sender: 'ai', text: 'Pick a language' };
const u = (id: string, text: string, ts?: string) => ({ id, sender: 'user', text, timestamp: ts });
const a = (id: string, text: string, ts?: string) => ({ id, sender: 'ai', text, timestamp: ts });

describe('1 · a chat that never started is not a chat', () => {
  it('🔴 the welcome line alone, or the welcome line + language picker, is EMPTY', () => {
    expect(isEmptyConversation({ id: '1', title: 'New Conversation', messages: [welcome] })).toBe(true);
    expect(isEmptyConversation({ id: '1', title: 'New Conversation', messages: [welcome, langPicker] })).toBe(true);
  });

  it('one user message makes it a chat — including one folded into the old restoredMessages', () => {
    expect(isEmptyConversation({ id: '1', messages: [welcome, u('m1', 'hi')] })).toBe(false);
    expect(isEmptyConversation({ id: '1', messages: [welcome], restoredMessages: [u('m1', 'hi')] })).toBe(false);
  });

  it('a chat that produced files is never empty', () => {
    expect(isEmptyConversation({ id: '1', messages: [welcome], files: { 'index.html': '<p/>' } })).toBe(false);
  });

  it('PRECISION FIRST: rows this module cannot judge are never hidden', () => {
    // A Pro build row carries no transcript here (it lives on the server), a Doctor AI case is its own
    // store, a professional row is a pseudo-row, and a row with no information at all is unknowable.
    expect(isEmptyConversation({ id: 'v3_abc', messages: [] })).toBe(false);
    expect(isEmptyConversation({ id: 'x', agent: 'agentv3', messages: [] })).toBe(false);
    expect(isEmptyConversation({ id: 'sda_x', tab: 'sda_chat', current_agent: 'sda', messages: [] })).toBe(false);
    expect(isEmptyConversation({ id: 'prof:x', profViewId: 'teacher_ai' })).toBe(false);
    expect(isEmptyConversation({ id: 'x' })).toBe(false);
    expect(isEmptyConversation(null)).toBe(false);
  });

  it('an index row answers from its flag; an older index row only from count AND placeholder title', () => {
    expect(isEmptyConversation({ id: '1', hasUserMessage: false, messageCount: 2 })).toBe(true);
    expect(isEmptyConversation({ id: '1', hasUserMessage: true, messageCount: 1 })).toBe(false);
    expect(isEmptyConversation({ id: '1', messageCount: 1, title: 'New Conversation' })).toBe(true);
    expect(isEmptyConversation({ id: '1', messageCount: 1, title: 'Tax question' })).toBe(false);
    expect(isEmptyConversation({ id: '1', messageCount: 6, title: 'New Conversation' })).toBe(false);
  });
});

describe('2 · History lists what is on this phone, not only what reached the cloud', () => {
  const cloud = [
    { id: 'c1', title: 'In the cloud', lastUpdated: '2026-09-25T10:00:00Z', messages: [u('m', 'x')] },
    { id: 'shared', title: 'Old cloud copy', lastUpdated: '2026-09-25T09:00:00Z', messages: [u('m', 'x')] },
  ];
  const device = [
    // 🔴 THE REPORT: closed inside the 2-second wait, so the cloud never received it.
    { id: 'd1', title: 'Only on the phone', lastUpdated: '2026-09-25T11:00:00Z', messages: [u('m', 'hello')] },
    { id: 'shared', title: 'Newer phone copy', lastUpdated: '2026-09-25T09:30:00Z', messages: [u('m', 'x'), a('r', 'y')] },
    { id: 'blank', title: 'New Conversation', lastUpdated: '2026-09-25T12:00:00Z', messages: [welcome] },
  ];

  it('🔴 a chat only this device has is listed', () => {
    expect(mergeDeviceSessions(cloud, device).map((r) => r.id)).toContain('d1');
  });

  it('the NEWER copy of a chat wins, and the list is newest first', () => {
    const merged = mergeDeviceSessions(cloud, device);
    expect(merged.find((r) => r.id === 'shared')!.title).toBe('Newer phone copy');
    expect(merged.map((r) => r.id)).toEqual(['d1', 'c1', 'shared']);
  });

  it('on a tie the cloud (the shared truth) wins, and fields only the cloud has survive a newer device copy', () => {
    const t = '2026-09-25T09:00:00Z';
    expect(mergeDeviceSessions([{ id: 's', title: 'cloud', lastUpdated: t, messages: [u('m', 'x')] }],
      [{ id: 's', title: 'device', lastUpdated: t, messages: [u('m', 'x')] }])[0].title).toBe('cloud');
    const kept = mergeDeviceSessions(
      [{ id: 's', lastUpdated: '2026-09-25T09:00:00Z', isPinned: true, messages: [u('m', 'x')] } as Record<string, unknown>],
      [{ id: 's', lastUpdated: '2026-09-25T10:00:00Z', messages: [u('m', 'x')] }],
    )[0];
    expect(kept.isPinned).toBe(true);
  });

  it('an empty chat is dropped from BOTH sides', () => {
    expect(mergeDeviceSessions(cloud, device).map((r) => r.id)).not.toContain('blank');
    expect(mergeDeviceSessions([{ id: 'b', messages: [welcome] }], [])).toEqual([]);
  });

  it('is total', () => {
    expect(mergeDeviceSessions(undefined as never, undefined as never)).toEqual([]);
    expect(mergeDeviceSessions([{ title: 'no id' } as never], [])).toEqual([]);
  });
});

describe('2b · 🔴 one account\'s chats are never shown to another account on the same phone', () => {
  // Found while building the merge above: the saved chats survived sign-out, and App.tsx loaded them for
  // whoever signed in next — so listing "this device's chats" in History would have shown account A's
  // conversations to account B.
  const mem = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init));
    return {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, v); },
      removeItem: (k: string) => { m.delete(k); },
      has: (k: string) => m.has(k),
    };
  };
  const chats = JSON.stringify([{ id: 'a1', messages: [u('1', "A's private chat")] }]);

  it('a different account signing in removes the previous account\'s chats and the History index', () => {
    const store = mem({ [DEVICE_SESSIONS_KEY]: chats, [DEVICE_SESSIONS_OWNER_KEY]: 'uid-A', navbharat_history_index_v1: '[]' });
    expect(claimDeviceSessions('uid-B', store)).toBe('cleared');
    expect(store.has(DEVICE_SESSIONS_KEY)).toBe(false);
    expect(store.has('navbharat_history_index_v1')).toBe(false);
    expect(readDeviceSessionsFor('uid-B', store)).toEqual([]);
  });

  it('the same account keeps its chats; a stamp-less device is adopted by whoever signs in (the old behaviour)', () => {
    const same = mem({ [DEVICE_SESSIONS_KEY]: chats, [DEVICE_SESSIONS_OWNER_KEY]: 'uid-A' });
    expect(claimDeviceSessions('uid-A', same)).toBe('kept');
    expect(readDeviceSessionsFor('uid-A', same)).toHaveLength(1);
    const legacy = mem({ [DEVICE_SESSIONS_KEY]: chats });
    expect(claimDeviceSessions('uid-A', legacy)).toBe('adopted');
    expect(readDeviceSessionsFor('uid-A', legacy)).toHaveLength(1);
  });

  it('reading is refused for anyone who is not the recorded owner, even before a sign-in claims it', () => {
    const store = mem({ [DEVICE_SESSIONS_KEY]: chats, [DEVICE_SESSIONS_OWNER_KEY]: 'uid-A' });
    expect(readDeviceSessionsFor('uid-B', store)).toEqual([]);
    expect(readDeviceSessionsFor(undefined, store)).toEqual([]);
    expect(readDeviceSessionsFor('uid-A', mem({ [DEVICE_SESSIONS_KEY]: '{broken', [DEVICE_SESSIONS_OWNER_KEY]: 'uid-A' }))).toEqual([]);
  });

  it('both doors read through the owner check — the sign-in load and History', () => {
    const app = code('src/App.tsx');
    expect(app).toContain('claimDeviceSessions(user.uid);');
    expect(app).toContain('readDeviceSessionsFor(user.uid)');
    expect(app).not.toContain("localStorage.getItem('navbharat_sessions')");
    const view = code('src/components/HistoryView.tsx');
    expect(view).toContain('readDeviceSessionsFor(uid)');
    expect(view).not.toContain("localStorage.getItem('navbharat_sessions')");
  });
});

describe('3 · opening a chat shows the conversation as it was', () => {
  it('🔴 folds the old restoredMessages split back into ONE thread and drops the canned restore lines', () => {
    const t = openedTranscript({
      restoredMessages: [u('1', 'first', '2026-09-25T10:00:00Z'), a('2', 'reply', '2026-09-25T10:00:05Z')],
      messages: [
        { id: 'continuation-greeting-1727', sender: 'ai', text: 'Previous workspace context has been successfully loaded.', timestamp: '2026-09-25T11:00:00Z' },
        u('3', 'second', '2026-09-25T11:00:10Z'),
      ],
    });
    expect(t.map((m) => (m as { id: string }).id)).toEqual(['1', '2', '3']);
  });

  it('duplicates keep the LAST copy; undated messages keep their stored order rather than being scrambled', () => {
    const t = openedTranscript({ messages: [u('1', 'old'), a('2', 'x'), u('1', 'edited')] }) as Array<{ id: string; text: string }>;
    expect(t.map((m) => `${m.id}:${m.text}`)).toEqual(['1:edited', '2:x']);
  });

  it('dated messages are chronological', () => {
    const t = openedTranscript({ messages: [u('b', 'later', '2026-09-25T10:00:09Z'), u('a', 'earlier', '2026-09-25T10:00:01Z')] }) as Array<{ id: string }>;
    expect(t.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('opening is not writing: the same transcript and the same files are "unchanged"', () => {
    const m = [u('1', 'x'), a('2', 'y')];
    expect(sameTranscript(m, [...m])).toBe(true);
    expect(sameTranscript(m, [...m, u('3', 'z')])).toBe(false);
    expect(sameTranscript(m, [m[0], a('2', 'edited')])).toBe(false);
    // An edit in the MIDDLE, same length, same last message, is still a change.
    const three = [u('1', 'x'), a('2', 'y'), u('3', 'z')];
    expect(sameTranscript(three, [three[0], a('2', 'edited'), three[2]])).toBe(false);
    expect(sameFileMap({ a: '1' }, { a: '1' })).toBe(true);
    expect(sameFileMap({ a: '1' }, { a: '2' })).toBe(false);
    expect(sameFileMap(undefined, {})).toBe(true);
  });
});

describe('4 · rename and pin', () => {
  it('a rename is one clean line, never empty, never a paragraph', () => {
    expect(cleanTitle('  Tax   question\n for  2026 ')).toBe('Tax question for 2026');
    expect(cleanTitle('   ')).toBeNull();
    expect(cleanTitle(42)).toBeNull();
    expect(cleanTitle('x'.repeat(500))!.length).toBe(MAX_TITLE_LENGTH);
  });

  it('the user\'s own name wins over the automatic title', () => {
    expect(displayTitle({ title: 'what is gst', customTitle: 'GST notes' })).toBe('GST notes');
    expect(displayTitle({ title: 'what is gst', customTitle: '' })).toBe('what is gst');
  });

  it('a pinned chat is listed under "Pinned", above every date — a live professional chat stays "Ongoing"', () => {
    const now = Date.parse('2026-09-28T12:00:00Z');
    expect(recencyLabel({ isPinned: true, lastUpdated: '2020-01-01T00:00:00Z' }, now)).toBe('Pinned');
    expect(recencyLabel({ isPinned: true, profLive: true }, now)).toBe('Ongoing');
    const groups = groupSessionsByRecency([
      { lastUpdated: '2026-09-28T11:00:00Z' },
      { lastUpdated: '2020-01-01T00:00:00Z', isPinned: true },
    ], now);
    expect(groups.map((g) => g.label)).toEqual(['Pinned', 'Today']);
  });
});

describe('5 · the session manager, called for real', () => {
  type Deps = Parameters<typeof useSessionManager>[0];
  let calls: Record<string, unknown[]>;
  let sessionsState: Record<string, unknown>[];
  const make = (sessions: Record<string, unknown>[], extra: Partial<Deps> = {}) => {
    calls = {};
    sessionsState = sessions;
    const rec = (name: string) => (v: unknown) => { (calls[name] ??= []).push(v); };
    const deps = {
      sessions, user: { uid: 'me' } as never, currentSessionId: 'cur',
      v3ResumeInFlightRef: { current: false },
      setV3Resume: rec('setV3Resume'), setCurrentSessionId: rec('setCurrentSessionId'), setFiles: rec('setFiles'),
      setSessions: (v: unknown) => {
        (calls.setSessions ??= []).push(v);
        if (typeof v === 'function') sessionsState = (v as (p: unknown) => Record<string, unknown>[])(sessionsState);
      },
      setSdaResetKey: rec('setSdaResetKey'), setSdaOpenCaseId: rec('setSdaOpenCaseId'),
      setCurrentProSessionId: rec('setCurrentProSessionId'), setProMessages: rec('setProMessages'),
      setMessages: rec('setMessages'), setGeneratedCode: rec('setGeneratedCode'), setHasGeneratedCode: rec('setHasGeneratedCode'),
      setActiveAgent: rec('setActiveAgent'), setErrorContext: rec('setErrorContext'), setIsAppBuilt: rec('setIsAppBuilt'),
      toggleTab: rec('toggleTab'), addToast: rec('addToast'), addLog: rec('addLog'),
      initialFreeChatMessages: () => [welcome as never],
      ...extra,
    } as Deps;
    return useSessionManager(deps);
  };

  beforeEach(() => {
    getDocMock.mockReset();
    try { localStorage.clear(); } catch { /* no storage in this runner */ }
  });

  it('🔴 opening shows the whole thread — no "Previous workspace context…" line, nothing collapsed — and does not re-date it', async () => {
    const saved = {
      id: 's1', title: 'GST question', agent: 'navbharatai', lastUpdated: '2026-09-20T10:00:00.000Z',
      restoredMessages: [u('1', 'what is gst', '2026-09-20T09:00:00Z'), a('2', 'GST is…', '2026-09-20T09:00:05Z')],
      messages: [
        { id: 'continuation-greeting-1', sender: 'ai', text: 'Previous workspace context has been successfully loaded.', timestamp: '2026-09-20T09:30:00Z' },
        u('3', 'and igst?', '2026-09-20T09:31:00Z'),
      ],
    };
    const { openSession } = make([saved]);
    expect(await openSession('s1')).toBe(true);

    const shown = calls.setMessages.at(-1) as Array<{ id: string; text: string }>;
    expect(shown.map((m) => m.id)).toEqual(['1', '2', '3']);
    expect(shown.some((m) => /successfully loaded/.test(m.text))).toBe(false);
    expect(calls.setCurrentSessionId.at(-1)).toBe('s1');

    const stored = sessionsState.find((s) => s.id === 's1')!;
    expect(stored.restoredMessages).toEqual([]);
    expect((stored.messages as unknown[]).length).toBe(3);
    // Looking at a chat does not move it to the top of History.
    expect(stored.lastUpdated).toBe('2026-09-20T10:00:00.000Z');
  });

  it('a chat started on another device is fetched by its id — and never another account\'s', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => ({ id: 'far', userId: 'me', title: 'From laptop', messages: [u('1', 'hi')], current_agent: 'navbharatai' }) });
    const { openSession } = make([]);
    expect(await openSession('far')).toBe(true);
    expect(getDocMock).toHaveBeenCalledWith({ col: 'chat_sessions', id: 'far' });

    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => ({ id: 'theirs', userId: 'someone-else', messages: [u('1', 'x')] }) });
    const second = make([]);
    expect(await second.openSession('theirs')).toBe(false);
    expect(String(calls.addToast?.[0] ?? '')).toMatch(/could not be found/);
  });

  it('🔴 a new chat saves NOTHING — History only ever lists chats somebody typed in', () => {
    const { startNewChat } = make([]);
    startNewChat();
    expect(calls.setSessions).toBeUndefined();
    expect(calls.setMessages?.[0]).toEqual([welcome]);
    expect(calls.setFiles?.[0]).toEqual({});
  });

  it('there is no typed-ID restore left to call', () => {
    const api = make([]) as Record<string, unknown>;
    expect(Object.keys(api).sort()).toEqual(['deleteSession', 'openSession', 'startNewChat']);
  });
});

describe('6 · 🔒 the chat-ID system is gone, read from the source', () => {
  const surfaces = [
    'src/App.tsx', 'src/components/ide/AIChat.tsx', 'src/components/panels/AppModals.tsx',
    'src/components/panels/NBIChatPanel.tsx', 'src/hooks/useSessionManager.ts', 'src/components/HistoryView.tsx',
    'src/components/history/HistoryPopup.tsx', 'src/lib/chatUtils.ts', 'src/lib/historyIndex.ts', 'src/types/index.ts',
    'src/components/agentv3/AgentV3Panel.tsx', 'src/components/sda/SDAChat.tsx', 'src/components/panels/SidebarNav.tsx',
  ];

  it('🔴 no ID box, no ID modal, no ID minting, no ID in a stored document, on any surface', () => {
    for (const p of surfaces) {
      const c = code(p);
      for (const banned of ['Universal Chat', 'Resume Previous Session', 'Hide Restore Options', 'handleRestoreByUci',
        'onRestoreUci', 'activeUci', 'generateUCI', 'showContinueModal', 'resumeUciInput', 'Restore Workspace',
        'CUI', 'UCI protocol', 'uci:', '.uci']) {
        expect(c.includes(banned), `${p} still contains "${banned}"`).toBe(false);
      }
    }
  });

  it('the canned restore greeting is gone from the code that wrote it', () => {
    const c = code('src/hooks/useSessionManager.ts');
    expect(c).not.toContain('continuation-greeting');
    expect(c).not.toContain('successfully loaded');
    expect(c).toContain('setMessages(transcript)');
    expect(c).toContain('setProMessages(transcript)');
    expect(c).toContain("getDoc(doc(db, 'chat_sessions', sessionId))");
  });

  it('a chat reaches the cloud even when the app is closed inside the 2-second wait', () => {
    const c = code('src/App.tsx');
    expect(c).toContain("document.addEventListener('visibilitychange', onVisibility)");
    expect(c).toContain("window.addEventListener('pagehide', flush)");
    expect(c).toContain("if (document.visibilityState === 'hidden') flush();");
    // Both surfaces schedule through the one function the flush can reach.
    expect(c).toContain("scheduleSessionWrite('nbi', fsNBIDebounceRef");
    expect(c).toContain("scheduleSessionWrite('pro', fsProDebounceRef");
  });

  it('the autosave starts at the first user message, skips an unchanged transcript, and never erases a rename', () => {
    const c = code('src/App.tsx');
    expect(c.split("if (!activeMsgs.some(m => m.sender === 'user')) return;").length - 1).toBe(2);
    expect(c.split('sameTranscript(existingSession.messages, activeMsgs)').length - 1).toBe(2);
    expect(c.split('customTitle: existingSession?.customTitle').length - 1).toBe(2);
    expect(c).toContain("customTitle: session.customTitle || ''");
    expect(c.split('if (isEmptyConversation(session)) return;').length - 1).toBe(2);
  });

  it('pin and rename write the cloud document too, without re-dating it', () => {
    const c = code('src/App.tsx');
    expect(c).toContain("updateDoc(doc(db, 'chat_sessions', sessionId), sanitizeFirestoreData(patch))");
    const body = c.slice(c.indexOf('const updateSessionMeta'), c.indexOf('const renameSession'));
    expect(body).not.toContain('lastUpdated');
  });

  it('the Doctor AI writer merges, so it cannot unpin or unname a case', () => {
    const c = code('src/components/sda/SDAChat.tsx');
    expect(c).toContain('{ merge: true }).catch(err => console.error(\'SDA Firestore autosave error:\', err));');
    expect(c).not.toContain('isPinned: false');
  });

  it('History: device + cloud in one list, empty chats hidden, New chat on top, the open chat marked, Pin / Rename / Delete', () => {
    const c = code('src/components/HistoryView.tsx');
    expect(c).toContain('mergeDeviceSessions(cloud, readDeviceSessions(user?.uid))');
    expect(c).toContain('sessions.filter((s) => !isEmptyConversation(s))');
    expect(c).toContain('New chat');
    expect(c).toContain("aria-current={isCurrent ? 'true' : undefined}");
    expect(c).toContain("session.isPinned ? 'Unpin' : 'Pin'");
    expect(c).toContain('Rename');
    expect(c).toContain('setConfirmDeleteId(session.id)');
    // The empty state's button starts a chat — it used to "restore" the id 'new' and fail.
    expect(c).not.toContain("('new')");
  });

  it('both History surfaces get the actions — the tab and the popup', () => {
    const app = code('src/App.tsx');
    expect(app.split('onRenameSession={renameSession}').length - 1).toBe(2);
    expect(app.split('onTogglePin={togglePin}').length - 1).toBeGreaterThanOrEqual(2);
    expect(app.split('onOpenSession={openSession}').length - 1).toBe(2);
  });
});
