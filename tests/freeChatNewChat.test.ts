import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * "FREE ME NEW CHAT KAISE START HOGI? KOI OPTION BANAYA HAI? NAHI BANAYA HAI." (admin 2026-08-23.)
 *
 * They were right, and the shape of it is the interesting part: `startNewChat` was ALREADY WRITTEN,
 * already correct, already returned from useSessionManager — and had **no caller anywhere**. Pro v5.0
 * had its own "+ New chat"; History had one, but only in its empty state; the free chat had nothing.
 * The fourth instance in two days of a capability existing while one surface does not use it.
 *
 * These tests pin the wiring and the two real defects found in the dead code.
 */

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('the free chat can start a new conversation', () => {
  const app = src('src/App.tsx');
  const panel = src('src/components/panels/NBIChatPanel.tsx');

  it('startNewChat is taken out of the hook and handed to the free chat panel', () => {
    expect(app).toContain('deleteSession, startNewChat } = useSessionManager(');
    expect(app).toContain('onNewChat={startNewChat}');
  });

  it('the panel renders the control, and only when it has a real handler', () => {
    // A New chat button with nothing behind it is the dead button this codebase keeps deleting.
    expect(panel).toContain('onNewChat?: () => void;');
    expect(panel).toContain('{onNewChat && (');
    expect(panel).toContain('onClick={onNewChat}');
  });

  it('🔒 it tells the user their conversation is not being thrown away', () => {
    expect(panel).toContain('stays saved in History');
  });
});

describe('the two defects the dead code carried', () => {
  const hook = src('src/hooks/useSessionManager.ts');

  it('🔒 a new chat uses App’s own opening, so the LANGUAGE PICKER still appears', () => {
    // The dead version hardcoded an English welcome and skipped the picker entirely, so pressing New
    // chat would have silently put a user who had not chosen a language back into English — a
    // regression on a rule the admin has stated directly ("AI response hamesha user ki language me").
    expect(hook).toContain('initialFreeChatMessages: () => Message[];');
    expect(hook).toContain('const opening = initialFreeChatMessages();');
    expect(hook).toContain('setMessages(opening);');
  });

  it('🔒 ONE copy of the opening, used for both the screen and the saved session', () => {
    // It previously carried THREE hardcoded copies of the welcome line — two for the transcript and a
    // third inside the saved record. That is how a saved session can describe a conversation that
    // never happened, and how any future edit to one of them silently disagrees with the others.
    expect(hook).toContain('messages: opening,');
    expect(hook).not.toContain("I\\'m Vishwakarma. How can I help you today?");
    const welcomeCopies = hook.split('You can chat with me in any language!').length - 1;
    expect(welcomeCopies).toBe(0);
  });

  it('the new session gets a NEW id before anything is cleared', () => {
    // The ordering IS the safety property: the transcript is auto-saved to History under the CURRENT
    // id, so clearing without a new id would make the user's next message overwrite the conversation
    // they just left.
    const body = hook.slice(hook.indexOf('const startNewChat'));
    expect(body.indexOf('const newId')).toBeLessThan(body.indexOf('setMessages(opening)'));
    expect(body).toContain('setCurrentSessionId(newId)');
  });
});
