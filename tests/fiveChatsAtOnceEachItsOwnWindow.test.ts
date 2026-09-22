/**
 * FIVE CHATS AT ONCE, EACH ITS OWN WINDOW (admin 2026-09-21) — the App/TopNav wiring, which nothing else
 * can see: the chat component is lazy-loaded, so a window rendered without its conversation id, a chip
 * keyed by view instead of conversation, or a cap that refuses silently would all type-check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
import { OWN_SURFACE_PROFESSIONALS } from '../src/lib/chatWindows';
import { PROFESSIONAL_CHATS } from '../src/components/professionals/professionalConfigs';

const app = codeOnly(read('src/App.tsx'));
const nav = codeOnly(read('src/components/panels/TopNav.tsx'));

describe('windows live BESIDE the tab list, never inside it', () => {
  it('openTabs stays a ViewType[] and the windows are a ChatWindow[]', () => {
    expect(app).toContain('const [openTabs, setOpenTabs] = useState<ViewType[]>');
    expect(app).toContain('const [openChats, setOpenChats] = useState<ChatWindow[]>([]);');
    // ViewType is a closed union — a conversation id must never be pushed into it.
    expect(app).not.toMatch(/setOpenTabs\(prev => \[\.\.\.prev, (win|conversationId|wanted)/);
  });

  it('there is ONE answer to "which window is on screen", and every reader asks it', () => {
    expect(app).toMatch(/const activeChat = useMemo\(\(\) => \{[\s\S]{0,300}?same\[same\.length - 1\] \?\? null;/);
    expect(app).toContain('const onScreen = activeChat?.id === win.id;');
    // The Mode sheet's ✓ and the header's chip both used to read it; since 2026-09-22 the sheet is the
    // only switcher, and it reads the same answer.
    expect(app).toContain('activeChatId={activeChat?.id ?? null}');
    expect(app).not.toContain('active: activeChat?.id === w.id,');
  });
});

describe('an own-surface professional keeps its own tool, and no other professional has one', () => {
  it('OWN_SURFACE_PROFESSIONALS matches what App.tsx renders — in both directions', () => {
    for (const id of OWN_SURFACE_PROFESSIONALS) {
      expect(app, `${id} must have its own render block`).toContain(`activeView === '${id}' && (`);
      expect(app, `${id} must not be rendered by the generic surface`).not.toContain(`PROFESSIONAL_CHATS.${id}`);
    }
    for (const id of Object.keys(PROFESSIONAL_CHATS)) {
      if (OWN_SURFACE_PROFESSIONALS.has(id)) continue;
      expect(app, `${id} must be rendered ONLY through the window map`).not.toContain(`activeView === '${id}' && (`);
    }
    expect(app).toContain('if (isWindowedProfessional(view)) {');
    expect(app).toContain("!isWindowedProfessional(win.professionalId) || medicalViewBlocked(win.professionalId, isNativeApp())");
  });
});

describe('every door into an expert leads to a window', () => {
  it('toggleTab mints or focuses the window AFTER every gate, and refuses honestly at the cap', () => {
    const at = app.indexOf('const toggleTab = useCallback');
    const body = app.slice(at, app.indexOf('const closeTab', at));
    const gates = ['medicalViewBlocked(view, isNativeApp())', 'isComingSoonTool(view)', "authGateDecision(view, !!user, loadingUser) === 'login'"];
    const windowAt = body.indexOf('if (isWindowedProfessional(view)) {');
    expect(windowAt).toBeGreaterThan(0);
    for (const g of gates) expect(body.indexOf(g), g).toBeLessThan(windowAt);
    expect(body).toContain("if (!opened.opened) { addToast(capMessage(), 'warning'); return false; }");
    expect(body).toContain('(store && latestOpenConversationId(store, view)) || newConversationId()');
  });

  it('"New chat" in the Mode sheet mints a fresh conversation; History opens BY conversation', () => {
    expect(app).toContain('toggleTab(id as ViewType, true, newConversationId());');
    // Every History door goes through ONE App handler, which secures the window BEFORE resuming.
    expect(app.match(/onOpen(Professional)?=\{openProfessionalConversation\}/g)?.length).toBe(3);
    expect(app.match(/onDelete(Professional)?=\{deleteProfessionalConversation\}/g)?.length).toBe(3);
    expect(app).toContain('toggleTab(professionalId as ViewType, true, ref.conversationId, ref.endedAt)');
  });

  it('an ENDED row is resumed only AFTER the cap is checked, and never by a history view itself (review finding)', () => {
    const at = app.indexOf('const toggleTab = useCallback');
    const body = app.slice(at, app.indexOf('const closeTab', at));
    // The cap counts Doctor AI and the image studio too since 2026-09-22, so it asks `chatSlotFree`
    // with the open tabs — never `openChats.length` alone.
    const capAt = body.indexOf("if (!chatSlotFree(openChats, openTabs)) { addToast(capMessage(), 'warning'); return false; }");
    expect(body).not.toContain('openChats.length >= MAX_OPEN_CHATS');
    expect(body).toContain('openWindow(openChats, { id: wanted, professionalId: view }, openTabs)');
    const resumeAt = body.indexOf('resumeArchived(store, view, resumeEndedAt)');
    expect(capAt).toBeGreaterThan(0);
    expect(resumeAt).toBeGreaterThan(capAt);
    for (const f of ['src/components/professionals/ProfessionalHistoryView.tsx', 'src/components/HistoryView.tsx']) {
      expect(codeOnly(read(f)), f).not.toContain('resumeArchived(');
    }
    // A refusal keeps the popup open (nothing happened), rather than closing over it.
    expect(codeOnly(read('src/components/history/HistoryPopup.tsx'))).toContain('if (r !== false) onClose();');
  });

  it('deleting an ONGOING row closes its window too, storage first (review finding)', () => {
    const at = app.indexOf('const deleteProfessionalConversation');
    const body = app.slice(at, app.indexOf('const openProfessionalConversation', at));
    expect(body.indexOf('deleteOpenConversation(store, professionalId, conversationId)')).toBeLessThan(body.indexOf('closeWindow(openChats, conversationId)'));
    expect(body).toContain('closeTab(undefined, closed.professionalId as ViewType)');
    const hv = codeOnly(read('src/components/HistoryView.tsx'));
    expect(hv).toContain('onDeleteProfessional(prof.profViewId, prof.profConversationId)');
  });

  it('a hidden window is told when it comes on screen, so its newest reply is scrolled into view', () => {
    expect(app).toMatch(/<ProfessionalChat[^>]*onScreen=\{onScreen\}/);
    const chat = codeOnly(read('src/components/professionals/ProfessionalChat.tsx'));
    expect(chat).toContain("if (onScreen) endRef.current?.scrollIntoView({ behavior: 'smooth' });");
    expect(chat).toContain('}, [messages, onScreen]);');
  });
});

describe('the header shows NO window chips — the Mode list is the switcher (2026-09-22)', () => {
  it('the per-conversation chips are gone from the header, and App hands it none', () => {
    // Admin: "navbharatai me mode switch karne se header me new window/tab na create ho". The chips this
    // block pinned from 2026-09-21 moved into the Mode list's Recent group (theModeListIsTheWindowSwitcher
    // .test.ts locks that side).
    expect(nav).not.toContain('chatWindows');
    expect(nav).not.toContain('onSelectChatWindow');
    expect(nav).not.toContain('onCloseChatWindow');
    expect(app).not.toContain('chatWindows={');
    expect(app).not.toContain('onCloseChatWindow=');
  });

  it('the professional tab-chip rule is untouched: an unregistered id still renders no tab chip', () => {
    // The #3226 ratchet asserts this too; repeated here because this change is the one that could have
    // "fixed" it by registering the experts — which would have made every expert a top-level tab.
    expect(nav).toContain('if (!item) return null;');
    expect(app).not.toMatch(/\{ id: 'teacher_ai',\s*label:/);
  });

});
