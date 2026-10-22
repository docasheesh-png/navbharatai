import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { parsePublicFlags, PUBLIC_FLAGS_OFF } from '../src/lib/publicFlags';
import { publicFlags } from '../src/server/lib/publicFlags';
import { WalletHeader } from '../src/components/wallet/WalletHeader';

describe('WALLET_V2_UI wiring', () => {
  afterEach(() => { delete process.env.WALLET_V2_UI; delete process.env.PLAN_MODEL_PRO; delete process.env.BYO_LIFECYCLE_V1; });
  it('server flags default off', () => {
    expect(publicFlags()).toEqual({ walletV2Ui: false, planModelPro: false, byoLifecycle: false, freeProgramPaused: false });
    process.env.WALLET_V2_UI = 'on';
    expect(publicFlags().walletV2Ui).toBe(true);
  });
  it('the browser treats anything but literal true as off', () => {
    expect(parsePublicFlags(null)).toEqual(PUBLIC_FLAGS_OFF);
    expect(parsePublicFlags({ walletV2Ui: 'true', planModelPro: 1 })).toEqual(PUBLIC_FLAGS_OFF);
    expect(parsePublicFlags({ walletV2Ui: true }).walletV2Ui).toBe(true);
  });
  it('the wallet header renders the balance and exactly three page tabs (the "doors" were replaced)', () => {
    const html = renderToStaticMarkup(createElement(WalletHeader, {
      wallet: { tokenBalance: 12345 }, loading: false, onRefresh: () => {}, active: 'buy', onSelect: () => {}, needsTopUp: false,
    }));
    expect(html.match(/role="tab"/g)?.length).toBe(3);
    expect(html).toContain('12,345');
    expect(html).toContain('Buy Tokens');
    expect(html).toContain('Promo Code');
    expect(html).toContain('History');
  });
});
