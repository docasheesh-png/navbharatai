import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ run: vi.fn(), config: vi.fn(), db: vi.fn(), maintenance: vi.fn(), policy: vi.fn(),
  budgetConfig: vi.fn(), reserve: vi.fn(), settle: vi.fn(), month: vi.fn(), settleMonth: vi.fn() }));
vi.mock('./qubax', () => ({ runApprovedQubaxChat: fake.run, qubaxConfig: fake.config,
  QubaxError: class extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock('./serverDb', () => ({ getServerDb: fake.db }));
vi.mock('./aiMaintenance', () => ({ assertAiAvailable: fake.maintenance }));
vi.mock('../AI/inferencePolicy', () => ({ assertLegacyInferenceAllowed: fake.policy }));
vi.mock('../AI/FreeChain/config', () => ({ freeChainConfig: fake.budgetConfig }));
vi.mock('../AI/FreeChain/store', () => ({ FreeChainStore: class { reservePaid = fake.reserve; settlePaid = fake.settle; } }));
vi.mock('../AI/FreeChain/masterPlan', () => ({ reserveMonthly: fake.month, settleMonthly: fake.settleMonth }));
import { runTestChat, testChatStatus } from './testChatBot';
import type { TestChatAction } from '../../lib/testChatBot';
const action: TestChatAction = { provider: 'qubax', requestId: '1d2efc71-6d00-4514-83c0-e31461ea9f35', messages: [{ role: 'user', content: 'Synthetic test question' }], confirmGatewayDisclosure: true };
const reply = { kind: 'response', content: 'Synthetic reply', model: 'qubax-reported-model', usage: { inputTokens: 10, outputTokens: 4 } };
beforeEach(() => {
  vi.resetAllMocks();
  fake.config.mockReturnValue({ enabled: true, apiKey: 'synthetic-key' }); fake.db.mockReturnValue({ marker: 'db' });
  fake.budgetConfig.mockReturnValue({ errors: [], paidCapNanoUsd: 100, paidPerUserDaily: 10, features: { monthlyCap: true, monthlyCapNanoUsd: 1000 } });
  fake.maintenance.mockResolvedValue(undefined); fake.month.mockResolvedValue('2026-11');
  fake.reserve.mockResolvedValue({ id: 'hold', mayDispatch: true }); fake.run.mockResolvedValue(reply);
});
describe('test chat provider isolation and admission', () => {
  it('status only reveals server availability, never secrets or a ready/approved claim', () => {
    expect(testChatStatus()).toEqual({ providers: [{ id: 'qubax', label: 'Qubax', configured: true, enabled: true, model: null }], approvalRequired: true, noFallback: true });
    expect(fake.run).not.toHaveBeenCalled(); expect(fake.db).not.toHaveBeenCalled();
  });
  it('dispatches exactly the selected adapter with conservative data scope and bounded text', async () => {
    const result = await runTestChat(action, 'operator@example.invalid', new AbortController().signal);
    expect(fake.run).toHaveBeenCalledOnce();
    expect(fake.run).toHaveBeenCalledWith(expect.objectContaining({ uid: expect.stringMatching(/^admin-test-chat:[a-f0-9]{64}$/),
      requestId: `test-chat:qubax:${action.requestId}`, privateTurn: true, healthTurn: true,
      body: { messages: action.messages, max_tokens: 1024, stream: false } }));
    expect(result).toMatchObject({ requestId: action.requestId, provider: 'qubax', content: reply.content, noFallback: true });
  });
  it.each(['disabled', 'unconfigured', 'storage', 'budget-config', 'invalid', 'maintenance', 'policy'])('does not dispatch when %s is unavailable', async kind => {
    if (kind === 'disabled') fake.config.mockReturnValue({ enabled: false, apiKey: 'synthetic' });
    if (kind === 'unconfigured') fake.config.mockReturnValue({ enabled: true, apiKey: '' });
    if (kind === 'storage') fake.db.mockReturnValue(null);
    if (kind === 'budget-config') fake.budgetConfig.mockReturnValue({ errors: ['FREE_CHAIN_PAID_DAILY_CAP_USD'] });
    if (kind === 'maintenance') fake.maintenance.mockRejectedValue(new Error('blocked'));
    if (kind === 'policy') fake.policy.mockImplementation(() => { throw new Error('blocked'); });
    await expect(runTestChat(kind === 'invalid' ? { ...action, provider: '__proto__' } as any : action, 'actor', new AbortController().signal)).rejects.toBeDefined();
    expect(fake.run).not.toHaveBeenCalled();
  });
  it('does not dispatch on cancellation before entry', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runTestChat(action, 'actor', controller.signal)).rejects.toBeDefined(); expect(fake.run).not.toHaveBeenCalled();
  });
  it.each([{ kind: 'skipped', reason: 'qubax-data-approval-or-ceiling-unavailable' }, null])('never retries or falls back after skipped/failed Qubax %#', async result => {
    if (result) fake.run.mockResolvedValue(result); else fake.run.mockRejectedValue(new Error('credential-and-private-provider-body'));
    await expect(runTestChat(action, 'actor', new AbortController().signal)).rejects.toMatchObject({ reason: result ? 'approval-or-budget' : 'unconfirmed' });
    expect(fake.run).toHaveBeenCalledOnce();
  });
  it('uses shared daily/monthly admission, holds possible cost, and can release only an unused hold', async () => {
    let receipt: any;
    fake.run.mockImplementation(async options => { receipt = await options.reserve(50); return reply; });
    await runTestChat(action, 'actor', new AbortController().signal);
    expect(fake.month).toHaveBeenCalledWith({ marker: 'db' }, 1000, 50);
    expect(fake.reserve).toHaveBeenCalledWith(expect.objectContaining({ maxCostNanoUsd: 50, capNanoUsd: 100, perUserLimit: 10 }));
    expect(fake.settle).not.toHaveBeenCalled(); expect(fake.settleMonth).not.toHaveBeenCalled();
    await receipt.releaseUndispatched();
    expect(fake.settle).toHaveBeenCalledWith({ id: 'hold', mayDispatch: true }, 0);
    expect(fake.settleMonth).toHaveBeenCalledWith({ marker: 'db' }, '2026-11', 50, 0);
  });
  it.each(['monthly', 'daily', 'duplicate', 'invalid-ceiling'])('fails closed for %s admission', async kind => {
    if (kind === 'monthly') fake.month.mockResolvedValue(null);
    if (kind === 'daily') fake.reserve.mockResolvedValue(null);
    if (kind === 'duplicate') fake.reserve.mockResolvedValue({ mayDispatch: false });
    fake.run.mockImplementation(async options => {
      const receipt = await options.reserve(kind === 'invalid-ceiling' ? NaN : 50);
      expect(receipt).toBeNull(); return { kind: 'skipped', reason: 'qubax-budget' };
    });
    await expect(runTestChat(action, 'actor', new AbortController().signal)).rejects.toMatchObject({ reason: kind === 'duplicate' ? 'unconfirmed' : 'approval-or-budget' });
    if (kind === 'daily' || kind === 'duplicate') expect(fake.settleMonth).toHaveBeenCalledWith({ marker: 'db' }, '2026-11', 50, 0);
    if (kind === 'duplicate') expect(fake.settle).not.toHaveBeenCalled();
    if (kind === 'monthly' || kind === 'invalid-ceiling') expect(fake.reserve).not.toHaveBeenCalled();
  });
  it('releases only the fresh monthly hold when daily admission rejects before dispatch', async () => {
    fake.reserve.mockRejectedValue(new Error('daily reservation unavailable'));
    fake.run.mockImplementation(async options => { await options.reserve(50); return reply; });
    await expect(runTestChat(action, 'actor', new AbortController().signal)).rejects.toMatchObject({ reason: 'unconfirmed' });
    expect(fake.settleMonth).toHaveBeenCalledExactlyOnceWith({ marker: 'db' }, '2026-11', 50, 0);
    // The failed daily write may be uncertain. No receipt authorizes clearing that liability.
    expect(fake.settle).not.toHaveBeenCalled();
    expect(fake.reserve).toHaveBeenCalledOnce();
    expect(fake.run).toHaveBeenCalledOnce();
  });
});
