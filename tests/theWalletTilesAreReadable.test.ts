import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE WALLET TILES: FIRST, AND READABLE — and the dead budget console is gone (admin 2026-09-20).
 *
 * Three instructions in one message, with one screenshot each:
 *   • *"sabse upar yeh tile … sabse upar aani chahiye"*
 *   • *"background opposite colour me karo ya text me border banao, kuch bhi karo. bas clear hona
 *     chahiye!"*
 *   • *"yeh budget warning system kaam to karta nahi hai! isko jad se khatam karo!"*
 *
 * 🔴 THE COLOUR BUG HAD ONE CAUSE, AND IT IS WORTH NAMING BECAUSE IT RECURS: every tile was written
 * for a DARK-ONLY app — a `from-emerald-950/50` gradient into `to-card`, with `text-on-accent` on
 * top. `text-on-accent` is WHITE by definition; it is the label colour for a SOLID brand fill. The
 * fill under it was the themed card, which on Light is near-white. White on near-white.
 *
 * So the invariant these tests hold is not "use nice colours". It is: a tile is EITHER a solid brand
 * fill wearing `text-on-accent`, OR a themed surface wearing themed ink — never one in the other's
 * clothes.
 *
 * 🔴 AND THE CONSOLE WAS NOT MERELY UNUSED — IT LIED. Its own copy read "at this limit the system
 * automatically switches you to Free-version mode", while both numbers lived in `localStorage` and
 * reached no server, no build gate and no debit. Read from the source, so re-introducing any half of
 * it turns this red.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

const PANEL = stripComments(read('src/components/panels/BillingPanel.tsx'));
const HOOK = stripComments(read('src/hooks/usePaymentEngine.ts'));
const APP = stripComments(read('src/App.tsx'));

/**
 * The three tiles, as they really appear in the source, in order.
 *
 * ⚠️ Every marker here is CODE, never a `{/* … *\/}` comment: the sources are read with comments
 * stripped (the removal notes quote the very sentence other cases assert is gone), so a comment
 * marker would resolve to -1 and the slice would silently become the whole file.
 */
const DETAIL_PANEL = 'bg-card border border-line rounded-[2.5rem] p-6 sm:p-8 shadow-3xl';
const tileBlock = (): string => {
  const from = PANEL.indexOf('<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">');
  const to = PANEL.indexOf(DETAIL_PANEL, from);
  expect(from, 'the tile grid').toBeGreaterThan(-1);
  expect(to, 'the detail panel after it').toBeGreaterThan(from);
  return PANEL.slice(from, to);
};

describe('the tiles come FIRST — that was the whole instruction', () => {
  it('the tile grid sits above the daily-usage, plan and monthly-cost blocks', () => {
    const tiles = PANEL.indexOf('<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">');
    const usage = PANEL.indexOf("Today's Messages");
    const plans = PANEL.indexOf('<HostingPlanCard');
    const cost = PANEL.indexOf("This Month's AI Cost");
    for (const [name, at] of [['daily usage', usage], ['plans', plans], ['monthly cost', cost]] as const) {
      expect(at, name).toBeGreaterThan(-1);
      expect(tiles, `tiles must precede ${name}`).toBeLessThan(at);
    }
  });

  it('the detail panel the tiles switch stays directly under them, not pages away', () => {
    const tiles = PANEL.indexOf('<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">');
    const detail = PANEL.indexOf(DETAIL_PANEL);
    const usage = PANEL.indexOf("Today's Messages");
    expect(detail).toBeGreaterThan(tiles);
    expect(detail, 'tapping a tile must not appear to do nothing').toBeLessThan(usage);
  });

  it('Buy tokens leads, whatever the source order', () => {
    expect(tileBlock()).toContain('order-first');
  });
});

describe('🔴 readable by construction — no tile wears the other kind of label', () => {
  const tiles = () => tileBlock();

  it('the one SOLID tile carries the solid-fill label colour', () => {
    const block = tiles();
    const buy = block.slice(block.indexOf('order-first'), block.indexOf('data-tour="billing"'));
    expect(buy).toContain('bg-emerald-700');
    expect(buy).toContain('text-on-accent');
  });

  it('🔒 a tile on the THEMED card surface never uses `text-on-accent` — that is the invisible-text bug', () => {
    const block = tiles();
    // Every element that declares the card surface must not also declare the solid-fill ink.
    for (const line of block.split('\n')) {
      if (line.includes('bg-card')) {
        expect(line, `white ink on the themed card: ${line.trim()}`).not.toContain('text-on-accent');
      }
    }
  });

  it('🔒 no dark 900/950 tint survives — the theme cannot lighten one, so it is a Light defect', () => {
    expect(tiles()).not.toMatch(/(from|to|via|bg)-[a-z]+-9[0-5]0\//);
  });

  it('the balance is never truncated again — a full-width tile has room for the number', () => {
    const block = tiles();
    const balanceLine = block.split('\n').find((l) => l.includes('tokenBalance'));
    expect(balanceLine).toBeTruthy();
    expect(balanceLine!, 'the number this screen exists to show').not.toContain('truncate');
  });

  it('one per row on a phone, three across above it — not four squeezed into two columns', () => {
    expect(PANEL).toContain('grid grid-cols-1 sm:grid-cols-3 gap-4');
    expect(PANEL).not.toContain('grid grid-cols-2 md:grid-cols-4');
  });

  it('every tile is reachable by keyboard, not a bare clickable div', () => {
    const block = tiles();
    expect(block.match(/role="button"/g)?.length).toBe(3);
    expect(block.match(/onKeyDown=/g)?.length).toBe(3);
    expect(block.match(/focus-visible:ring-2/g)?.length).toBe(3);
  });
});

describe('🔴 the budget/reminder system is gone at the root, not hidden', () => {
  it('no screen still reads or writes the two localStorage keys', () => {
    for (const src of [PANEL, HOOK, APP]) {
      expect(src).not.toContain('navbharat_reminder_limit');
      expect(src).not.toContain('navbharat_budget_limit');
    }
  });

  it('the state, the props and the tab value are all removed', () => {
    for (const [name, src] of [['panel', PANEL], ['hook', HOOK], ['app', APP]] as const) {
      expect(src, name).not.toMatch(/\breminderLimit\b/);
      expect(src, name).not.toMatch(/\bbudgetLimit\b/);
      expect(src, name).not.toMatch(/\bdismissedReminderWarning\b/);
    }
    expect(PANEL).toContain("type BillingDetailTab = 'purchase' | 'gift' | 'use' | 'remaining';");
  });

  it('🔒 the sentence that was false is nowhere in the app', () => {
    // "At this limit the system automatically switches you to Free-version mode" — nothing did.
    expect(PANEL).not.toMatch(/Free-version mode/i);
    expect(PANEL).not.toMatch(/Safety & Threshold/i);
    expect(PANEL).not.toMatch(/Autonomous SRE Controls/i);
  });

  it('the tile that displayed those limits is gone too', () => {
    expect(PANEL).not.toMatch(/LIMIT ACTIVE/);
    expect(PANEL).not.toMatch(/FREE MODE/);
  });
});

describe('what actually bounds a negative balance is untouched', () => {
  it('the server-side overdraft floor still exists and is still applied inside the debit', () => {
    const floor = read('src/server/lib/walletFloor.ts');
    expect(floor).toContain('WALLET_OVERDRAFT_FLOOR_INR');
    // The removal above took away a control that enforced nothing; this one enforces.
    const mirror = read('src/server/lib/walletMirror.ts') + read('src/server/lib/walletDebit.ts');
    expect(mirror).toMatch(/walletFloor|overdraftFloor/i);
  });
});
