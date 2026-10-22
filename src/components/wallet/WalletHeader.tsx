// THE WALLET'S TOP: the balance, and the three pages.
//
// 🔒 A BALANCE THAT COULD NOT BE READ IS NOT ZERO. `wallet` is null before the first load and after a
// failed one; the old screen printed `wallet?.tokenBalance ?? 0`, so a network error showed "0 tokens"
// — a confident, alarming lie on a money screen. Here an unread balance shows "—" and says so, with a
// retry; only a wallet that really answered shows a number (and a real 0 is shown as 0).
//
// The three tabs are the ONLY primary navigation. They stack icon over label so they fit a 320px phone
// without scrolling, and every target is at least 48px tall.

import { Clock, Gift, RefreshCw, ShoppingCart, Wallet } from 'lucide-react';
import { cn } from '../../lib/utils';
import { WALLET_TABS, WALLET_TAB_LABEL, type WalletTab } from '../../lib/walletTabs';
import { TOP_UP_DOT_LABEL } from '../../lib/walletNeedsTopUp';

const TAB_ICON: Record<WalletTab, typeof Wallet> = { buy: ShoppingCart, promo: Gift, history: Clock };

export interface WalletHeaderProps {
  /** The wallet document exactly as the server returned it, or null when it has not been read. */
  wallet: { tokenBalance?: unknown; freeTrialEnded?: unknown } | null | undefined;
  loading: boolean;
  onRefresh: () => void;
  active: WalletTab;
  onSelect: (tab: WalletTab) => void;
  needsTopUp: boolean;
}

/** The balance to print, or null when no real number is available. */
export function readableBalance(wallet: WalletHeaderProps['wallet']): number | null {
  const n = Number(wallet?.tokenBalance);
  return wallet && typeof wallet.tokenBalance !== 'undefined' && wallet.tokenBalance !== null && Number.isFinite(n) ? n : null;
}

export function WalletHeader({ wallet, loading, onRefresh, active, onSelect, needsTopUp }: WalletHeaderProps) {
  const balance = readableBalance(wallet);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-text" aria-hidden>
            <Wallet className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted">Your tokens</p>
            {balance === null ? (
              <p className="text-base font-bold text-warn" role="status">
                {loading ? 'Loading…' : 'Could not load'}
              </p>
            ) : (
              <p className="break-words text-2xl font-extrabold leading-tight text-ink" data-testid="wallet-balance">
                {balance.toLocaleString('en-IN')}
              </p>
            )}
            {/* The server sets this for an account that has never paid while the free program is paused. */}
            {wallet?.freeTrialEnded === true && (
              <p className="text-xs font-bold text-warn" data-testid="free-trial-ended">Free trial ended</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-line bg-raised px-3 text-xs font-bold text-ink transition-colors hover:bg-raised-hover disabled:opacity-50"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          {balance === null && !loading ? 'Try again' : 'Refresh'}
        </button>
      </div>

      <div role="tablist" aria-label="Wallet pages" className="grid grid-cols-3 gap-2" data-testid="wallet-tabs">
        {WALLET_TABS.map((tab) => {
          const Icon = TAB_ICON[tab];
          const selected = tab === active;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`wallet-tab-${tab}`}
              aria-selected={selected}
              aria-controls="wallet-panel"
              onClick={() => onSelect(tab)}
              className={cn(
                'relative flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border px-1.5 py-2 text-center transition-colors',
                selected ? 'border-accent bg-accent text-on-accent' : 'border-line bg-card text-ink hover:bg-raised',
              )}
            >
              {tab === 'buy' && needsTopUp && (
                <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger" />
              )}
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              <span className="w-full break-words text-xs font-bold leading-tight">{WALLET_TAB_LABEL[tab]}</span>
              {tab === 'buy' && needsTopUp && <span className="sr-only">{TOP_UP_DOT_LABEL}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
