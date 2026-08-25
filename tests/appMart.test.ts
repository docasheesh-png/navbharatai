import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * APP MART (admin 2026-08-16) — item #1 of NAV_STORE_MASTER_PLAN.md Part B.
 *
 * Three changes, one purpose: the store was buried inside "Other" and looked broken when it had
 * apps in it. A store nobody arrives at has nothing to sell, and everything planned on top of it
 * (ads, creator earnings) needs an audience first — so this is the change every later one depends
 * on, which is why it is pinned rather than left to survive on good intentions.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the name is App Mart on every surface a user can see', () => {
  const surfaces = [
    'src/components/ide/NavAppStore.tsx',
    'src/components/agentv3/HostingChooser.tsx',
    'src/components/ide/PublishToNavStore.tsx',
    'src/components/ide/StoreBuildPanel.tsx',
    'src/server/AppContext/AppKnowledgeBase.ts',
  ];

  it.each(surfaces)('%s carries no user-visible "Nav App Store"', (path) => {
    // Comments are stripped: they are history, and rewriting them would add noise to every future
    // diff for no user-visible gain. Only strings a person can read are renamed.
    const src = read(path)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*(\/\/|\s\*).*$/gm, '');
    expect(src).not.toContain('Nav App Store');
  });

  it('the store screen introduces itself as App Mart', () => {
    const store = read('src/components/ide/NavAppStore.tsx');
    expect(store).toContain('>App Mart<');
  });

  it('every AI can still find it when a user says the OLD name', () => {
    // A rename that makes the thing unfindable is a regression wearing new paint.
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    expect(kb).toContain("'app mart'");
    expect(kb).toContain("'nav app store'");
  });
});

describe('App Mart is a Home tile, and the ONLY doorway', () => {
  it('the fifth card exists on the Home screen and opens the store view', () => {
    const home = read('src/components/home/HomeView.tsx');
    expect(home).toContain("id: 'appmart'");
    expect(home).toContain("title: 'App Mart'");
    expect(home).toContain('onOpenAppMart');
    expect(read('src/App.tsx')).toContain("onOpenAppMart={() => toggleTab('appstore')}");
  });

  it('the Home grid fits every card in one desktop row', () => {
    // Five cards needed xl:grid-cols-5; the Professionals card then moved into the Free chat's Mode
    // picker (admin 2026-08-25), so four cards get four columns — one row, no orphan.
    const home = read('src/components/home/HomeView.tsx');
    expect(home).toContain('xl:grid-cols-4');
    expect(home).not.toContain("id: 'professionals'");
  });

  it('it is NOT also a tile inside Other — one room, one door', () => {
    expect(read('src/components/home/homeToolGroups.ts')).not.toMatch(/id: 'appstore'/);
  });
});

describe('Browse is two labelled halves, and an empty half never says the store is empty', () => {
  const store = read('src/components/ide/NavAppStore.tsx');

  it('both halves are always headed, so neither can be mistaken for the other', () => {
    expect(store).toContain('Play instantly — runs in your browser, nothing to install');
    expect(store).toContain('Install on Android — real .apk apps');
  });

  it('THE BUG FROM THE ADMIN\'S SCREENSHOT: "No apps published yet" no longer sits under a listed app', () => {
    /**
     * Before: the instant-app list rendered above, and the APK list rendered its own empty state
     * below — so a store WITH an app in it displayed "No apps published yet" underneath, and the
     * whole screen read as broken. The store-wide empty state must now require BOTH halves to be
     * empty, and each half owns a message that is true of that half alone.
     */
    expect(store).toContain('webApps.length === 0 && apps.length === 0');
    expect(store).toContain('No instant apps yet');
    expect(store).toContain('No Android apps yet');
    expect(store).not.toContain('No apps published yet.');
  });

  it('the whole-store empty state invites, rather than apologises', () => {
    expect(store).toContain('App Mart is just getting started.');
  });
});

describe('the phone layout the admin drew: 2-up squares, App Mart 2x1 across the bottom', () => {
  const home = read('src/components/home/HomeView.tsx');

  it('the grid is TWO columns on a phone — not one card per row', () => {
    // Verified in a real Chromium at 390px: the four tiles measure 173x173 and App Mart 358x179.
    // One-per-row meant four scrolls before App Mart was even on screen — the opposite of promoting it.
    expect(home).toContain('grid-cols-2');
    expect(home).not.toContain('grid-cols-1 sm:grid-cols-2');
  });

  it('every card is a 1x1 square — a clean 2x2 on a phone', () => {
    // With five cards, App Mart lay 2x1 across the bottom of a 2x2 of squares (the admin's drawing).
    // With the Professionals card moved into the Mode picker (2026-08-25) there are four cards, and a
    // 2-wide App Mart would leave a one-square HOLE where the fifth card used to be — so it becomes
    // the fourth square and the phone grid closes back into a clean 2x2.
    expect(home).toContain("'aspect-square'");
    expect(home).not.toContain("aspect-[2/1]");
  });

  it('squares only work because the content shrinks with them', () => {
    // A square tile with a description and three feature bullets in it would overflow. These are the
    // rules that make the shape possible — remove one and the tile spills.
    expect(home).toContain('hidden sm:block text-[#8b949e]');   // description
    expect(home).toContain('hidden sm:flex flex-col gap-1.5');  // feature list
    expect(home).toContain('hidden sm:inline-block');            // badge
  });

  it('the full cards come back from sm up — this is a phone layout, not a downgrade', () => {
    expect(home).toContain("'sm:aspect-auto'");
  });

  it('button labels are SHORT on a phone, because a truncated label reads as a broken screen', () => {
    // "Explore Professionals" rendered as "EXPLORE PROF…" in a 1x1 tile — the finding that created
    // btnLabelShort. That card now lives in the Mode picker, but the rule stays for the cards left.
    expect(home).toContain("btnLabelShort: 'Free Chat'");
    expect(home).toContain('btnLabelShort ?? card.btnLabel');
  });

  it('ONLY the 2x1 tile carries an extra line — a square has no room for one', () => {
    /**
     * Admin: "poora description nahi chahiye, bas main main 1 ya 2 line kafi hai." Tried it on all
     * five and MEASURED: in a 158px square the line was clipped mid-word behind the button. On a
     * square the two lines are the title and the SUBTITLE, which already says what the card is
     * ("Free AI Chat", "Agentic App Builder") — a tagline there was both a duplicate and an
     * overflow. The wide tile has the room, so it alone gets the third line.
     *
     * Clean at 360, 390 and 430px, checked by asserting every element sits inside its tile and no
     * text is cut — the check that catches what `scrollHeight` on the container misses.
     */
    const taglines = home.match(/phoneTagline:/g) ?? [];
    expect(taglines, 'exactly one tile may carry a phone tagline').toHaveLength(1);
    expect(home).toMatch(/phoneTagline: 'Games & apps by other creators[^']*'/);
  });
});

describe('the WHOLE card is the button (admin 2026-08-16: "pure card me kahi bhi tap karne par open ho jaye")', () => {
  const home = read('src/components/home/HomeView.tsx');

  it('the card element itself is a button and carries the handler', () => {
    expect(home).toContain('<motion.button');
    expect(home).toContain('onClick={comingSoon ? undefined : (handler || onShowLogin)}');
  });

  it('the CTA is a LOOK, not a second click target', () => {
    /**
     * A <button> inside a <button> is invalid HTML and the click fires TWICE — the inner handler,
     * then the card's. So the CTA became a styled <span>. Verified in a real browser: zero nested
     * buttons on the page, and a tap on a DEAD area of the card (the empty space beside the icon)
     * opens the destination — which is the only proof that "anywhere on the card" is true.
     */
    expect(home).toContain('a LOOK, not a second click target');
    expect(home).not.toMatch(/<button\n\s+onClick=\{comingSoon/);
  });

  it('a button centres its text, so the card re-asserts text-left', () => {
    // Without this every card's contents would jump to the middle the moment it became a button.
    expect(home).toContain("'text-left w-full'");
  });

  it('the press feedback moved to the card, and a coming-soon card cannot be tapped', () => {
    expect(home).toContain("comingSoon ? 'cursor-not-allowed' : 'cursor-pointer active:scale-[0.98]'");
    expect(home).toContain('disabled={comingSoon}');
  });
});
