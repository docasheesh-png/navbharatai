import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ run: vi.fn(), config: vi.fn(), db: vi.fn(), maintenance: vi.fn(), policy: vi.fn(),
  budgetConfig: vi.fn(), reserve: vi.fn(), settle: vi.fn(), month: vi.fn(), settleMonth: vi.fn(),
  compatCtor: vi.fn(), compatTurn: vi.fn() }));
vi.mock('./qubax', () => ({ runApprovedQubaxChat: fake.run, qubaxConfig: fake.config, qubaxOwnerDispatch: () => null,
  QubaxError: class extends Error { constructor(readonly code: string, readonly status = 0) { super(code); } } }));
vi.mock('./serverDb', () => ({ getServerDb: fake.db }));
vi.mock('./aiMaintenance', () => ({ assertAiAvailable: fake.maintenance }));
vi.mock('../AI/inferencePolicy', () => ({ assertLegacyInferenceAllowed: fake.policy }));
vi.mock('../AI/FreeChain/config', async importOriginal => {
  const actual = await importOriginal<typeof import('../AI/FreeChain/config')>();
  return { ...actual, freeChainConfig: fake.budgetConfig };
});
vi.mock('../AI/FreeChain/store', () => ({ FreeChainStore: class { reservePaid = fake.reserve; settlePaid = fake.settle; } }));
vi.mock('../AI/FreeChain/masterPlan', () => ({ reserveMonthly: fake.month, settleMonthly: fake.settleMonth }));
vi.mock('../AI/FreeChain/providers/openAiCompatProvider', async importOriginal => {
  const actual = await importOriginal<typeof import('../AI/FreeChain/providers/openAiCompatProvider')>();
  return {
    ...actual,
    OpenAiCompatProvider: class {
      constructor(config: unknown) { fake.compatCtor(config); }
      executeTurn(...args: unknown[]) { return fake.compatTurn(...args); }
    },
  };
});
import { runTestChat, testChatStatus, TestChatUnavailable } from './testChatBot';
import { TEST_CHAT_PROVIDER_IDS, type TestChatAction } from '../../lib/testChatBot';
import { QubaxError } from './qubax';
import { FreeChainProviderError } from '../AI/FreeChain/providers/openAiCompatProvider';
const action: TestChatAction = { provider: 'qubax', requestId: '1d2efc71-6d00-4514-83c0-e31461ea9f35', messages: [{ role: 'user', content: 'Synthetic test question' }], confirmGatewayDisclosure: true };
const reply = { kind: 'response', content: 'Synthetic reply', model: 'qubax-reported-model', usage: { inputTokens: 10, outputTokens: 4 } };
const groqRung = {
  id: 'groq', configured: true, key: 'synthetic-groq-key', keyEnv: 'FREE_CHAIN_GROQ_API_KEY',
  model: 'openai/gpt-oss-120b', baseURL: 'https://api.groq.com/openai/v1', streamUsage: false, priceIn: 0, priceOut: 0,
};
function budget(overrides: Record<string, unknown> = {}) {
  return { errors: [], paidCapNanoUsd: 100, paidPerUserDaily: 10, features: { monthlyCap: true, monthlyCapNanoUsd: 1000 }, rungs: [], ...overrides };
}
beforeEach(() => {
  vi.resetAllMocks();
  fake.config.mockReturnValue({ enabled: true, apiKey: 'synthetic-key' }); fake.db.mockReturnValue({ marker: 'db' });
  fake.budgetConfig.mockReturnValue(budget());
  fake.maintenance.mockResolvedValue(undefined); fake.month.mockResolvedValue('2026-11');
  fake.reserve.mockResolvedValue({ id: 'hold', mayDispatch: true }); fake.run.mockResolvedValue(reply);
});
describe('test chat provider isolation and admission', () => {
  it('status only reveals server availability, never secrets or a ready/approved claim', () => {
    const status = testChatStatus();
    expect(status.noFallback).toBe(true);
    expect(status.approvalRequired).toBe(true);
    expect(status.providers.map(item => item.id)).toEqual([...TEST_CHAT_PROVIDER_IDS]);
    expect(status.providers.find(item => item.id === 'qubax')).toMatchObject({ id: 'qubax', label: 'Qubax', configured: true, enabled: true, model: null });
    expect(JSON.stringify(status)).not.toContain('synthetic-key');
    expect(JSON.stringify(status)).not.toMatch(/QUBAX_API_KEY|FREE_CHAIN_|MITRIFY_API_KEY/);
    expect(fake.run).not.toHaveBeenCalled(); expect(fake.db).not.toHaveBeenCalled();
  });
  it('dispatches exactly the selected adapter with conservative data scope and bounded text', async () => {
    const result = await runTestChat(action, 'operator@example.invalid', new AbortController().signal);
    expect(fake.run).toHaveBeenCalledOnce();
    expect(fake.run).toHaveBeenCalledWith(expect.objectContaining({ uid: expect.stringMatching(/^admin-test-chat:[a-f0-9]{64}$/),
      requestId: `test-chat:qubax:${action.requestId}`, privateTurn: true, healthTurn: true,
      body: { messages: action.messages, max_tokens: 1024, stream: false }, onHttpError: expect.any(Function) }));
    expect(result).toMatchObject({ requestId: action.requestId, provider: 'qubax', content: reply.content, noFallback: true });
    expect(fake.compatTurn).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'unconfigured', 'storage', 'budget-config', 'invalid', 'maintenance', 'policy'])('does not dispatch when %s is unavailable', async kind => {
    if (kind === 'disabled') fake.config.mockReturnValue({ enabled: false, apiKey: 'synthetic' });
    if (kind === 'unconfigured') fake.config.mockReturnValue({ enabled: true, apiKey: '' });
    if (kind === 'storage') fake.db.mockReturnValue(null);
    if (kind === 'budget-config') fake.budgetConfig.mockReturnValue(budget({ errors: ['FREE_CHAIN_PAID_DAILY_CAP_USD'] }));
    if (kind === 'maintenance') fake.maintenance.mockRejectedValue(new Error('blocked'));
    if (kind === 'policy') fake.policy.mockImplementation(() => { throw new Error('blocked'); });
    await expect(runTestChat(kind === 'invalid' ? { ...action, provider: '__proto__' } as any : action, 'actor', new AbortController().signal)).rejects.toBeDefined();
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.compatTurn).not.toHaveBeenCalled();
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
  it('surfaces a redacted admin diagnostic for a Qubax HTTP failure without leaking secrets', async () => {
    fake.run.mockImplementation(async options => {
      options.onHttpError?.({ status: 401, body: 'invalid api key synthetic-key using FREE_CHAIN_GROQ_API_KEY', requestId: 'qx-1' });
      throw new QubaxError('QUBAX_HTTP_ERROR', 401);
    });
    const error = await runTestChat(action, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error).toBeInstanceOf(TestChatUnavailable);
    expect(error.reason).toBe('unconfirmed');
    expect(error.diagnostic).toMatchObject({ provider: 'qubax', classification: 'auth', httpStatus: 401, providerRequestId: 'qx-1' });
    expect(JSON.stringify(error.diagnostic)).not.toContain('synthetic-key');
    expect(JSON.stringify(error.diagnostic)).not.toContain('FREE_CHAIN_GROQ_API_KEY');
  });
  it('does not hide an unconfirmed empty Qubax reply behind a generic success', async () => {
    fake.run.mockResolvedValueOnce({ kind: 'response', content: '   ', model: 'qubax-reported-model' });
    const error = await runTestChat(action, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('unconfirmed');
    expect(error.diagnostic).toMatchObject({ classification: 'empty', provider: 'qubax' });
  });
  it('dispatches only groq when groq is selected and never calls Qubax', async () => {
    fake.budgetConfig.mockReturnValue(budget({ rungs: [groqRung] }));
    fake.compatTurn.mockResolvedValue({ content: 'Hi from groq', model: 'openai/gpt-oss-120b', usage: { inputTokens: 3, outputTokens: 4 } });
    const result = await runTestChat({ ...action, provider: 'groq' }, 'operator@example.invalid', new AbortController().signal);
    expect(result).toMatchObject({ provider: 'groq', content: 'Hi from groq', noFallback: true });
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.compatTurn).toHaveBeenCalledOnce();
    expect(fake.compatCtor).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'GROQ', model: 'openai/gpt-oss-120b', timeoutMs: 60_000, maxOutputTokens: 1024, streamUsage: false,
      adminErrorDetail: expect.any(Function),
    }));
    expect(fake.compatTurn.mock.calls[0]?.[0]).toMatchObject({ prompt: action.messages[0].content, messages: action.messages });
  });
  it('does not invent a Surplus or Router One dispatch when those entries are selected', async () => {
    expect(testChatStatus().providers.find(item => item.id === 'surplus')?.enabled).toBe(false);
    expect(testChatStatus().providers.find(item => item.id === 'router-one')?.enabled).toBe(false);
    await expect(runTestChat({ ...action, provider: 'surplus' }, 'actor', new AbortController().signal)).rejects.toMatchObject({ reason: 'disabled' });
    await expect(runTestChat({ ...action, provider: 'router-one' }, 'actor', new AbortController().signal)).rejects.toMatchObject({ reason: 'disabled' });
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.compatTurn).not.toHaveBeenCalled();
  });
  it('does not invent a paid reservation for free groq and still fail-closes Qubax when the paid cap is unconfigured', async () => {
    fake.budgetConfig.mockReturnValue(budget({ errors: ['FREE_CHAIN_PAID_DAILY_CAP_USD'], rungs: [groqRung] }));
    fake.compatTurn.mockResolvedValue({ content: 'free groq', model: 'openai/gpt-oss-120b' });
    await expect(runTestChat(action, 'actor', new AbortController().signal)).rejects.toMatchObject({ reason: 'approval-or-budget' });
    expect(fake.run).not.toHaveBeenCalled();
    const groq = await runTestChat({ ...action, provider: 'groq' }, 'actor', new AbortController().signal);
    expect(groq.content).toBe('free groq');
    expect(fake.reserve).not.toHaveBeenCalled();
    expect(fake.run).not.toHaveBeenCalled();
  });
  it('records a groq admin diagnostic from the adapter sink without attaching raw text to the thrown adapter error', async () => {
    fake.budgetConfig.mockReturnValue(budget({ rungs: [groqRung] }));
    fake.compatTurn.mockImplementation(async () => {
      const config = fake.compatCtor.mock.calls[0]?.[0] as { adminErrorDetail?: (detail: Record<string, unknown>) => void };
      config.adminErrorDetail?.({
        httpStatus: 429, providerCode: 'rate_limit_exceeded', providerType: 'rate_limit',
        providerMessage: 'slow down synthetic-groq-key', rawErrorBody: '{"error":"slow down synthetic-groq-key"}', requestId: 'groq-1',
      });
      throw new FreeChainProviderError('RATE_LIMIT', { status: 429 });
    });
    const error = await runTestChat({ ...action, provider: 'groq' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('unconfirmed');
    expect(error.diagnostic).toMatchObject({ provider: 'groq', classification: 'rate-limit', httpStatus: 429, providerRequestId: 'groq-1' });
    expect(JSON.stringify(error.diagnostic)).not.toContain('synthetic-groq-key');
    expect(fake.run).not.toHaveBeenCalled();
  });
});
