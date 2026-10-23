import { afterEach, describe, expect, it } from 'vitest';
import { unifiedMargin, derivedPricePaise, unifiedWalletConfig, DEFAULT_UNIFIED_MARGIN } from './policy';
import { tieredMarkupUsd } from '../../AgentV3/providerRates';
import { hostingMarkupPct, hostingOverageInrPerGb } from '../../AgentV3/hostingCost';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('one central margin (owner: real cost × 2.5 everywhere)', () => {
  it('defaults to 2.5 with optional per-service override, bounded 1–10', () => {
    expect(DEFAULT_UNIFIED_MARGIN).toBe(2.5);
    expect(unifiedMargin('ai', {})).toBe(2.5);
    expect(unifiedMargin('build', { UNIFIED_WALLET_MARGIN: '3' })).toBe(3);
    expect(unifiedMargin('build', { UNIFIED_WALLET_MARGIN_BUILD: '2' })).toBe(2);
    expect(unifiedMargin('hosting', { UNIFIED_WALLET_MARGIN_BUILD: '2' })).toBe(2.5);
    expect(unifiedMargin('ai', { UNIFIED_WALLET_MARGIN: '0.5' })).toBe(2.5); // below cost refused
    expect(unifiedWalletConfig({}).buildMargin).toBe(2.5);
  });
  it('derived fixed prices are ceil(real × margin) in whole paise', () => {
    expect(derivedPricePaise(0.4, 2.5)).toBe(100);
    expect(derivedPricePaise(0.401, 2.5)).toBe(101);
    expect(derivedPricePaise(0, 2.5)).toBe(0);
  });
  it('flag OFF: AI markup curve and hosting prices exactly as main', () => {
    delete process.env.UNIFIED_WALLET_ENABLED;
    delete process.env.AGENTV3_MARKUP_SMALL; delete process.env.AGENTV3_MARKUP_LARGE; delete process.env.AGENTV3_MARKUP_THRESHOLD_USD;
    expect(tieredMarkupUsd(0.5)).toBe(2);          // ×4
    expect(tieredMarkupUsd(2)).toBe(7);            // $1×4 + $1×3
    expect(hostingMarkupPct({})).toBe(20);
    expect(hostingOverageInrPerGb({ NAVBHARAT_RATE_EGRESS_GIB: '0.12' }, 85)).toBe(20);
  });
  it('flag ON: builds/assistants/API = real × 2.5; hosting +150% and derived ₹/GB', () => {
    process.env.UNIFIED_WALLET_ENABLED = '1';
    expect(tieredMarkupUsd(0.5)).toBe(1.25);
    expect(tieredMarkupUsd(2, 'build')).toBe(5);
    const on = { UNIFIED_WALLET_ENABLED: '1' };
    expect(hostingMarkupPct(on)).toBe(150);
    expect(hostingOverageInrPerGb({ ...on, NAVBHARAT_RATE_EGRESS_GIB: '0.12' }, 85)).toBe(25.5); // 0.12×85×2.5
    expect(hostingOverageInrPerGb(on, 85)).toBe(20); // no egress meter → keep ₹20
  });
});
