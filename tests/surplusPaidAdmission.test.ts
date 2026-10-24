import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { SurplusBuildSession } from '../src/server/AI/SurplusRegistry/buildSession';

const mocks = vi.hoisted(() => ({ wallet: vi.fn(), estimate: vi.fn(), warn: vi.fn(), healthy: vi.fn(), audit: vi.fn(), db: vi.fn() }));
vi.mock('../src/server/AgentV3/WalletBalance', async importOriginal => ({
  ...await importOriginal<typeof import('../src/server/AgentV3/WalletBalance')>(),
  firestoreWalletReader: () => mocks.wallet,
}));
vi.mock('../src/server/AgentV3/PreflightEstimate', async importOriginal => ({
  ...await importOriginal<typeof import('../src/server/AgentV3/PreflightEstimate')>(),
  estimateBuildCost: mocks.estimate,
}));
vi.mock('../src/server/lib/serverDb', async importOriginal => ({
  ...await importOriginal<typeof import('../src/server/lib/serverDb')>(), getServerDb: mocks.db,
}));
vi.mock('../src/server/lib/balanceAlert', () => ({ warnAboutBalance: mocks.warn, balanceLooksHealthy: mocks.healthy }));
vi.mock('../src/server/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('../src/server/lib/UsdInrRate', async importOriginal => ({
  ...await importOriginal<typeof import('../src/server/lib/UsdInrRate')>(), usdInrRate: () => 100,
}));
import { checkBuilderPaidAdmission } from '../src/server/routes/agentv3';

function context(overrides: Partial<Parameters<typeof checkBuilderPaidAdmission>[0]> = {}) {
  const json = vi.fn(), status = vi.fn(); status.mockReturnValue({ json });
  const release = vi.fn(), onFreeTier = vi.fn(), onEconomy = vi.fn();
  const input: Parameters<typeof checkBuilderPaidAdmission>[0] = {
    userId: 'synthetic-paid-user', email: null, onlyOpus: false, prompt: 'Explain this app',
    powerLevelReqEffective: 'off', res: { status } as unknown as Response, release, onFreeTier, onEconomy, ...overrides,
  };
  return { input, status, json, release, onFreeTier, onEconomy };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AGENTV3_PAID_PUBLIC', 'true'); vi.stubEnv('AGENTV3_CREDIT_GATE', 'false');
  vi.stubEnv('AGENTV3_FREE_LIST', ''); vi.stubEnv('AGENTV3_ALLOWLIST', '');
  mocks.wallet.mockResolvedValue({ remaining_balance: 200, totalMoneySpent: 500 });
  mocks.estimate.mockReturnValue({ inr: 100, usd: 1, usage: { inputTokens: 1000, outputTokens: 100 } });
  mocks.warn.mockResolvedValue(undefined); mocks.healthy.mockResolvedValue(undefined); mocks.db.mockReturnValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe.each(['false', 'true'])('unchanged plain-chat/legacy paid admission with Surplus flag %s', flag => {
  beforeEach(() => vi.stubEnv('AGENTV3_SURPLUS_BUILDER', flag));
  it('rejects paid-only power before estimating cost or checking affordability', async () => {
    mocks.wallet.mockResolvedValue({ remaining_balance: 200, totalMoneySpent: 0 });
    const ctx = context({ onlyOpus: true, powerLevelReqEffective: 'mini' });
    expect(await checkBuilderPaidAdmission(ctx.input)).toBe(false);
    expect(ctx.release).toHaveBeenCalledOnce(); expect(ctx.status).toHaveBeenCalledWith(402);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'POWER_MODE_PAID_ONLY', balanceInr: 200 }));
    expect(ctx.onFreeTier).toHaveBeenCalledWith(true); expect(mocks.estimate).not.toHaveBeenCalled();
    expect(mocks.wallet).toHaveBeenCalledOnce(); expect(mocks.warn).not.toHaveBeenCalled();
  });
  it.each([0, -1])('rejects insufficient credit at balance %s, including with a paid purchase history', async balance => {
    mocks.wallet.mockResolvedValue({ remaining_balance: balance, totalMoneySpent: 500 });
    const ctx = context(); expect(await checkBuilderPaidAdmission(ctx.input)).toBe(false);
    expect(ctx.release).toHaveBeenCalledOnce(); expect(ctx.status).toHaveBeenCalledWith(402);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INSUFFICIENT_CREDITS', balanceInr: balance, estimateInr: 100 }));
    expect(mocks.warn).toHaveBeenCalledWith('synthetic-paid-user', null, 'blocked');
    expect(mocks.wallet).toHaveBeenCalledOnce(); expect(ctx.onFreeTier).toHaveBeenCalledWith(false);
  });
  it('permits low positive credit with the existing honest notice, without pretending to switch engines', async () => {
    mocks.wallet.mockResolvedValue({ remaining_balance: 10, totalMoneySpent: 500 });
    const ctx = context(); expect(await checkBuilderPaidAdmission(ctx.input)).toBe(true);
    expect(ctx.onEconomy).toHaveBeenCalledWith('Low balance — your build will continue as normal. Add credits to keep full speed on every build.');
    expect(mocks.warn).toHaveBeenCalledWith('synthetic-paid-user', null, 'low');
    expect(ctx.status).not.toHaveBeenCalled(); expect(ctx.release).not.toHaveBeenCalled();
    expect(mocks.healthy).not.toHaveBeenCalled();
  });
  it('proceeds normally at exactly the estimated cost and uses the unchanged legacy estimator', async () => {
    mocks.wallet.mockResolvedValue({ remaining_balance: 100, totalMoneySpent: 500 });
    const ctx = context(); expect(await checkBuilderPaidAdmission(ctx.input)).toBe(true);
    expect(mocks.estimate).toHaveBeenCalledWith('Explain this app', 'off', 100);
    expect(mocks.healthy).toHaveBeenCalledWith('synthetic-paid-user');
    expect(ctx.onEconomy).not.toHaveBeenCalled(); expect(ctx.status).not.toHaveBeenCalled(); expect(ctx.release).not.toHaveBeenCalled();
  });
  it('retains the existing unknown-wallet fail-open behavior without changing power-mode policy', async () => {
    mocks.wallet.mockRejectedValue(new Error('synthetic read failure'));
    const ctx = context(); expect(await checkBuilderPaidAdmission(ctx.input)).toBe(true);
    expect(ctx.onFreeTier).toHaveBeenCalledWith(true); expect(ctx.status).not.toHaveBeenCalled();
    const power = context({ onlyOpus: true }); expect(await checkBuilderPaidAdmission(power.input)).toBe(false);
    expect(power.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'POWER_MODE_PAID_ONLY' }));
  });
});

describe('Surplus admission estimates remain isolated from ordinary paid gates', () => {
  const session = { buildId: 'synthetic', model: 'synthetic', estimatedMicroUsd: '1000', runner: vi.fn() } as SurplusBuildSession;
  it('uses ten times the Surplus microUSD estimate only when an actual reviewed session is supplied', async () => {
    vi.stubEnv('AGENTV3_SURPLUS_BUILDER', 'true');
    mocks.wallet.mockResolvedValue({ remaining_balance: 2, totalMoneySpent: 500 });
    const surplus = context({ surplusSession: session }); expect(await checkBuilderPaidAdmission(surplus.input)).toBe(true);
    expect(mocks.estimate).not.toHaveBeenCalled(); expect(surplus.onEconomy).not.toHaveBeenCalled();
    const plainChat = context(); expect(await checkBuilderPaidAdmission(plainChat.input)).toBe(true);
    expect(mocks.estimate).toHaveBeenCalledOnce(); expect(plainChat.onEconomy).toHaveBeenCalledOnce();
    expect(session.runner).not.toHaveBeenCalled();
  });
  it('reports the Surplus estimate at an insufficient-credit refusal without invoicing or launching inference', async () => {
    mocks.wallet.mockResolvedValue({ remaining_balance: 0, totalMoneySpent: 500 });
    const ctx = context({ surplusSession: session }); expect(await checkBuilderPaidAdmission(ctx.input)).toBe(false);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INSUFFICIENT_CREDITS', billingBasis: 'usage-based', error: expect.stringContaining('actual usage, not a fixed build quote') }));
    const payload = ctx.json.mock.calls[0][0];
    expect(payload).not.toHaveProperty('estimateInr');
    expect(payload).not.toHaveProperty('estimateTokens');
    expect(JSON.stringify(payload)).not.toMatch(/surplus|supplier|model|provider|10x/i);
    expect(mocks.estimate).not.toHaveBeenCalled(); expect(session.runner).not.toHaveBeenCalled();
  });
  it('keeps paid-only power restrictions even when a Surplus session exists', async () => {
    mocks.wallet.mockResolvedValue({ remaining_balance: 100, totalMoneySpent: 0 });
    const ctx = context({ onlyOpus: true, surplusSession: session }); expect(await checkBuilderPaidAdmission(ctx.input)).toBe(false);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'POWER_MODE_PAID_ONLY' }));
    expect(mocks.estimate).not.toHaveBeenCalled(); expect(session.runner).not.toHaveBeenCalled();
  });
  it('does no wallet read, estimate, or callback work when billing itself is disabled', async () => {
    vi.stubEnv('AGENTV3_PAID_PUBLIC', 'false'); vi.stubEnv('AGENTV3_CREDIT_GATE', 'false');
    vi.stubEnv('AGENTV3_SURPLUS_BUILDER', 'true'); const ctx = context({ onlyOpus: true });
    expect(await checkBuilderPaidAdmission(ctx.input)).toBe(true);
    expect(mocks.wallet).not.toHaveBeenCalled(); expect(mocks.estimate).not.toHaveBeenCalled();
    expect(ctx.onFreeTier).not.toHaveBeenCalled(); expect(ctx.onEconomy).not.toHaveBeenCalled(); expect(ctx.release).not.toHaveBeenCalled();
  });
  it('still applies the independent credit gate when paid-public billing is off', async () => {
    vi.stubEnv('AGENTV3_PAID_PUBLIC', 'false'); vi.stubEnv('AGENTV3_CREDIT_GATE', 'true');
    mocks.wallet.mockResolvedValue({ remaining_balance: 0, totalMoneySpent: 500 });
    const ctx = context(); expect(await checkBuilderPaidAdmission(ctx.input)).toBe(false);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INSUFFICIENT_CREDITS' }));
  });
});
