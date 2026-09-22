/**
 * THE MODE LIST IS THE WINDOW SWITCHER, AND THE HEADER GROWS NO TAB ON A MODE SWITCH (admin 2026-09-22).
 *
 *   "navbharatai free me koi user mode se professionals, image generator change kare to, abhi header me
 *    new window me aa jate hai, isko badalna hai … upar recent chat, niche new chat … recent chat ke
 *    sabhi chat waise hi switch hone chahiye jaise multi window se hote hai … navbharatai me mode switch
 *    karne se header me new window/tab na create ho"
 *
 * The pure half (`lib/headerTab.ts`) is tested directly; the wiring in App.tsx and TopNav.tsx is
 * source-pinned, because the switch, the cap and the host tab are decided in a 4,000-line component the
 * suite cannot mount.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { headerTabFor, hiddenHeaderTabs, insideChatTab } from '../src/lib/headerTab';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const app = codeOnly(read('src/App.tsx'));
const nav = codeOnly(read('src/components/panels/TopNav.tsx'));
const sheet = codeOnly(read('src/components/chat/ModePickerSheet.tsx'));

// The header's registered chips, as the real menu has them: the FREE chat, the hub, the studio, Settings.
const hasChip = (id: string) => ['nbi_chat', 'professionals', 'imagegen', 'settings', 'other_ai', 'home'].includes(id);

describe('headerTabFor — the tab a chat was entered through stays lit', () => {
  it('a professional opened from FREE lights FREE; from the hub, the hub', () => {
    expect(headerTabFor('teacher_ai', { teacher_ai: 'nbi_chat' }, hasChip)).toBe('nbi_chat');
    expect(headerTabFor('teacher_ai', { teacher_ai: 'professionals' }, hasChip)).toBe('professionals');
    // Doctor AI is a child surface too, so the same rule reaches it.
    expect(headerTabFor('sda_chat', { sda_chat: 'nbi_chat' }, hasChip)).toBe('nbi_chat');
  });

  it('the image studio opened THROUGH a chat tab lives inside it; opened from Other Tools it keeps its own chip', () => {
    // Assumption (b), approved by the admin: the DOOR decides.
    expect(insideChatTab('imagegen', { imagegen: 'nbi_chat' })).toBe(true);
    expect(headerTabFor('imagegen', { imagegen: 'nbi_chat' }, hasChip)).toBe('nbi_chat');
    expect(hiddenHeaderTabs(['home', 'nbi_chat', 'imagegen'], { imagegen: 'nbi_chat' })).toEqual(['imagegen']);
    expect(insideChatTab('imagegen', { imagegen: 'other_ai' })).toBe(false);
    expect(headerTabFor('imagegen', { imagegen: 'other_ai' }, hasChip)).toBe('imagegen');
    expect(hiddenHeaderTabs(['home', 'nbi_chat', 'imagegen'], { imagegen: 'other_ai' })).toEqual([]);
    expect(headerTabFor('imagegen', {}, hasChip)).toBe('imagegen');
  });

  it('a view with no chip and no door lights nothing — the same as before, never a wrong tab', () => {
    expect(headerTabFor('sda_chat', {}, hasChip)).toBe('sda_chat');
    expect(headerTabFor('settings', { settings: 'nbi_chat' }, hasChip)).toBe('nbi_chat');
  });

  it('a corrupted opener cycle terminates', () => {
    expect(headerTabFor('a', { a: 'b', b: 'a' }, () => false)).toBe('a');
  });
});

describe('the wiring: no chip on a mode switch, one switch path, one cap', () => {
  it('🔴 TopNav draws no per-conversation chips and hides the tabs App tells it to', () => {
    expect(nav).not.toContain('chatWindows');
    expect(nav).toContain("openTabs.filter(id => id !== 'home' && !hidden.has(id))");
    expect(nav).toContain('const lit = highlightedTab ?? activeView;');
    expect(nav).toMatch(/lit === tabId\s*\?\s*'bg-indigo-600/);
  });

  it('App hands the header the hidden tabs and the lit tab from lib/headerTab.ts, never a hand-kept rule', () => {
    expect(app).toContain('hiddenTabs={hiddenHeaderTabs(openTabs, tabOpeners)}');
    expect(app).toContain('highlightedTab={headerTabFor(activeView, tabOpeners, hasHeaderChip)}');
    expect(app).toContain('const hasHeaderChip = useCallback((id: string) => menuItems.some((m) => m.id === id), [menuItems]);');
    // The helper must be declared AFTER the menu it reads (a const read in its deps before declaration
    // is a compile error, and moving the memo would be the wrong fix).
    expect(app.indexOf('const menuItems = useMemo')).toBeLessThan(app.indexOf('const hasHeaderChip'));
  });

  it('a recent row switches through toggleTab with its conversation — the window path, not a second one', () => {
    expect(app).toContain('if (resume) { toggleTab(resume.view as ViewType, true, resume.conversationId); return; }');
    expect(app).not.toContain('onSelectChatWindow');
  });

  it('✕ on a recent row closes a WINDOW through closeChatWindow and a single-chat view through closeTab', () => {
    const at = app.indexOf('onCloseRecent={(recentId) =>');
    const body = app.slice(at, at + 600);
    expect(body).toContain('const target = recentTargetFromId(recentId);');
    expect(body).toContain('if (target.conversationId) { closeChatWindow(undefined, target.conversationId); return; }');
    expect(body).toContain('closeTab(undefined, target.view as ViewType);');
  });

  it('the image studio picked from Mode is capped, then parented to the chat tab it was picked from', () => {
    const at = app.indexOf('if (id === IMAGE_MODE_ID) {');
    const body = app.slice(at, at + 800);
    expect(body).toContain("if (!chatSlotFree(openChats, openTabs)) { addToast(capMessage(), 'warning'); return; }");
    expect(body).toContain('const host = headerTabFor(activeView, tabOpeners, hasHeaderChip);');
    expect(body).toContain('setTabOpeners(prev => ({ ...prev, [IMAGE_MODE_ID]: host as ViewType }));');
    // Only when it was NOT already open: an open studio keeps the door it came in by.
    expect(body.indexOf('if (!openTabs.includes(IMAGE_MODE_ID as ViewType)) {')).toBeLessThan(body.indexOf('const host ='));
  });

  it('Doctor AI picked from Mode is capped only when it is CLOSED — a fresh case replaces, it does not add', () => {
    expect(app).toContain("if (!openTabs.includes('sda_chat') && !chatSlotFree(openChats, openTabs)) { addToast(capMessage(), 'warning'); return; }");
  });

  it('the sheet receives the open tabs, the open windows and the window on screen', () => {
    expect(app).toContain('openViews={openTabs}');
    expect(app).toContain('openChats={openChats}');
    expect(sheet).toContain('const recent = visible.filter((e) => e.kind === \'recent\');');
  });

  it('the two groups are themed with tokens, not literals', () => {
    expect(sheet).not.toMatch(/text-white|bg-\[#|text-gray-\d|#[0-9a-f]{6}/);
  });
});
