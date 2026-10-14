import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { WALLET_TABS, WALLET_TAB_LABEL, tabForDetail, detailForTab } from '../src/lib/walletTabs';

/**
 * THREE PAGES, ONE TAB BAR, NOTHING CUT ON A 320px PHONE (wallet redesign, admin brief 2026-10-14).
 *
 * This REPLACES `theThreeCapsulesFitAPhone` and the layout half of `theWalletTilesAreReadable`, which
 * pinned the 2026-09-22 capsule row. Those cases existed because a layout cannot be measured by `tsc` or
 * `vitest`, so what is held is the set of SOURCE properties that produced the measured result. The
 * properties carry over; the markup they apply to is new:
 *
 *   • the balance is printed whole — never `truncate`d, wrapped instead (the "89,894 tok…" defect);
 *   • three tabs share the width equally with no horizontal scroll, label under icon so they fit at 320px;
 *   • every tap target is at least 44px;
 *   • colour is a token — a solid fill wears `text-on-accent`, a themed surface wears themed ink, never the
 *     other's clothes (the invisible-text bug);
 *   • a long value wraps rather than clipping.
 *
 * ⚠️ These hold SOURCE properties. The real-browser measurement at 320 / 360 / 375 / 390 / 430px is reported
 * in the PR description — a layout is not proved by a regex alone, and this file says so rather than
 * pretending otherwise.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

const FILES: Record<string, string> = {
  header: 'src/components/wallet/WalletHeader.tsx',
  buy: 'src/components/wallet/TokenPurchaseTab.tsx',
  promo: 'src/components/wallet/PromoRewardsTab.tsx',
  friends: 'src/components/wallet/ReferredFriendsList.tsx',
  history: 'src/components/panels/WalletStatementPanel.tsx',
  referral: 'src/components/panels/ReferralPanel.tsx',
  panel: 'src/components/panels/BillingPanel.tsx',
};
const SRC: Record<string, string> = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, strip(read(f))]));

/** The open tag that starts at `from` (`<button …>`), read to its closing `>` — arrow functions' `=>` skipped. */
function openTag(src: string, from: number): string {
  let depth = 0;
  let quote = '';
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0 && src[i - 1] !== '=') return src.slice(from, i + 1);
  }
  return src.slice(from);
}

function tags(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(openTag(src, m.index));
  return out;
}

describe('exactly three primary pages, in the order a person needs them', () => {
  it('the tabs are Buy Tokens, Promo Code, History — and no fourth', () => {
    expect(WALLET_TABS).toEqual(['buy', 'promo', 'history']);
    expect(WALLET_TAB_LABEL).toEqual({ buy: 'Buy Tokens', promo: 'Promo Code', history: 'History' });
  });

  it('every value App.tsx can store opens a page, and each page stores a value that reopens it', () => {
    for (const d of ['purchase', 'gift', 'use', 'remaining', 'garbage', '', null, undefined]) {
      expect(WALLET_TABS).toContain(tabForDetail(d as string));
    }
    for (const t of WALLET_TABS) expect(tabForDetail(detailForTab(t))).toBe(t);
    // An unknown value opens Buy Tokens: the page that fixes an empty wallet.
    expect(tabForDetail('nonsense')).toBe('buy');
  });

  it('the old "three doors" header is gone — one navigation, not two competing ones', () => {
    expect(SRC.panel).not.toContain('WalletDoors');
    expect(existsSync(join(__dirname, '..', 'src/components/panels/WalletDoors.tsx'))).toBe(false);
  });

  it('the panel renders the header (balance + tab bar) before any page, and a page only under its tab', () => {
    const p = SRC.panel;
    const header = p.indexOf('<WalletHeader');
    for (const [marker, page] of [["tab === 'buy'", '<TokenPurchaseTab'], ["tab === 'promo'", '<PromoRewardsTab'], ["tab === 'history'", '<WalletStatementPanel']] as const) {
      const at = p.indexOf(marker);
      expect(at, marker).toBeGreaterThan(header);
      expect(p.indexOf(page), page).toBeGreaterThan(at);
    }
  });
});

describe('the tab bar fits the narrowest phone', () => {
  const bar = SRC.header.slice(SRC.header.indexOf('role="tablist"') - 40);

  it('three equal columns, and no horizontal scroll', () => {
    expect(bar).toContain('grid grid-cols-3');
    const barTag = openTag(bar, bar.indexOf('<div'));
    expect(barTag).not.toContain('overflow-x');
  });

  it('icon above label, so three labels fit in ~100px each at 320px', () => {
    expect(bar).toContain('flex-col');
    expect(bar).toContain('min-w-0');
    expect(bar).toMatch(/break-words/);
  });

  it('is an accessible tablist with a selected state', () => {
    expect(bar).toContain('role="tablist"');
    expect(bar).toContain('role="tab"');
    expect(bar).toContain('aria-selected={selected}');
  });
});

describe('🔒 the balance is printed whole and is never a confident zero', () => {
  it('the balance wraps, never truncates', () => {
    const at = SRC.header.indexOf('data-testid="wallet-balance"');
    expect(at).toBeGreaterThan(-1);
    const tag = openTag(SRC.header, SRC.header.lastIndexOf('<p', at));
    expect(tag).toContain('break-words');
    expect(tag).not.toMatch(/\btruncate\b/);
    expect(SRC.header).not.toMatch(/\btruncate\b/);
  });

  it('an unread balance is not rendered as 0', () => {
    // The old screen printed `wallet?.tokenBalance ?? 0`, so a failed load showed "0 tokens".
    for (const k of Object.keys(SRC)) expect(SRC[k], k).not.toMatch(/tokenBalance\s*\?\?\s*0/);
    expect(SRC.header).toContain('Could not load');
  });
});

describe('every tap target is at least 44px', () => {
  for (const [name, src] of Object.entries(SRC)) {
    it(`${name}: every <button> carries a min-h of 44px or more`, () => {
      const bad = tags(src, 'button').filter((t) => !/min-h-\[(4[4-9]|[5-9]\d)px\]/.test(t));
      expect(bad.map((t) => t.replace(/\s+/g, ' ').slice(0, 140))).toEqual([]);
    });
  }
});

describe('colour comes from tokens, and a fill wears its own label colour', () => {
  const literal = /\b(?:bg|text|border|ring|from|to|via)-(?:red|green|emerald|amber|yellow|orange|indigo|violet|purple|sky|blue|cyan|teal|gray|slate|zinc|neutral|stone|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[0-9a-fA-F]{3,8}\b/;
  for (const [name, src] of Object.entries(SRC)) {
    it(`${name}: no colour literal`, () => {
      const hits = src.split('\n').filter((l) => literal.test(l) && !l.trim().startsWith('import'));
      expect(hits.map((l) => l.trim().slice(0, 120))).toEqual([]);
    });
  }

  it('🔒 `text-on-accent` appears only on a solid accent fill — never on a themed surface', () => {
    for (const [name, src] of Object.entries(SRC)) {
      for (const line of src.split('\n')) {
        if (!line.includes('text-on-accent')) continue;
        // The selected state of a toggled control carries the fill on the same expression.
        expect(line, `${name}: ${line.trim().slice(0, 120)}`).toMatch(/bg-accent/);
      }
    }
  });
});

describe('a long value wraps instead of clipping', () => {
  it('a long code or reference breaks rather than overflowing the card', () => {
    expect(SRC.referral).toContain('break-all font-mono text-2xl');
    expect(SRC.buy).toContain('break-all');
    expect(SRC.friends).toContain('break-all');
    expect(SRC.promo).toContain('break-all');
  });

  it('the page clears the app bottom bar and the home indicator', () => {
    expect(SRC.panel).toContain('--nb-safe-below');
  });
});
