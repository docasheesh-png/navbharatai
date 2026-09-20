// "jab admin panel open hota hai, to footer me yeh home|ai|preview|studio|more etc jo dikh rahe hai —
//  isko badalna hai!! is footer me MONITOR, USERS, ai engine, revenue … jo abhi header me hai, unko
//  rakho." (admin 2026-09-20; and the same day: "ham desktop me aise hi rahne do!")
//
// On a phone the admin console spent its only fixed row — the one a thumb can always reach — on five
// buttons that lead OUT of the console, while the nine tabs that ARE the console sat in a scrolling
// strip up in the header. Three things are locked here, and each one is a way the change could have
// been made wrong rather than a restatement of what it does:
//
//   1. The footer NAMES NO TAB. It renders the console's own list, so a tab added to `TABS` appears
//      in the footer by construction. A hardcoded copy in App.tsx would drift the first time a page
//      was added and NOTHING would fail — the strip would simply be missing it.
//   2. `touchAction` must be `pan-x` on that strip. The bar carries a deliberate `none` (admin
//      2026-09-14: a drag up moved the whole app on iOS), and `none` forbids EVERY pan — so a
//      swipable footer with `none` on it is a footer that cannot be swiped.
//   3. Desktop is untouched, and by CONSTRUCTION rather than by a second rule.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminFooterItems, adminMobileFooterActive } from '../src/components/admin/adminFooterApi';
import type { AdminTabBadges } from '../src/lib/adminTabBadges';

const Icon = (() => null) as unknown as React.ComponentType<{ className?: string }>;
const tabs = [
  { id: 'monitor', label: 'Monitor', icon: Icon },
  { id: 'users', label: 'Users', icon: Icon },
  { id: 'userreports', label: 'User Reports', icon: Icon },
  { id: 'security', label: 'Security', icon: Icon },
];

describe('adminFooterItems — the console lends its strip, it does not copy it', () => {
  it('keeps the panel’s own order and labels, and carries the icon through', () => {
    const items = adminFooterItems(tabs, null);
    expect(items.map((i) => i.id)).toEqual(['monitor', 'users', 'userreports', 'security']);
    expect(items.map((i) => i.label)).toEqual(['Monitor', 'Users', 'User Reports', 'Security']);
    expect(items[0].icon).toBe(Icon);
  });

  it('formats a live badge exactly as the header strip does', () => {
    const badges = {
      users: { value: 0, of: 734, tone: 'neutral' },
      userreports: { value: 3, tone: 'attention' },
    } as unknown as AdminTabBadges;
    const items = adminFooterItems(tabs, badges);
    expect(items.find((i) => i.id === 'users')!.badge).toBe('0/734');
    expect(items.find((i) => i.id === 'userreports')!.badge).toBe('3');
  });

  it('🔒 draws NOTHING for anything unmeasured — never a zero', () => {
    // A `0` on a row like User Reports reads as "I looked, there is no work here", which is a claim
    // we have not earned when the source simply failed to load.
    const badges = { users: { value: null, of: null, tone: 'neutral' } } as unknown as AdminTabBadges;
    expect(adminFooterItems(tabs, badges).find((i) => i.id === 'users')!.badge).toBeNull();
    expect(adminFooterItems(tabs, null).every((i) => i.badge === null)).toBe(true);
    expect(adminFooterItems(tabs, undefined).every((i) => i.badge === null)).toBe(true);
  });

  it('only an ATTENTION badge above zero is hot', () => {
    const badges = {
      users: { value: 900, of: 900, tone: 'neutral' },      // healthy activity, never red
      userreports: { value: 2, tone: 'attention' },         // work waiting
      apkreports: { value: 0, tone: 'attention' },          // zero to-dos is good news, shown plainly
    } as unknown as AdminTabBadges;
    const all = adminFooterItems([...tabs, { id: 'apkreports', label: 'APK Reports', icon: Icon }], badges);
    expect(all.find((i) => i.id === 'users')!.hot).toBe(false);
    expect(all.find((i) => i.id === 'userreports')!.hot).toBe(true);
    expect(all.find((i) => i.id === 'apkreports')!.hot).toBe(false);
  });

  it('is total — an empty table gives an empty strip, not a crash', () => {
    expect(adminFooterItems([], null)).toEqual([]);
  });
});

describe('🔒 desktop is untouched by construction', () => {
  it('only mobile, and never in focus mode', () => {
    expect(adminMobileFooterActive('mobile', false)).toBe(true);
    expect(adminMobileFooterActive('desktop', false)).toBe(false);
    expect(adminMobileFooterActive('tablet', false)).toBe(false);
    expect(adminMobileFooterActive('mobile', true)).toBe(false);
  });

  it('answers the same question as the bar’s own condition, so the two cannot disagree', () => {
    // Mirrors `v3MobileFooterActive` deliberately: the header controls and their footer replacements
    // must never BOTH be hidden, which is only guaranteed while one function decides both.
    const nav = readFileSync('src/components/agentv3/v3FooterApi.ts', 'utf8');
    expect(nav).toContain("effectiveDeviceMode === 'mobile' && !focusMode");
  });
});

describe('🔒 the wiring — the half that rots', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const dash = readFileSync('src/components/AdminDashboard.tsx', 'utf8');

  it('the strip is shown only when the bar, the view AND a published api all agree', () => {
    expect(app).toContain("const adminStrip = showsGlobalMobileNav && activeView === 'admin' && !!adminFooterApi;");
  });

  it('🔴 touchAction is pan-x on the strip and stays `none` everywhere else', () => {
    // Without this the swipe the admin asked for is impossible, and with a blanket `pan-x` the
    // 2026-09-14 "drag up moves the whole app" bug comes back. One expression holds both.
    expect(app).toContain("touchAction: adminStrip ? 'pan-x' : 'none',");
  });

  it('🔴 the footer renders the console’s items and names no admin tab itself', () => {
    expect(app).toContain('adminFooterApi!.items.map');
    // The proof that it is a lend and not a copy: none of these words may appear in the footer file.
    for (const label of ['AI Engines', 'Build Reports', 'User Reports', 'APK Reports']) {
      expect(app.includes(label)).toBe(false);
    }
  });

  it('the admin branch is reached BEFORE the pro-chat branch, so it cannot be shadowed', () => {
    expect(app.indexOf('{adminStrip ? (')).toBeGreaterThan(-1);
    expect(app.indexOf('{adminStrip ? (')).toBeLessThan(app.indexOf("activeView === 'nbi_pro_chat' && v3FooterApi ? ("));
  });

  it('the console publishes its REAL state — one setActiveTab, not a second copy', () => {
    expect(dash).toContain('items: adminFooterItems(TABS, tabBadges)');
    expect(dash).toContain('activeId: activeTab');
    expect(dash).toContain('select: (id: string) => setActiveTab(id as TabId)');
  });

  it('⚠️ and publishes NULL on unmount, so logging out restores the ordinary bar', () => {
    expect(dash).toContain('useEffect(() => () => { onFooterApi?.(null); }, [onFooterApi]);');
  });

  it('the header strip stands down only while the footer has it, and survives on a wide screen', () => {
    expect(dash).toContain("mobileFooter ? 'hidden lg:flex' : 'flex'");
  });

  it('the active tab is scrolled back into view on a tab change, not on every render', () => {
    expect(app).toContain('[data-admin-tab-active="true"]');
    expect(app).toContain('}, [adminStrip, adminFooterApi?.activeId]);');
  });
});
