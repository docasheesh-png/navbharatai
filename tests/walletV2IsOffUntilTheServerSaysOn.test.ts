import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { parsePublicFlags, PUBLIC_FLAGS_OFF } from '../src/lib/publicFlags';
import { publicFlags } from '../src/server/lib/publicFlags';
import { WalletDoors } from '../src/components/panels/WalletDoors';

describe('WALLET_V2_UI wiring', () => {
  afterEach(() => { delete process.env.WALLET_V2_UI; delete process.env.PLAN_MODEL_PRO; delete process.env.BYO_LIFECYCLE_V1; });
  it('server flags default off', () => {
    expect(publicFlags()).toEqual({ walletV2Ui: false, planModelPro: false, byoLifecycle: false });
    process.env.WALLET_V2_UI = 'on';
    expect(publicFlags().walletV2Ui).toBe(true);
  });
  it('the browser treats anything but literal true as off', () => {
    expect(parsePublicFlags(null)).toEqual(PUBLIC_FLAGS_OFF);
    expect(parsePublicFlags({ walletV2Ui: 'true', planModelPro: 1 })).toEqual(PUBLIC_FLAGS_OFF);
    expect(parsePublicFlags({ walletV2Ui: true }).walletV2Ui).toBe(true);
  });
  it('doors render three buttons', () => {
    const html = renderToStaticMarkup(createElement(WalletDoors, { active: 'buy_services', onSelect: () => {} }));
    expect(html.match(/<button/g)?.length).toBe(3);
  });
});
