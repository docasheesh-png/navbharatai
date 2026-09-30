// ADMIN 2026-09-28 (screenshot of the Mode list): "navbharatai free aur image generate ai free, bas 1 hi
// open ho rhe hai, waki sabhi professional 2-2 open ho ja rahe hai. sabhi ko ek jaisa karo! aur sabhi ke
// end me x (close) button bana do". Asked which way to make them alike, they chose: every AI opens
// several windows. So the FREE chat, the image studio and Doctor AI now hold windows like a professional,
// and every Recent row carries a ✕.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  viewWindowsFor, addViewWindow, chatSlotsUsed, chatSlotFree, DEFAULT_VIEW_WINDOW, MAX_OPEN_CHATS,
} from '../src/lib/chatWindows';
import {
  recentModeEntries, activeModeId, lastChatClosed, recentRowClosable, recentModeId, recentTargetFromId, IMAGE_MODE_ID,
} from '../src/components/chat/modePicker';

const FREE = 'nbi_chat';

describe('a single-chat view has one implicit window until a second is opened', () => {
  it('open tab, empty list ⇒ exactly the chat it always had', () => {
    expect(viewWindowsFor([], [FREE], FREE)).toEqual([{ id: DEFAULT_VIEW_WINDOW, professionalId: FREE }]);
    expect(viewWindowsFor([], [], FREE)).toEqual([]);
  });
  it('opening a second writes the first out beside it, in order', () => {
    const list = addViewWindow([], [FREE], FREE, 'free-2');
    expect(viewWindowsFor(list, [FREE], FREE).map((w) => w.id)).toEqual([DEFAULT_VIEW_WINDOW, 'free-2']);
    const three = addViewWindow(list, [FREE], FREE, 'free-3');
    expect(viewWindowsFor(three, [FREE], FREE).map((w) => w.id)).toEqual([DEFAULT_VIEW_WINDOW, 'free-2', 'free-3']);
  });
});

describe('the five-chat cap counts every window', () => {
  it('the first FREE window is free as before; every further one counts, and so does each image/Doctor window', () => {
    expect(chatSlotsUsed([], [FREE, 'sda_chat'])).toBe(1); // unchanged from before
    const free2 = addViewWindow([], [FREE], FREE, 'f2');
    expect(chatSlotsUsed([], [FREE], free2)).toBe(1);
    const img2 = addViewWindow(free2, [FREE, IMAGE_MODE_ID], IMAGE_MODE_ID, 'i2');
    expect(chatSlotsUsed([], [FREE, IMAGE_MODE_ID], img2)).toBe(3);
  });
  it('a sixth chat is refused whichever kind it is', () => {
    let list = addViewWindow([], [FREE], FREE, 'f2');
    for (const id of ['f3', 'f4', 'f5']) list = addViewWindow(list, [FREE], FREE, id);
    expect(chatSlotsUsed([], [FREE], list)).toBe(4);
    list = addViewWindow(list, [FREE], FREE, 'f6');
    expect(chatSlotsUsed([], [FREE], list)).toBe(MAX_OPEN_CHATS);
    expect(chatSlotFree([], [FREE], list)).toBe(false);
  });
});

describe('the Recent group lists every window, numbered, each with a ✕', () => {
  const viewWindows = addViewWindow(addViewWindow([], [FREE, IMAGE_MODE_ID], FREE, 'free-2'), [FREE, IMAGE_MODE_ID], IMAGE_MODE_ID, 'img-2');
  const recent = recentModeEntries({ hideMedical: false, openViews: [FREE, IMAGE_MODE_ID], viewWindows });

  it('two FREE rows and two image rows, numbered like a professional\'s', () => {
    expect(recent.map((e) => e.name)).toEqual([
      'NavBharatAI FREE (1)', 'NavBharatAI FREE (2)', 'Image Generator AI (1)', 'Image Generator AI (2)',
    ]);
  });
  it('the first window keeps the plain id it always had; the others carry their window', () => {
    expect(recent[0].id).toBe(recentModeId(FREE));
    expect(recentTargetFromId(recent[1].id)).toEqual({ view: FREE, conversationId: 'free-2' });
    expect(recent[3].conversationId).toBe('img-2');
  });
  it('every one of them is closable', () => {
    expect(recent.every((e) => recentRowClosable(e.id))).toBe(true);
  });
  it('the ✓ names the window on screen', () => {
    expect(activeModeId(FREE, null, 'free-2')).toBe(recent[1].id);
    expect(activeModeId(FREE, null, DEFAULT_VIEW_WINDOW)).toBe(recent[0].id);
    expect(activeModeId(FREE)).toBe(recent[0].id);
  });
  it('one of two FREE windows closing is not "the last chat"; the last one is', () => {
    const twoFree = recent.slice(0, 2);
    expect(lastChatClosed(recent, recent[2].id)).toBe(false);
    expect(lastChatClosed(twoFree, twoFree[1].id)).toBe(true);
    expect(lastChatClosed([...twoFree, recent[2]], recent[2].id)).toBe(false);
  });
});

describe('the wiring (source guards — tsc cannot see which state a switch moves)', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  it('a FREE switch is refused while a reply is arriving, never poured into the other window', () => {
    const at = app.indexOf('const showFreeWindow = ');
    const body = app.slice(at, app.indexOf('const newFreeWindow', at));
    expect(body).toMatch(/if \(isLoading\) \{ addToast\('Wait for the reply to finish, then switch chats\.', 'warning'\); return; \}/);
    expect(body.indexOf('keepFreeOnScreen();')).toBeLessThan(body.indexOf('loadFreeSnapshot(targetId)'));
  });
  it('the only FREE window restarts fresh instead of closing the tab every other chat lives in', () => {
    const at = app.indexOf('const closeFreeWindow = ');
    const body = app.slice(at, app.indexOf('const newSlotViewWindow', at));
    expect(body).toMatch(/if \(wins\.length <= 1\) \{[\s\S]{0,120}startNewChat\(\);/);
    expect(body).not.toMatch(/closeTab\(/);
  });
  it('a new image or Doctor window is capped, and Doctor AI remembers its first case', () => {
    const at = app.indexOf('const newSlotViewWindow = ');
    const body = app.slice(at, app.indexOf('const closeSlotViewWindow', at));
    expect(body).toMatch(/if \(!chatSlotFree\(openChats, openTabs, viewWindows\)\)/);
    expect(body).toMatch(/sdaDefaultCaseRef\.current = \{ caseId: localStorage\.getItem\(CASE_ID_KEY\)/);
  });
  it('closing a tab drops its windows too', () => {
    expect(app).toMatch(/setViewWindows\(prev => prev\.filter\(w => !closingSet\.has\(w\.professionalId\)\)\);/);
  });
});
