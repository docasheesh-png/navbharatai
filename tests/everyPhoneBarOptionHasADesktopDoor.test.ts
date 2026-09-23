/**
 * EVERY OPTION THE PHONE'S BOTTOM BAR OFFERS MUST HAVE A DOOR ON DESKTOP.
 *
 * 🔴 Admin, 2026-09-22: *"mobile to footer me jo jo options hai. kuch options desktop me gayab ho
 * gaye hai. jaise navbharatai free me, history. aise aur bhi bhi option honge — dhundo… aur sabhi
 * ko fix karo!!"*
 *
 * Three things were reachable only on a phone, and each for the same reason — a door was removed
 * because *another* door already existed, and that other door turns out to be mobile-only:
 *
 *   1. **Chat history.** `SIDEBAR_HIDDEN` dropped `history` on 2026-08-11 with the reason *"yeh sab
 *      AI ke andar already hai … History: the per-AI footer"*. That footer renders under
 *      `effectiveDeviceMode === 'mobile'`. `toggleTab('history')` then had exactly ONE caller in the
 *      entire client — that footer item. On a desktop there was no way to reach your own
 *      conversations at all.
 *   2. **About Us** — its door is a row in the slide-out drawer.
 *   3. **Report a problem** (and the badge counting NavBharatAI's replies) — the same drawer, plus a
 *      phone SHAKE. A desktop has neither.
 *
 * …and the drawer is opened by the hamburger, which `TopNav` renders under
 * `effectiveDeviceMode === 'mobile'`. So "it is in the drawer" and "it is in the footer" are the
 * same sentence: **it is on a phone**.
 *
 * ## The class was already found once, for the button sitting beside History in the same row
 *
 * `ModeButton`'s own docblock states it: *"on a PHONE they all do, because the bottom bar's Mode
 * item is rendered for exactly that list. On desktop there is no bottom bar"*. Mode was given a
 * desktop door (`modePickerOpener`, computed once, so exactly one control exists on any screen).
 * **History sat one item along the same four-item footer and was never hunted** — this repo's
 * headline class (autopsy `a38c6fef`): the instance fixed, the sibling left.
 *
 * ## Why a test, and why these assertions
 *
 * Nothing else can see this. `tsc` is happy — every function exists and is called. `vitest` is
 * happy — the code runs. The old `SidebarNav.logic.test.ts` was GREEN throughout and pinned
 * `history` INTO the hidden set, because it faithfully recorded a decision that was only ever true
 * on one of the two screens. A test can lock a bug in place while passing.
 *
 * So the assertions below are about REACHABILITY, and each one names the screen it is about.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const app = read('src/App.tsx');
const sidebar = read('src/components/panels/SidebarNav.tsx');
const topNav = read('src/components/panels/TopNav.tsx');

const hiddenFromSidebar = () => {
  const m = /SIDEBAR_HIDDEN = new Set\(\[([^\]]*)\]\)/.exec(sidebar);
  expect(m, 'SIDEBAR_HIDDEN not found').toBeTruthy();
  return m![1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
};

describe('the premise: the phone bar and the drawer are both mobile-only', () => {
  // Every assertion in this file rests on these two. If either stops being true the reasoning
  // changes, and a test whose premise has quietly moved is worse than no test.
  it('the bottom bar renders only on mobile', () => {
    expect(app).toMatch(/showsGlobalMobileNav\s*=\s*\n?\s*effectiveDeviceMode === 'mobile'/);
  });

  it('the drawer‑opening hamburger renders only on mobile', () => {
    const at = topNav.indexOf("setIsMenuOpen(true)");
    expect(at, 'the hamburger was not found in TopNav').toBeGreaterThan(-1);
    // The guard sits immediately above the button that opens the drawer.
    expect(topNav.slice(Math.max(0, at - 400), at)).toContain("effectiveDeviceMode === 'mobile'");
  });
});

describe('chat history has a door on every screen', () => {
  it('is NOT hidden from the desktop rail any more', () => {
    expect(hiddenFromSidebar()).not.toContain('history');
  });

  it('the rail row and the phone bar call the SAME opener', () => {
    // Not two copies. The opener owns three rules — the list's scope, popup-vs-tab, and the
    // sign-in gate — and a second copy at the second door would drift on all three, silently:
    // the two doors would simply start showing different lists.
    expect(app).toContain('const openHistoryForCurrentSurface = useCallback(');
    expect(app).toContain('onOpenHistory={openHistoryForCurrentSurface}');
    // the phone bar's item delegates rather than re-implementing
    expect(app).toMatch(/if \(id === 'history'\) \{ openHistoryForCurrentSurface\(\); return; \}/);
    // and the rail row delegates too
    expect(sidebar).toMatch(/item\.id === 'history' && onOpenHistory/);
  });

  it('🔒 the three rules live in the opener, not at either door', () => {
    const fn = app.slice(app.indexOf('const openHistoryForCurrentSurface'));
    const body = fn.slice(0, fn.indexOf('}, [activeView'));
    expect(body).toContain('historyFilterFor');     // what the list shows
    expect(body).toContain('historySurfaceFor');    // popup over the chat, or its own tab
    expect(body).toContain('authGateDecision');     // sign-in
  });

  it('…and the phone still has exactly ONE door, not two', () => {
    // The bar already carries History, so the drawer must not also list it. One door per screen is
    // the whole invariant — "none" and "two" are both failures.
    const m = /DRAWER_HIDDEN = new Set\(\[([^\]]*)\]\)/.exec(sidebar);
    expect(m![1]).toContain('history');
  });
});

describe('About Us and Report a problem are on the rail as well as in the drawer', () => {
  it('each is ONE definition rendered at BOTH doors', () => {
    // The pattern `notificationsRow` already uses. A copy per surface is the drifted-copy class
    // this repo has paid for four times; here it would show as a reply badge that counts on one
    // surface and not the other.
    for (const row of ['aboutRow', 'reportRow']) {
      expect(sidebar, `${row} is not defined`).toContain(`const ${row} = (closeMenu: boolean)`);
      expect(sidebar, `${row} must render on the rail`).toContain(`{${row}(false)}`);
      expect(sidebar, `${row} must render in the drawer`).toContain(`{${row}(true)}`);
    }
  });

  it('the rail really renders them (not just defines them)', () => {
    // `notificationsRow(false)` is the rail's existing marker — the new rows sit beside it, so a
    // refactor that moved them into the drawer block would fail here.
    const railEnd = sidebar.indexOf('{/* Mobile slide-out navigation drawer */}');
    expect(railEnd).toBeGreaterThan(-1);
    const rail = sidebar.slice(0, railEnd);
    expect(rail).toContain('{aboutRow(false)}');
    expect(rail).toContain('{reportRow(false)}');
  });
});

describe('the ids that STAY hidden really do have a door on both screens', () => {
  // The precision half: this change must not become "unhide everything". Each of these was checked
  // against the code that serves it, not against the comment that claims it.
  it('Preview and Files are served by a tab strip that renders on desktop too', () => {
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    // `mobileFooter ? 'hidden lg:flex' : 'flex'` — on a phone the row moves into the footer, on a
    // desktop it renders. Both screens have it, which is why these two stay hidden from the rail.
    expect(panel).toContain("mobileFooter ? 'hidden lg:flex' : 'flex'");
    expect(panel).toContain("openTab('preview')");
    expect(panel).toContain("openTab('files')");
    for (const id of ['preview', 'files']) expect(hiddenFromSidebar()).toContain(id);
  });

  it('every hidden id is STILL in menuItems — hiding is not deleting', () => {
    // TopNav does `if (!item) return null`, so an id dropped from menuItems opens a window with no
    // chip and no ✕. Restated here because this file changes that set.
    for (const id of hiddenFromSidebar()) {
      expect(app, `menuItems is missing "${id}"`).toMatch(new RegExp(`id: '${id}'`));
    }
  });
});
