import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE DEAD BUDGET CONSOLE IS GONE, AND THE REAL OVERDRAFT FLOOR REMAINS (admin 2026-09-20).
 *
 * ⚠️ 2026-10-14: the "tiles come first / readable by construction" cases that used to live here pinned the
 * three-capsule row, which the wallet redesign REPLACED with the tab bar in `WalletHeader`. Their intent
 * (a control is either a solid brand fill wearing `text-on-accent`, or a themed surface wearing themed ink;
 * the balance is never truncated; every control is keyboard-reachable) is held for the new layout by
 * `tests/theWalletTabsFitAPhone.test.ts`. The two groups below are unrelated to the layout and are kept.
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
