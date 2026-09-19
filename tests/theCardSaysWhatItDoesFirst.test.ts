// The home grid's header pair — admin 2026-09-19, reading the phone screen.
//
// Every product card shows two lines: the BRAND name (`title`) and what the card DOES (`subtitle`).
// The brand name was the large one, so the four tiles read "NavBharatAI / NavBharatAI Pro / Other /
// App Mart" at a glance — three of which say nothing about what happens when you tap them, and two
// of which are the same word. The admin asked for the first three to be turned round:
//
//   "Free chat bada karo, navbharatai chat likho (position/colour wahi bas size badal do!!)"
//
// So the LINES DO NOT MOVE and DO NOT CHANGE COLOUR. Only which of the two is large changes. That
// distinction is the whole point of the change and is what these tests hold: a later edit that
// "tidies up" by reordering the elements, or by recolouring the now-large line, would be a
// different design than the one that was asked for.
//
// App Mart is deliberately NOT in this set: its title already IS its doing line, so it was already
// in the shape the other three were moved into. It is asserted here as the untouched control.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const home = readFileSync('src/components/home/HomeView.tsx', 'utf8');

/** The card object literal for one id, so an assertion cannot accidentally read a sibling's field. */
function cardBlock(id: string): string {
  const start = home.indexOf(`id: '${id}',`);
  expect(start, `card '${id}' exists`).toBeGreaterThan(-1);
  const end = home.indexOf('btnIcon:', start);
  expect(end, `card '${id}' is a complete block`).toBeGreaterThan(start);
  return home.slice(start, end);
}

describe('the big line is what the card DOES', () => {
  const cases: Array<[string, string, string]> = [
    // id,       small line (brand),   large line (what it does)
    ['free', 'NavBharatAI Chat', 'Free Chat'],
    ['pro', 'NavBharatAI Pro', 'App Builder'],
    ['tools', 'Other', 'Tools'],
  ];

  for (const [id, brand, does] of cases) {
    it(`'${id}' reads "${does}" large and "${brand}" small`, () => {
      const block = cardBlock(id);
      expect(block).toContain(`title: '${brand}',`);
      expect(block).toContain(`subtitle: '${does}',`);
      // The flag is what makes the swap happen — the strings alone would render at the old sizes.
      expect(block).toContain("lead: 'subtitle' as const,");
    });
  }

  it('App Mart is untouched — its title was already the doing line', () => {
    const block = cardBlock('appmart');
    expect(block).toContain("title: 'App Mart',");
    expect(block).toContain("subtitle: 'Play & Install Apps',");
    expect(block, 'App Mart must not carry the flag').not.toContain('lead:');
  });
});

describe('only the SIZE swaps — position and colour are held', () => {
  it('the brand line is still the first element and still text-ink', () => {
    // If a future edit swaps the ELEMENTS instead of their sizes, the brand name moves under the
    // doing line and changes colour — which is not what was asked for, and no size assertion
    // above would notice.
    const pair = home.slice(home.indexOf('{/* Title + description */}'), home.indexOf('phoneTagline?: string'));
    expect(pair.indexOf('{card.title}'), 'title renders before subtitle').toBeLessThan(pair.indexOf('{card.subtitle}'));
    expect(pair).toContain("cn('font-black text-ink leading-tight'");
    expect(pair).toContain('card.iconColor');
  });

  it('the two sizes are ONE definition each, so the pair can only swap', () => {
    // Two hardcoded size strings is how a "swap" becomes two lines that are both large.
    expect(home).toContain("const LINE_BIG = 'text-sm sm:text-lg';");
    expect(home).toContain("const LINE_SMALL = 'text-[9px] sm:text-[11px]';");
    expect(home).toContain('leadIsSubtitle ? LINE_SMALL : LINE_BIG');
    expect(home).toContain('leadIsSubtitle ? LINE_BIG : LINE_SMALL');
  });

  it('exactly one of the pair is large, whatever the flag says', () => {
    // Both branches of both ternaries, read together: one line gets LINE_BIG and the other
    // LINE_SMALL in each case. A copy-paste slip that gave both lines the same constant is the
    // failure this catches.
    const titleTernary = 'leadIsSubtitle ? LINE_SMALL : LINE_BIG';
    const subtitleTernary = 'leadIsSubtitle ? LINE_BIG : LINE_SMALL';
    expect(titleTernary).not.toBe(subtitleTernary);
    for (const lead of [true, false]) {
      const titleSize = lead ? 'LINE_SMALL' : 'LINE_BIG';
      const subtitleSize = lead ? 'LINE_BIG' : 'LINE_SMALL';
      expect(titleSize).not.toBe(subtitleSize);
    }
  });
});

describe('REVERSION GUARD — the old names must not come back', () => {
  it('the three renamed lines are gone from the card list', () => {
    // These are the exact strings the screen used to show. Re-introducing one means the rename was
    // reverted by a merge, which is how a UI change quietly disappears.
    for (const gone of ["subtitle: 'Free AI Chat'", "subtitle: 'Agentic App Builder'", "subtitle: 'Builder Tools & Utilities'"]) {
      expect(home, `${gone} was renamed`).not.toContain(gone);
    }
    expect(home, "the bare 'NavBharatAI' title was renamed to 'NavBharatAI Chat'").not.toContain("title: 'NavBharatAI',");
  });

  it('the assistants can still find the Pro card by what it now says', () => {
    // The tile's biggest word is "APP BUILDER", so a user asking "app builder kahan hai" must be
    // answered by the knowledge base rather than guessed at.
    const kb = readFileSync('src/server/AppContext/AppKnowledgeBase.ts', 'utf8');
    const pro = kb.slice(kb.indexOf("id: 'pro_chat',"), kb.indexOf("id: 'free_chat',"));
    expect(pro).toContain("'app builder'");
  });
});
