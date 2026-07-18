import { describe, it, expect } from 'vitest';
import {
  loadChat, saveChat, clearChat, capTranscript, OFFLINE_CHAT_KEY, CHAT_MAX_MESSAGES,
  type PersistedChatMsg,
} from './offlineChatStore';

function mkStore() {
  const bag: Record<string, string> = {};
  return {
    bag,
    getItem: (k: string) => bag[k] ?? null,
    setItem: (k: string, v: string) => { bag[k] = v; },
    removeItem: (k: string) => { delete bag[k]; },
  };
}

const msg = (id: string, role: 'user' | 'bot', text: string): PersistedChatMsg => ({ id, role, text });

describe('offlineChatStore — on-device chat persistence (local only, user-deletable)', () => {
  it('round-trips a transcript through storage', () => {
    const s = mkStore();
    const t: PersistedChatMsg[] = [msg('1', 'user', 'hi'), { id: '2', role: 'bot', text: 'hello', answerKind: 'greeting' }];
    saveChat(t, s);
    expect(s.bag[OFFLINE_CHAT_KEY]).toBeTruthy();
    expect(loadChat(s)).toEqual(t);
  });

  it('caps history at CHAT_MAX_MESSAGES (keeps the newest)', () => {
    const many = Array.from({ length: CHAT_MAX_MESSAGES + 20 }, (_, i) => msg(String(i), i % 2 ? 'bot' : 'user', `m${i}`));
    const capped = capTranscript(many);
    expect(capped.length).toBe(CHAT_MAX_MESSAGES);
    expect(capped[capped.length - 1].text).toBe(`m${CHAT_MAX_MESSAGES + 19}`);
    const s = mkStore();
    saveChat(many, s);
    expect(loadChat(s).length).toBe(CHAT_MAX_MESSAGES);
  });

  it('clearChat wipes the transcript (the delete control)', () => {
    const s = mkStore();
    saveChat([msg('1', 'user', 'x')], s);
    clearChat(s);
    expect(loadChat(s)).toEqual([]);
  });

  it('is corruption-safe — malformed or wrong-shape data loads as []', () => {
    const s = mkStore();
    s.bag[OFFLINE_CHAT_KEY] = 'not json {{{';
    expect(loadChat(s)).toEqual([]);
    s.bag[OFFLINE_CHAT_KEY] = JSON.stringify([{ id: 1 }, { role: 'x' }, 'nope']);
    expect(loadChat(s)).toEqual([]);
  });

  it('preserves card ids (features/device) so a reloaded turn can rehydrate its cards', () => {
    const s = mkStore();
    const t: PersistedChatMsg[] = [{ id: 'b', role: 'bot', text: 'here', featureIds: ['billing'], deviceIds: ['wifi_not_connecting'], online: true }];
    saveChat(t, s);
    const back = loadChat(s)[0];
    expect(back.featureIds).toEqual(['billing']);
    expect(back.deviceIds).toEqual(['wifi_not_connecting']);
    expect(back.online).toBe(true);
  });
});
