import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('separate public bot browser boundary', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const panel = readFileSync('src/components/panels/MitrifyChatPanel.tsx', 'utf8');
  const hook = readFileSync('src/hooks/useMitrifyBot.ts', 'utf8');
  it('server capability gates menu, navigation and render, and identity keys the panel', () => {
    expect(app).toContain("...(mitrifyBot ? [{ id: 'mitrify_chat'");
    expect(app).toContain("if (view === 'mitrify_chat' && !mitrifyBot) return false;");
    expect(app).toContain("activeView === 'mitrify_chat' && mitrifyBot && user");
    expect(app).toContain('key={user.uid} uid={user.uid} access={mitrifyBot}');
    expect(app).toContain("setActiveView(view => view === 'mitrify_chat' ? 'home' : view)");
    expect(app).toContain("tabs.filter(tab => tab !== 'mitrify_chat')");
    expect(hook).toContain("fetch('/api/v1/chat/mitrify-bot'");
    expect(hook).toContain('result?.uid === uid && auth.currentUser?.uid === uid');
    expect(hook).toContain('return () => controller.abort()');
  });
  it('sends only one explicitly reviewed message, without persistence, credentials or unrelated history', () => {
    expect(panel).toContain('body: JSON.stringify({ message, publicContentConfirmed: true })');
    expect(panel).toContain('!confirmed');
    expect(panel).toContain('setInput(event.target.value); setConfirmed(false)');
    expect(panel).toContain('Automatic checks can miss sensitive content');
    expect(panel).not.toMatch(/localStorage|sessionStorage|MITRIFY_API_KEY|messages:\s*messages/);
    expect(panel).toContain("auth.onAuthStateChanged(user => { if (user?.uid !== uid) pending.current?.abort(); })");
    expect(panel).toContain('if (controller.signal.aborted || auth.currentUser?.uid !== uid) return;');
    expect(panel).toContain("message.completion !== 'length'");
    expect(panel).toContain('item.attemptTicket === offer.ticket && item.text === message.text');
    expect(panel).toContain('key={reviewOffer.ticket}');
    expect(panel).toContain("continuation: { available: false, reason: 'used' }");
  });
});
