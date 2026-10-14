// THE THREE PAGES OF WALLET & BILLING — and how they map onto the state App.tsx already owns.
//
// Admin brief (2026-10-14): the wallet has exactly three primary pages — buy tokens, promo code and
// referral rewards, history. App.tsx keeps `activeBillingDetailTab` ('purchase' | 'gift' | 'use' |
// 'remaining') and other code sets it (the red-dot trail opens 'purchase'), so the three pages are a
// VIEW over that value rather than a second piece of state: nothing outside the panel had to change,
// and a deep link that used to open a tab still opens the matching page.
//
// PURE. No React, no I/O.

export const WALLET_TABS = ['buy', 'promo', 'history'] as const;
export type WalletTab = (typeof WALLET_TABS)[number];

/** The value App.tsx stores. Kept in step with `BillingDetailTab` in BillingPanel. */
export type WalletDetailTab = 'purchase' | 'gift' | 'use' | 'remaining';

export const WALLET_TAB_LABEL: Readonly<Record<WalletTab, string>> = Object.freeze({
  buy: 'Buy Tokens',
  promo: 'Promo Code',
  history: 'History',
});

/** Which page a stored tab value opens. Anything unknown opens Buy Tokens — the page that fixes an empty wallet. */
export function tabForDetail(detail: string | null | undefined): WalletTab {
  if (detail === 'gift') return 'promo';
  if (detail === 'remaining' || detail === 'use') return 'history';
  return 'buy';
}

/** The value to store when a page is chosen. */
export function detailForTab(tab: WalletTab): WalletDetailTab {
  if (tab === 'promo') return 'gift';
  if (tab === 'history') return 'remaining';
  return 'purchase';
}
