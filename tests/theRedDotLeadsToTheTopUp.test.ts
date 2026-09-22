/**
 * "AGAR BALANCE KHATAM HAI, TO ☰ MENU → WALLET AND BILLING → BUY TOKEN → PURCHAGE WALLET TOKEN PAR
 * EK RED DOT SHOW HONA CHAHIYE!" — admin, 2026-09-22.
 *
 * A TRAIL, not a badge: four marks that walk a blocked user to the one control that unblocks them.
 * What makes it a trail rather than four coincidences is that all four ask ONE predicate — so a dot
 * cannot lead to a screen where it has quietly vanished, which is exactly how a trail loses a user.
 *
 * ⚠️ HALF OF THIS IS SOURCE-LEVEL, DELIBERATELY. `tsc` and `vitest` cannot see that a dot was wired
 * on the desktop rail and forgotten on the mobile drawer — and the drawer is the one the ☰ button
 * actually opens, so that miss would have shipped the feature working nowhere it was asked for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { walletNeedsTopUp, walletBalanceInr, TOP_UP_DOT_LABEL } from '../src/lib/walletNeedsTopUp';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('when the dot appears', () => {
  it('an empty wallet raises it', () => {
    expect(walletNeedsTopUp({ wallet: { remaining_balance: 0, tokenBalance: 0 } })).toBe(true);
  });

  it('a wallet in debt raises it too — the refusal fires there as well', () => {
    expect(walletNeedsTopUp({ wallet: { remaining_balance: -12.5, tokenBalance: 0 } })).toBe(true);
  });

  it('a wallet with money does NOT', () => {
    expect(walletNeedsTopUp({ wallet: { remaining_balance: 50, tokenBalance: 5000 } })).toBe(false);
    // One paisa is still money, and the server would still serve the turn.
    expect(walletNeedsTopUp({ wallet: { remaining_balance: 0.01, tokenBalance: 0 } })).toBe(false);
  });

  it('🔴 A GIFTED WALLET IS NOT AN EMPTY ONE — the ₹-only view has been wrong before', () => {
    // admin 2026-08-03: "₹0 + 50,000 tokens → app building off". Reading `remaining_balance` alone
    // would paint a red "no money" dot across the whole app for every brand-new account on the
    // interim ₹50 welcome credit, whose token view is the one that carries it.
    expect(walletNeedsTopUp({ wallet: { remaining_balance: 0, tokenBalance: 5000 } })).toBe(false);
    expect(walletBalanceInr({ remaining_balance: 0, tokenBalance: 5000 })).toBe(50);
    // And the mirror case: ₹ present, token view missing.
    expect(walletNeedsTopUp({ wallet: { remaining_balance: 50 } })).toBe(false);
  });
});

describe('🔒 silent on every doubt — a dot that is wrong once is a dot nobody reads again', () => {
  it('says nothing while the wallet is loading', () => {
    expect(walletNeedsTopUp({ wallet: { remaining_balance: 0, tokenBalance: 0 }, loading: true })).toBe(false);
  });

  it('says nothing when there is no wallet at all (signed out, or not fetched yet)', () => {
    expect(walletNeedsTopUp({})).toBe(false);
    expect(walletNeedsTopUp({ wallet: null })).toBe(false);
    expect(walletNeedsTopUp({ wallet: undefined })).toBe(false);
  });

  it('says nothing when the balance cannot be read from the object it was given', () => {
    expect(walletNeedsTopUp({ wallet: {} })).toBe(false);
    expect(walletNeedsTopUp({ wallet: { remaining_balance: 'nothing' } })).toBe(false);
    expect(walletNeedsTopUp({ wallet: { remaining_balance: Number.NaN, tokenBalance: Number.NaN } })).toBe(false);
    expect(walletNeedsTopUp({ wallet: 'wallet' })).toBe(false);
    expect(walletBalanceInr(null)).toBeNull();
  });
});

describe('🔒 the trail — all four steps, one predicate', () => {
  it('App.tsx computes it ONCE and passes it down', () => {
    const app = src('src/App.tsx');
    expect(app).toContain("from './lib/walletNeedsTopUp'");
    expect(app).toContain('const needsTopUp = walletNeedsTopUp({ wallet, loading: loadingWallet });');
    // Both navigation surfaces get the same value — not two computations that can drift.
    expect(app.match(/walletNeedsTopUp=\{needsTopUp\}/g) ?? []).toHaveLength(2);
  });

  it('STEP 1 — the ☰ button raises its existing dot for a finished balance', () => {
    const nav = src('src/components/panels/TopNav.tsx');
    expect(nav).toContain('walletNeedsTopUp?: boolean;');
    expect(nav).toContain('const menuNeedsAttention = unreadNotifications > 0 || walletNeedsTopUp;');
    // ONE dot with two reasons, never two dots: the user has one problem to act on.
    expect(nav.match(/rounded-full bg-danger/g) ?? []).toHaveLength(1);
    // And the label must say which, or a screen reader announces a mark with no meaning.
    expect(nav).toContain('balance finished');
  });

  it('🔴 STEP 2 — BOTH the desktop rail AND the mobile drawer, because ☰ opens the drawer', () => {
    const side = src('src/components/panels/SidebarNav.tsx');
    // Two NavItem render sites exist; a dot wired on one of them is a feature that works nowhere
    // the admin asked for it — the ☰ button is a phone control.
    expect(side.match(/needsAttention=\{walletNeedsTopUp && item\.id === 'billing'\}/g) ?? []).toHaveLength(2);
    expect(side).toContain('attentionLabel={TOP_UP_DOT_LABEL}');
    // It is the Wallet & Billing row and no other.
    expect(side).not.toMatch(/needsAttention=\{walletNeedsTopUp\}\s*$/m);
  });

  it('STEPS 3 and 4 — the Buy tokens tile and the Purchase button, from the same predicate', () => {
    const bill = src('src/components/panels/BillingPanel.tsx');
    expect(bill).toContain("from '../../lib/walletNeedsTopUp'");
    // Read from the wallet this panel already holds — no second fetch, no second source of truth.
    expect(bill).toContain('const needsTopUp = walletNeedsTopUp({ wallet, loading: loadingWallet });');
    // 🔴 THE DOT IS DRAWN TWICE, AND NEITHER MAY SIT INSIDE SOMETHING A PHONE HIDES. The capsule
    // row (2026-09-22) stands its icon chip down below `sm` — it is the widest thing in the row
    // that carries no information — and the first draft put the dot inside that chip, which
    // removed it from every phone, i.e. from exactly the screens where a ₹0 balance matters most.
    // Caught by measurement before it shipped; held here so it cannot come back.
    const dots = bill.match(/needsTopUp && <span aria-hidden className="[^"]*rounded-full bg-danger" \/>/g) ?? [];
    expect(dots).toHaveLength(2);
    for (const dot of dots) {
      // The CLASS LIST only — `aria-hidden` is the attribute that makes the dot decorative beside
      // its own `sr-only` words, and must not be confused with the `hidden` display utility.
      const classes = (dot.match(/className="([^"]*)"/)?.[1] ?? '').split(/\s+/);
      const hides = classes.filter((c) => c === 'hidden' || c.endsWith(':hidden'));
      expect(hides, `a dot that a phone hides is not a warning: ${dot}`).toEqual([]);
    }
    // The capsule's dot is positioned off the CAPSULE, which is why the capsule is `relative`.
    expect(bill).toContain('absolute top-1.5 right-2 w-2 h-2 rounded-full bg-danger');
    expect(bill).toMatch(/"relative flex-1 min-w-fit/);
    expect(bill).toContain('Purchase Wallet Tokens');
  });

  it('the dot carries words everywhere it is drawn', () => {
    expect(TOP_UP_DOT_LABEL).toMatch(/balance/i);
    expect(TOP_UP_DOT_LABEL).toMatch(/add credit/i);
    // White-label: a balance notice never names a vendor.
    expect(TOP_UP_DOT_LABEL.toLowerCase()).not.toMatch(/glm|kimi|claude|gemini|grok|openai/);
  });
});
