import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { WalletHeader, readableBalance } from '../src/components/wallet/WalletHeader';
import { buyAmountProblem, MAX_BUY_INR } from '../src/components/wallet/TokenPurchaseTab';

/**
 * A BALANCE THAT COULD NOT BE READ IS NOT ZERO (brief: "loading and network errors never produce
 * misleading zero balances"). The old screen printed `wallet?.tokenBalance ?? 0`.
 */
const render = (wallet: unknown, loading = false) => renderToStaticMarkup(createElement(WalletHeader, {
  wallet: wallet as never, loading, onRefresh: () => {}, active: 'buy', onSelect: () => {}, needsTopUp: false,
}));

describe('the balance', () => {
  it('a wallet that was never read shows "Could not load", not 0', () => {
    for (const w of [null, undefined]) {
      const html = render(w);
      expect(html).toContain('Could not load');
      expect(html).not.toContain('data-testid="wallet-balance"');
      expect(html).toContain('Try again');
    }
  });

  it('while loading it says so', () => {
    expect(render(null, true)).toContain('Loading…');
  });

  it('a wallet without a readable number is unread, a genuine 0 is shown as 0', () => {
    expect(readableBalance({} as never)).toBeNull();
    expect(readableBalance({ tokenBalance: null } as never)).toBeNull();
    expect(readableBalance({ tokenBalance: 'abc' } as never)).toBeNull();
    expect(readableBalance({ tokenBalance: 0 })).toBe(0);
    expect(render({ tokenBalance: 0 })).toContain('>0<');
  });

  it('prints a seven-digit balance whole, with Indian grouping', () => {
    expect(render({ tokenBalance: 1234567 })).toContain('12,34,567');
  });
});

describe('the amount box', () => {
  it('names what is wrong, and accepts the server range ₹1 – ₹9,99,999', () => {
    expect(buyAmountProblem('')).toMatch(/Enter/);
    expect(buyAmountProblem('abc')).toMatch(/Enter/);
    expect(buyAmountProblem('0')).toMatch(/smallest/);
    expect(buyAmountProblem(String(MAX_BUY_INR + 1))).toMatch(/largest/);
    expect(buyAmountProblem('1')).toBeNull();
    expect(buyAmountProblem('100')).toBeNull();
    expect(buyAmountProblem(String(MAX_BUY_INR))).toBeNull();
  });
});
