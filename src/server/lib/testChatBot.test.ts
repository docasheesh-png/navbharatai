import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ run: vi.fn(), config: vi.fn(), db: vi.fn(), maintenance: vi.fn(), policy: vi.fn(),
  budgetConfig: vi.fn(), reserve: vi.fn(), settle: vi.fn(), month: vi.fn(), settleMonth: vi.fn(),
  compatCtor: vi.fn(), compatTurn: vi.fn(), officialOpenAi: vi.fn(), officialAnthropic: vi.fn(),
  refresh: vi.fn(), mitrifyClient: vi.fn(), mitrifyChat: vi.fn(), registryRung: vi.fn(), strictFree: vi.fn(),
  marketPlan: undefined as undefined | ((...args: unknown[]) => unknown),
  feedSummary: undefined as undefined | ((...args: unknown[]) => unknown),
  catalogJson: undefined as undefined | ((...args: unknown[]) => unknown),
  mitrifyCatalog: undefined as undefined | ((url: string, init?: RequestInit) => Promise<unknown>) }));
vi.mock('./qubax', () => ({ runApprovedQubaxChat: fake.run, qubaxConfig: fake.config,
  QubaxError: class extends Error { constructor(readonly code: string, readonly status = 0) { super(code); } } }));
vi.mock('./qubaxPriceFeedRuntime', () => ({ refreshQubaxPriceFeed: (...args: unknown[]) => fake.refresh(...args) }));
vi.mock('./mitrify', async importOriginal => {
  const actual = await importOriginal<typeof import('./mitrify')>();
  return { ...actual, createMitrifyClient: (...args: unknown[]) => fake.mitrifyClient(...args) };
});
vi.mock('../AI/FreeChain/providers/openRouterRegistryRung', () => ({
  runRegistryRung: (...args: unknown[]) => fake.registryRung(...args),
}));
vi.mock('../AI/LiveRegistry/runtime', () => ({
  strictFreeText: (...args: unknown[]) => fake.strictFree(...args),
}));
vi.mock('../AI/LiveRegistry/sync', async importOriginal => {
  const actual = await importOriginal<typeof import('../AI/LiveRegistry/sync')>();
  return {
    ...actual,
    catalogJson: (...args: unknown[]) => fake.catalogJson
      ? fake.catalogJson(...args)
      : actual.catalogJson(...args as Parameters<typeof actual.catalogJson>),
  };
});
vi.mock('./qubaxMarket', async importOriginal => {
  const actual = await importOriginal<typeof import('./qubaxMarket')>();
  return {
    ...actual,
    readQubaxMarketPlan: (...args: unknown[]) => fake.marketPlan
      ? fake.marketPlan(...args)
      : actual.readQubaxMarketPlan(...args as Parameters<typeof actual.readQubaxMarketPlan>),
    readQubaxFeedSummary: (...args: unknown[]) => fake.feedSummary
      ? fake.feedSummary(...args)
      : actual.readQubaxFeedSummary(...args as Parameters<typeof actual.readQubaxFeedSummary>),
  };
});
vi.mock('./testChatBotOfficial', async importOriginal => {
  const actual = await importOriginal<typeof import('./testChatBotOfficial')>();
  return {
    ...actual,
    runOfficialOpenAiCompatTest: (...args: unknown[]) => fake.officialOpenAi(...args),
    runOfficialAnthropicTest: (...args: unknown[]) => fake.officialAnthropic(...args),
  };
});
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
import { loadTestChatStatus, runTestChat, testChatStatus, TestChatUnavailable } from './testChatBot';
import { TEST_CHAT_MAX_OUTPUT_TOKENS, TEST_CHAT_PROVIDER_IDS, type TestChatAction } from '../../lib/testChatBot';
import { maximumCostNanoUsd, usdToNanoUsd } from '../AI/FreeChain/spendCap';
import { QubaxError } from './qubax';
import { MitrifyError } from './mitrify';
import { OfficialTestChatError } from './testChatBotOfficial';
import { FreeChainProviderError } from '../AI/FreeChain/providers/openAiCompatProvider';
import { FreeRoutingError } from '../AI/LiveRegistry/dispatcher';
const action: TestChatAction = { provider: 'qubax', requestId: '1d2efc71-6d00-4514-83c0-e31461ea9f35', messages: [{ role: 'user', content: 'Synthetic test question' }], confirmGatewayDisclosure: true };
const reply = { kind: 'response', content: 'Synthetic reply', model: 'qubax-reported-model', usage: { inputTokens: 10, outputTokens: 4 } };
const groqRung = {
  id: 'groq', configured: true, key: 'synthetic-groq-key', keyEnv: 'FREE_CHAIN_GROQ_API_KEY',
  model: 'openai/gpt-oss-120b', baseURL: 'https://api.groq.com/openai/v1', streamUsage: false, priceIn: 0, priceOut: 0,
};
function budget(overrides: Record<string, unknown> = {}) {
  return { errors: [], paidCapNanoUsd: 100, paidPerUserDaily: 10, features: { monthlyCap: true, monthlyCapNanoUsd: 1000 }, rungs: [], ...overrides };
}
function mitrifyQuotedHold(priceIn: number, priceOut: number): number {
  const inputTokens = Buffer.byteLength(JSON.stringify(action.messages), 'utf8') + 256;
  return maximumCostNanoUsd(inputTokens, TEST_CHAT_MAX_OUTPUT_TOKENS, usdToNanoUsd(priceIn), usdToNanoUsd(priceOut));
}
function mitrifyCatalogResponse(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  const raw = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(raw);
  return {
    ok: status >= 200 && status < 300, status,
    headers: new Headers({ 'content-type': 'application/json', 'content-length': String(bytes.byteLength), ...extraHeaders }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    json: async () => payload,
    text: async () => raw,
  };
}
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  fake.marketPlan = undefined;
  fake.feedSummary = undefined;
  fake.catalogJson = undefined;
  fake.mitrifyCatalog = undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (fake.mitrifyCatalog) return fake.mitrifyCatalog(url, init);
    if (url.replace(/\/$/, '').endsWith('/models')) return mitrifyCatalogResponse({ data: [{ id: 'mitrify/auto-cheap' }] });
    throw new Error(`unexpected fetch ${url}`);
  }));
  fake.config.mockReturnValue({ enabled: true, apiKey: 'synthetic-key' }); fake.db.mockReturnValue({ marker: 'db' });
  fake.budgetConfig.mockReturnValue(budget());
  fake.maintenance.mockResolvedValue(undefined); fake.month.mockResolvedValue('2026-11');
  fake.reserve.mockResolvedValue({ id: 'hold', mayDispatch: true }); fake.run.mockResolvedValue(reply);
  fake.refresh.mockResolvedValue({ status: 'unavailable' });
  fake.mitrifyClient.mockReturnValue({ chat: fake.mitrifyChat });
  fake.mitrifyChat.mockImplementation(async (_body: unknown, options?: { onChunk?: (wire: Uint8Array) => void }) => {
    const payload = { model: 'mitrify/auto-cheap', choices: [{ delta: { content: 'Hello from Mitrify' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } };
    await options?.onChunk?.(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
    return { status: 200, headers: {}, data: undefined };
  });
  fake.registryRung.mockResolvedValue({ content: 'Hello from OpenRouter', model: 'openrouter/free', usage: { inputTokens: 2, outputTokens: 3 } });
  fake.strictFree.mockResolvedValue({ content: 'Hello from registry', model: 'registry/free', usage: { inputTokens: 2, outputTokens: 3 } });
});
describe('test chat provider isolation and admission', () => {
  it('status only reveals server availability, never secrets or a ready/approved claim', () => {
    const status = testChatStatus();
    expect(status.noFallback).toBe(true);
    expect(status.approvalRequired).toBe(true);
    expect(status.providers.map(item => item.id)).toEqual([...TEST_CHAT_PROVIDER_IDS]);
    expect(status.providers.find(item => item.id === 'qubax')).toMatchObject({
      id: 'qubax', label: 'Qubax', configured: true, enabled: true, model: null, ceilingUsd: null, approvalRequired: true,
    });
    expect(JSON.stringify(status)).not.toContain('synthetic-key');
    expect(JSON.stringify(status)).not.toMatch(/QUBAX_API_KEY|FREE_CHAIN_|MITRIFY_API_KEY/);
    expect(fake.run).not.toHaveBeenCalled(); expect(fake.db).not.toHaveBeenCalled();
  });
  it('dispatches exactly the selected adapter with conservative data scope and bounded text', async () => {
    const result = await runTestChat(action, 'operator@example.invalid', new AbortController().signal);
    expect(fake.run).toHaveBeenCalledOnce();
    expect(fake.run).toHaveBeenCalledWith(expect.objectContaining({ uid: expect.stringMatching(/^admin-test-chat:[a-f0-9]{64}$/),
      requestId: `test-chat:qubax:${action.requestId}`, privateTurn: true, healthTurn: true,
      body: { messages: action.messages, max_tokens: 1024, stream: false }, onHttpError: expect.any(Function), onAttemptError: expect.any(Function) }));
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
  it.each([
    ['qubax-price-or-quality-unverified', 'no-model'],
    ['qubax-budget', 'budget'],
    ['qubax-tries-exhausted', 'tries-exhausted'],
    ['qubax-data-approval-or-ceiling-unavailable', 'unconfirmed'],
  ])('names skip %s as %s and does not try another provider', async (reason, code) => {
    fake.run.mockResolvedValue({ kind: 'skipped', reason });
    await expect(runTestChat(action, 'actor', new AbortController().signal)).rejects.toMatchObject({ reason: code });
    expect(fake.run).toHaveBeenCalledOnce();
  });
  it('does not disclose a provider failure body', async () => {
    fake.run.mockRejectedValue(new Error('credential-and-private-provider-body'));
    await expect(runTestChat(action, 'actor', new AbortController().signal)).rejects.toMatchObject({ reason: 'unconfirmed' });
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
    await expect(runTestChat(action, 'actor', new AbortController().signal)).rejects.toMatchObject({ reason: kind === 'duplicate' ? 'unconfirmed' : 'budget' });
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
    await expect(runTestChat(action, 'actor', new AbortController().signal)).rejects.toMatchObject({ reason: 'budget' });
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
  it('uses a distinct request id for each Qubax market try reservation', async () => {
    fake.run.mockImplementation(async options => {
      await options.reserve(50, `${options.requestId}:q1`);
      await options.reserve(40, `${options.requestId}:q2`);
      return reply;
    });
    await runTestChat(action, 'actor', new AbortController().signal);
    expect(fake.reserve).toHaveBeenNthCalledWith(1, expect.objectContaining({ requestId: `test-chat:qubax:${action.requestId}:q1`, maxCostNanoUsd: 50 }));
    expect(fake.reserve).toHaveBeenNthCalledWith(2, expect.objectContaining({ requestId: `test-chat:qubax:${action.requestId}:q2`, maxCostNanoUsd: 40 }));
  });
  it('records each Qubax market attempt and the final tries-exhausted outcome', async () => {
    fake.run.mockImplementation(async options => {
      options.onAttemptError?.({ model: 'model-a', status: 429, code: 'QUBAX_HTTP_ERROR', latencyMs: 12, body: 'slow down', requestId: 'a1' });
      options.onAttemptError?.({ model: 'model-b', status: 500, code: 'QUBAX_HTTP_ERROR', latencyMs: 20, body: 'boom', requestId: 'b1' });
      options.onAttemptError?.({ model: 'model-c', status: null, code: 'QUBAX_INCOMPLETE_STREAM', latencyMs: 8 });
      return { kind: 'skipped', reason: 'qubax-tries-exhausted' };
    });
    const error = await runTestChat(action, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('tries-exhausted');
    expect(error.diagnostic?.finalOutcome).toBe('tries-exhausted');
    expect(error.diagnostic?.attempts).toHaveLength(3);
    expect(error.diagnostic?.attempts?.[0]).toMatchObject({ model: 'model-a', httpStatus: 429, providerCode: 'QUBAX_HTTP_ERROR' });
    expect(error.diagnostic?.attempts?.[2]).toMatchObject({ model: 'model-c', providerCode: 'QUBAX_INCOMPLETE_STREAM' });
  });
  it('releases an unused official paid hold when dispatch is rejected before any network call', async () => {
    vi.stubEnv('KIMI_API_KEY', 'synthetic-kimi-key-value');
    fake.officialOpenAi.mockRejectedValue(new OfficialTestChatError('unknown', null, 'url-not-allowlisted', null, null, null, null));
    const error = await runTestChat({ ...action, provider: 'kimi' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('unconfirmed');
    expect(error.diagnostic?.providerCode).toBe('url-not-allowlisted');
    expect(fake.reserve).toHaveBeenCalledOnce();
    expect(fake.settle).toHaveBeenCalledWith({ id: 'hold', mayDispatch: true }, 0);
    expect(fake.settleMonth).toHaveBeenCalledWith({ marker: 'db' }, '2026-11', expect.any(Number), 0);
    expect(fake.run).not.toHaveBeenCalled();
  });
  it('releases an unused official Gemini Flash hold when dispatch fails before the provider is called', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'synthetic-gemini-key-value');
    fake.compatTurn.mockRejectedValue(new FreeChainProviderError('CONFIGURATION'));
    const error = await runTestChat({ ...action, provider: 'gemini-2.5-flash' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('unconfirmed');
    expect(error.diagnostic?.providerCode).toBe('CONFIGURATION');
    expect(fake.compatTurn).toHaveBeenCalledOnce();
    expect(fake.officialOpenAi).not.toHaveBeenCalled();
    expect(fake.officialAnthropic).not.toHaveBeenCalled();
    expect(fake.reserve).toHaveBeenCalledOnce();
    expect(fake.settle).toHaveBeenCalledOnce();
    expect(fake.settle).toHaveBeenCalledWith({ id: 'hold', mayDispatch: true }, 0);
    expect(fake.settleMonth).toHaveBeenCalledOnce();
    expect(fake.settleMonth).toHaveBeenCalledWith({ marker: 'db' }, '2026-11', expect.any(Number), 0);
    expect(fake.run).not.toHaveBeenCalled();
  });
  it('attaches the Qubax feed without collapsing the provider list', async () => {
    vi.stubEnv('QUBAX_ENABLED', '1');
    vi.stubEnv('QUBAX_API_KEY', 'synthetic-qubax-key-value');
    fake.marketPlan = vi.fn().mockResolvedValue({ eligible: [], backup: null });
    fake.feedSummary = vi.fn().mockResolvedValue({
      fresh: true, observedAtMs: 1_700_000_000_000, pricedRows: 4, officialMatches: 3, discountEligible: 2, probePassing: 1,
    });
    const status = await loadTestChatStatus();
    expect(status.providers.map(item => item.id)).toEqual([...TEST_CHAT_PROVIDER_IDS]);
    expect(status.providers).toHaveLength(TEST_CHAT_PROVIDER_IDS.length);
    expect(status.feed).toEqual({
      fresh: true, observedAtMs: 1_700_000_000_000, pricedRows: 4, officialMatches: 3, discountEligible: 2, probePassing: 1,
    });
    expect(status.providers.find(item => item.id === 'qubax')).toMatchObject({
      id: 'qubax', model: null, selection: 'none', ceilingUsd: '0.02', approvalRequired: false,
    });
    expect(status.providers.filter(item => item.id !== 'qubax').every(item => item.selection === undefined)).toBe(true);
  });

  it('enables Mitrify from its key alone and dispatches through createMitrifyClient', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    vi.stubEnv('MITRIFY_CHAIN_ENABLED', '0');
    const row = testChatStatus().providers.find(item => item.id === 'mitrify');
    expect(row).toMatchObject({ configured: true, enabled: true, approvalRequired: false, model: 'mitrify/auto-cheap' });
    expect(row?.unavailableReason).toBeUndefined();
    const result = await runTestChat({ ...action, provider: 'mitrify' }, 'operator@example.invalid', new AbortController().signal);
    expect(result).toMatchObject({ provider: 'mitrify', content: 'Hello from Mitrify', model: 'mitrify/auto-cheap', noFallback: true });
    expect(fake.mitrifyClient).toHaveBeenCalledOnce();
    expect(fake.mitrifyClient.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ MITRIFY_MODEL: 'mitrify/auto-cheap', MITRIFY_API_KEY: 'synthetic-mitrify-key-value' }));
    expect(fake.mitrifyChat).toHaveBeenCalledOnce();
    expect(fake.mitrifyChat.mock.calls[0]?.[0]).toMatchObject({ max_tokens: 250, stream: true, messages: action.messages });
    expect(fetch).toHaveBeenCalledWith('https://mitrify.com/v1/models', expect.objectContaining({
      method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer synthetic-mitrify-key-value', Accept: 'application/json' }),
    }));
    expect(fake.mitrifyChat.mock.calls[0]?.[1]).toMatchObject({ maxAttempts: 1, onChunk: expect.any(Function) });
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.reserve).toHaveBeenCalledOnce();
    expect(process.env.MITRIFY_CHAIN_ENABLED).toBe('0');
  });
  it('caps a Mitrify admin send at the shared user-chain reply token limit', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.budgetConfig.mockReturnValue(budget({ features: { monthlyCap: true, monthlyCapNanoUsd: 1000, replyMaxTokens: 180 } }));
    await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal);
    expect(fake.mitrifyChat.mock.calls[0]?.[0]).toMatchObject({ max_tokens: 180, stream: true });
  });
  it('explains a Mitrify HTTP 504 as a provider gateway timeout', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyChat.mockImplementation(async (_body: unknown, options?: { onHttpError?: unknown }) => {
      throw new MitrifyError('MITRIFY_HTTP_504', 504);
    });
    const error = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('unconfirmed');
    expect(error.diagnostic).toMatchObject({
      provider: 'mitrify', classification: 'timeout', httpStatus: 504, providerCode: 'MITRIFY_HTTP_504',
    });
    expect(error.diagnostic?.model).toBe('mitrify/auto-cheap');
    expect(error.diagnostic?.providerMessage).toContain('provider gateway timed out (HTTP 504)');
    expect(error.diagnostic?.providerMessage).toContain('live /v1/models');
    expect(error.diagnostic?.providerMessage).toContain('not a missing key');
  });
  it('releases an unused Mitrify hold when configuration fails before dispatch', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyChat.mockRejectedValue(new MitrifyError('MITRIFY_CONFIGURATION'));
    const error = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('unconfirmed');
    expect(error.diagnostic?.providerCode).toBe('MITRIFY_CONFIGURATION');
    expect(fake.reserve).toHaveBeenCalledOnce();
    expect(fake.settle).toHaveBeenCalledWith({ id: 'hold', mayDispatch: true }, 0);
    expect(fake.settleMonth).toHaveBeenCalledWith({ marker: 'db' }, '2026-11', expect.any(Number), 0);
  });
  it('picks the cheapest priced model from Mitrify’s live catalog', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({
      data: [
        { id: 'mitrify/expensive', pricing: { prompt: '2', completion: '4' } },
        { id: 'mitrify/cheap', pricing: { prompt: '0.1', completion: '0.2' } },
        { id: 'text-embedding-3', object: 'embedding' },
      ],
    });
    fake.mitrifyChat.mockImplementation(async (_body: unknown, options?: { onChunk?: (wire: Uint8Array) => void }) => {
      const payload = { model: 'mitrify/cheap', choices: [{ delta: { content: 'Hello from listed' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } };
      await options?.onChunk?.(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
      return { status: 200, headers: {}, data: undefined };
    });
    const result = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal);
    expect(result).toMatchObject({ provider: 'mitrify', content: 'Hello from listed', model: 'mitrify/cheap', noFallback: true });
    expect(fake.mitrifyClient.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ MITRIFY_MODEL: 'mitrify/cheap' }));
    expect(fake.reserve).toHaveBeenCalledWith(expect.objectContaining({ maxCostNanoUsd: mitrifyQuotedHold(0.1, 0.2) }));
    expect(mitrifyQuotedHold(0.1, 0.2)).not.toBe(mitrifyQuotedHold(1, 1));
  });
  it('accepts a typed Mitrify model only when the live catalog lists it', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({
      data: [
        { id: 'mitrify/listed', pricing: { prompt: '3', completion: '3' } },
        { id: 'mitrify/auto-cheap', pricing: { prompt: '9', completion: '9' } },
      ],
    });
    fake.mitrifyChat.mockImplementation(async (_body: unknown, options?: { onChunk?: (wire: Uint8Array) => void }) => {
      const payload = { model: 'mitrify/listed', choices: [{ delta: { content: 'Hello listed' }, finish_reason: 'stop' }] };
      await options?.onChunk?.(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
      return { status: 200, headers: {}, data: undefined };
    });
    const result = await runTestChat({ ...action, provider: 'mitrify', model: 'mitrify/listed' }, 'actor', new AbortController().signal);
    expect(result).toMatchObject({ provider: 'mitrify', content: 'Hello listed', model: 'mitrify/listed' });
    expect(fake.mitrifyClient.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ MITRIFY_MODEL: 'mitrify/listed' }));
  });
  it('does not call Mitrify when the typed model is missing from the live catalog', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({ data: [{ id: 'mitrify/auto-cheap' }] });
    const error = await runTestChat({ ...action, provider: 'mitrify', model: 'mitrify/not-listed' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('no-model');
    expect(error.diagnostic?.providerCode).toBe('MITRIFY_MODEL_NOT_LISTED');
    expect(error.diagnostic?.model).toBe('mitrify/not-listed');
    expect(fake.mitrifyChat).not.toHaveBeenCalled();
    expect(fake.reserve).not.toHaveBeenCalled();
  });
  it('does not reserve a Mitrify hold when the live catalog is empty', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({ data: [] });
    const error = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('no-model');
    expect(error.diagnostic?.providerCode).toBe('MITRIFY_CATALOG_EMPTY');
    expect(fake.mitrifyChat).not.toHaveBeenCalled();
    expect(fake.reserve).not.toHaveBeenCalled();
  });
  it('surfaces a Mitrify catalog 401 as configuration and does not dispatch chat', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({ error: { message: 'Provide a valid Mitrify API key' } }, 401);
    const error = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('unconfirmed');
    expect(error.diagnostic?.providerCode).toBe('MITRIFY_CONFIGURATION');
    expect(error.diagnostic?.httpStatus).toBe(401);
    expect(fake.mitrifyChat).not.toHaveBeenCalled();
    expect(fake.reserve).not.toHaveBeenCalled();
  });
  it('rejects a Mitrify catalog whose content-length exceeds the size cap', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => ({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json', 'content-length': '1000001' }),
      body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"data":[]}')); controller.close(); } }),
    });
    const error = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('unconfirmed');
    expect(error.diagnostic?.providerCode).toBe('MITRIFY_CATALOG_TOO_LARGE');
    expect(error.diagnostic?.providerMessage).toContain('catalog size cap');
    expect(fake.mitrifyChat).not.toHaveBeenCalled();
    expect(fake.reserve).not.toHaveBeenCalled();
  });
  it('rejects a Mitrify catalog once the streamed body exceeds the size cap', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => ({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1_000_001).fill(32));
          controller.close();
        },
      }),
    });
    const error = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('unconfirmed');
    expect(error.diagnostic?.providerCode).toBe('MITRIFY_CATALOG_TOO_LARGE');
    expect(fake.mitrifyChat).not.toHaveBeenCalled();
    expect(fake.reserve).not.toHaveBeenCalled();
  });
  it('rejects a Mitrify catalog that does not arrive within the short catalog timeout', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    vi.useFakeTimers();
    fake.mitrifyCatalog = async (_url, init) => new Promise((_, reject) => {
      const fail = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      if (init?.signal?.aborted) { fail(); return; }
      init?.signal?.addEventListener('abort', fail, { once: true });
    });
    try {
      const pending = runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal).catch(value => value);
      await vi.advanceTimersByTimeAsync(12_000);
      const error = await pending as TestChatUnavailable;
      expect(error.reason).toBe('unconfirmed');
      expect(error.diagnostic?.providerCode).toBe('MITRIFY_CATALOG_TIMEOUT');
      expect(error.diagnostic?.providerMessage).toContain('catalog timeout');
      expect(fake.mitrifyChat).not.toHaveBeenCalled();
      expect(fake.reserve).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('calls only mitrify/auto-cheap when the catalog has no prices, never an alphabetical listed id', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({
      data: [{ id: 'alpha/other' }, { id: 'mitrify/auto-cheap' }, { id: 'zeta/other' }],
    });
    const result = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal);
    expect(result).toMatchObject({ provider: 'mitrify', model: 'mitrify/auto-cheap' });
    expect(fake.mitrifyClient.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ MITRIFY_MODEL: 'mitrify/auto-cheap' }));
    expect(fake.reserve).toHaveBeenCalledWith(expect.objectContaining({ maxCostNanoUsd: mitrifyQuotedHold(1, 1) }));
  });
  it('fails closed and names listed ids when the catalog has no prices and auto-cheap is absent', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({
      data: [{ id: 'alpha/other' }, { id: 'zeta/other' }],
    });
    const error = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('no-model');
    expect(error.diagnostic?.providerCode).toBe('MITRIFY_NO_PRICES');
    expect(error.diagnostic?.providerMessage).toContain('no usable prices');
    expect(error.diagnostic?.providerMessage).toContain('alphabetical');
    expect(error.diagnostic?.providerMessage).toContain('alpha/other');
    expect(error.diagnostic?.providerMessage).toContain('zeta/other');
    expect(fake.mitrifyChat).not.toHaveBeenCalled();
    expect(fake.reserve).not.toHaveBeenCalled();
  });

  it('treats numeric 0+0 catalog prices as unpriced and does not skip the budget hold', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({
      data: [{ id: 'mitrify/zero', pricing: { prompt: 0, completion: 0 } }],
    });
    const error = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('no-model');
    expect(error.diagnostic?.providerCode).toBe('MITRIFY_NO_PRICES');
    expect(error.diagnostic?.providerMessage).toContain('mitrify/zero');
    expect(fake.mitrifyChat).not.toHaveBeenCalled();
    expect(fake.reserve).not.toHaveBeenCalled();
  });
  it('treats string \"0\" catalog prices as unpriced', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({
      data: [{ id: 'mitrify/zero', pricing: { prompt: '0', completion: '0' } }],
    });
    const error = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('no-model');
    expect(error.diagnostic?.providerCode).toBe('MITRIFY_NO_PRICES');
    expect(fake.mitrifyChat).not.toHaveBeenCalled();
    expect(fake.reserve).not.toHaveBeenCalled();
  });
  it('treats a catalog row as unpriced when only one side is 0', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({
      data: [{ id: 'mitrify/half', pricing: { prompt: '0.1', completion: 0 } }],
    });
    const error = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('no-model');
    expect(error.diagnostic?.providerCode).toBe('MITRIFY_NO_PRICES');
    expect(error.diagnostic?.providerMessage).toContain('mitrify/half');
    expect(fake.mitrifyChat).not.toHaveBeenCalled();
    expect(fake.reserve).not.toHaveBeenCalled();
  });
  it('ignores a 0+0 row when a really priced cheap model is also listed', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({
      data: [
        { id: 'mitrify/zero', pricing: { prompt: 0, completion: 0 } },
        { id: 'mitrify/cheap', pricing: { prompt: '0.1', completion: '0.2' } },
      ],
    });
    fake.mitrifyChat.mockImplementation(async (_body: unknown, options?: { onChunk?: (wire: Uint8Array) => void }) => {
      const payload = { model: 'mitrify/cheap', choices: [{ delta: { content: 'Hello from priced' }, finish_reason: 'stop' }] };
      await options?.onChunk?.(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
      return { status: 200, headers: {}, data: undefined };
    });
    const result = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal);
    expect(result).toMatchObject({ provider: 'mitrify', model: 'mitrify/cheap', content: 'Hello from priced' });
    expect(fake.reserve).toHaveBeenCalledWith(expect.objectContaining({ maxCostNanoUsd: mitrifyQuotedHold(0.1, 0.2) }));
    expect(mitrifyQuotedHold(0.1, 0.2)).toBeGreaterThan(0);
  });
  it('falls back to mitrify/auto-cheap when the only catalog prices are zero', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({
      data: [
        { id: 'mitrify/zero', pricing: { prompt: 0, completion: 0 } },
        { id: 'mitrify/auto-cheap' },
      ],
    });
    const result = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal);
    expect(result).toMatchObject({ provider: 'mitrify', model: 'mitrify/auto-cheap' });
    expect(fake.reserve).toHaveBeenCalledWith(expect.objectContaining({ maxCostNanoUsd: mitrifyQuotedHold(1, 1) }));
  });
  it('treats tiny per-token-looking catalog prices as unpriced', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({
      data: [{ id: 'mitrify/tiny', pricing: { prompt: '0.0001', completion: '0.0002' } }],
    });
    const error = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('no-model');
    expect(error.diagnostic?.providerCode).toBe('MITRIFY_NO_PRICES');
    expect(error.diagnostic?.providerMessage).toContain('mitrify/tiny');
    expect(fake.mitrifyChat).not.toHaveBeenCalled();
    expect(fake.reserve).not.toHaveBeenCalled();
  });
  it('does not let tiny per-token-looking prices beat a real USD-per-MTok row', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({
      data: [
        { id: 'mitrify/tiny', pricing: { prompt: '0.0001', completion: '0.0002' } },
        { id: 'mitrify/cheap', pricing: { prompt: '0.1', completion: '0.2' } },
      ],
    });
    fake.mitrifyChat.mockImplementation(async (_body: unknown, options?: { onChunk?: (wire: Uint8Array) => void }) => {
      const payload = { model: 'mitrify/cheap', choices: [{ delta: { content: 'Hello from priced' }, finish_reason: 'stop' }] };
      await options?.onChunk?.(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
      return { status: 200, headers: {}, data: undefined };
    });
    const result = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal);
    expect(result).toMatchObject({ provider: 'mitrify', model: 'mitrify/cheap', content: 'Hello from priced' });
    expect(fake.reserve).toHaveBeenCalledWith(expect.objectContaining({ maxCostNanoUsd: mitrifyQuotedHold(0.1, 0.2) }));
  });
  it('excludes image-like catalog ids such as flux.1-pro from the cheapest pick', async () => {
    vi.stubEnv('MITRIFY_API_KEY', 'synthetic-mitrify-key-value');
    fake.mitrifyCatalog = async () => mitrifyCatalogResponse({
      data: [
        { id: 'flux.1-pro', pricing: { prompt: '0.1', completion: '0.1' } },
        { id: 'sdxl-base', pricing: { prompt: '0.1', completion: '0.1' } },
        { id: 'stable-diffusion-v1', pricing: { prompt: '0.1', completion: '0.1' } },
        { id: 'mitrify/chat', pricing: { prompt: '2', completion: '4' } },
      ],
    });
    fake.mitrifyChat.mockImplementation(async (_body: unknown, options?: { onChunk?: (wire: Uint8Array) => void }) => {
      const payload = { model: 'mitrify/chat', choices: [{ delta: { content: 'Hello from chat' }, finish_reason: 'stop' }] };
      await options?.onChunk?.(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
      return { status: 200, headers: {}, data: undefined };
    });
    const result = await runTestChat({ ...action, provider: 'mitrify' }, 'actor', new AbortController().signal);
    expect(result).toMatchObject({ provider: 'mitrify', model: 'mitrify/chat', content: 'Hello from chat' });
    expect(fake.mitrifyClient.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ MITRIFY_MODEL: 'mitrify/chat' }));
    expect(fake.reserve).toHaveBeenCalledWith(expect.objectContaining({ maxCostNanoUsd: mitrifyQuotedHold(2, 4) }));
  });
  it('enables OpenRouter from its key and uses shared strictFreeText when no allow-list is set', async () => {
    const openrouterRung = {
      id: 'openrouter', configured: true, key: 'synthetic-or-key', keyEnv: 'OPENROUTER_API_KEY',
      model: '', baseURL: 'https://openrouter.ai/api/v1', streamUsage: false, priceIn: 0, priceOut: 0,
    };
    fake.budgetConfig.mockReturnValue(budget({ rungs: [openrouterRung], openRouterModels: [] }));
    const row = testChatStatus().providers.find(item => item.id === 'openrouter-verified-free');
    expect(row).toMatchObject({ configured: true, enabled: true });
    expect(row?.unavailableReason).toBeUndefined();
    const result = await runTestChat({ ...action, provider: 'openrouter-verified-free' }, 'actor', new AbortController().signal);
    expect(result.content).toBe('Hello from registry');
    expect(fake.strictFree).toHaveBeenCalledOnce();
    expect(fake.strictFree).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 1, prompt: expect.stringContaining('Synthetic test question') }));
    expect(fake.registryRung).not.toHaveBeenCalled();
    expect(fake.run).not.toHaveBeenCalled();
  });

  it('reuses runRegistryRung when OpenRouter has an allow-list or an admin-typed model', async () => {
    const openrouterRung = {
      id: 'openrouter', configured: true, key: 'synthetic-or-key', keyEnv: 'OPENROUTER_API_KEY',
      model: '', baseURL: 'https://openrouter.ai/api/v1', streamUsage: false, priceIn: 0, priceOut: 0,
    };
    fake.budgetConfig.mockReturnValue(budget({ rungs: [openrouterRung], openRouterModels: ['openai/gpt-oss-20b:free'] }));
    await runTestChat({ ...action, provider: 'openrouter-verified-free' }, 'actor', new AbortController().signal);
    expect(fake.registryRung).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 1024 }), ['openai/gpt-oss-20b:free'], 'openai/gpt-oss-20b:free');
    expect(fake.strictFree).not.toHaveBeenCalled();
    fake.registryRung.mockClear();
    fake.budgetConfig.mockReturnValue(budget({ rungs: [openrouterRung], openRouterModels: [] }));
    await runTestChat({ ...action, provider: 'openrouter-verified-free', model: 'meta-llama/llama-3.3-70b-instruct:free' }, 'actor', new AbortController().signal);
    expect(fake.registryRung).toHaveBeenCalledWith(expect.anything(), ['meta-llama/llama-3.3-70b-instruct:free'], 'meta-llama/llama-3.3-70b-instruct:free');
  });
  it('falls back to a live public-catalog :free zero-price model when LiveRegistry is not configured', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-or-key');
    const openrouterRung = {
      id: 'openrouter', configured: true, key: 'synthetic-or-key', keyEnv: 'OPENROUTER_API_KEY',
      model: '', baseURL: 'https://openrouter.ai/api/v1', streamUsage: false, priceIn: 0, priceOut: 0,
    };
    fake.budgetConfig.mockReturnValue(budget({ rungs: [openrouterRung], openRouterModels: [] }));
    fake.strictFree.mockRejectedValue(new FreeRoutingError('FREE_REGISTRY_NOT_CONFIGURED'));
    fake.catalogJson = vi.fn().mockResolvedValue({
      data: [
        { id: 'paid/model', pricing: { prompt: '1', completion: '1' } },
        { id: 'zeta/older:free', pricing: { prompt: '0', completion: '0' } },
        { id: 'alpha/cheap:free', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
        { id: 'beta/almost:free', pricing: { prompt: '0.0001', completion: '0' } },
        { id: 'gamma/zero', pricing: { prompt: '0', completion: '0' } },
        { id: 'image/only:free', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['image'], output_modalities: ['text'] } },
      ],
    });
    fake.officialOpenAi.mockResolvedValue({ content: 'Hello from catalog', model: 'alpha/cheap:free', usage: { inputTokens: 2, outputTokens: 3 } });
    const result = await runTestChat({ ...action, provider: 'openrouter-verified-free' }, 'actor', new AbortController().signal);
    expect(result).toMatchObject({ provider: 'openrouter-verified-free', content: 'Hello from catalog', model: 'alpha/cheap:free', noFallback: true });
    expect(fake.catalogJson).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', null, fetch, expect.any(AbortSignal));
    expect(fake.officialOpenAi).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://openrouter.ai/api/v1/chat/completions', model: 'alpha/cheap:free', apiKey: 'synthetic-or-key', messages: action.messages,
    }));
    expect(fake.strictFree).toHaveBeenCalledOnce();
    expect(fake.run).not.toHaveBeenCalled();
  });
  it('accepts a typed OpenRouter model only when the live catalog lists it as free', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-or-key');
    const openrouterRung = {
      id: 'openrouter', configured: true, key: 'synthetic-or-key', keyEnv: 'OPENROUTER_API_KEY',
      model: '', baseURL: 'https://openrouter.ai/api/v1', streamUsage: false, priceIn: 0, priceOut: 0,
    };
    fake.budgetConfig.mockReturnValue(budget({ rungs: [openrouterRung], openRouterModels: [] }));
    fake.registryRung.mockRejectedValue(new Error('FREE_CHAIN_REGISTRY_UNAVAILABLE'));
    fake.catalogJson = vi.fn().mockResolvedValue({
      data: [
        { id: 'paid/model', pricing: { prompt: '2', completion: '3' } },
        { id: 'zeta/older:free', pricing: { prompt: '0', completion: '0' } },
      ],
    });
    fake.officialOpenAi.mockResolvedValue({ content: 'Typed free model', model: 'zeta/older:free' });
    const ok = await runTestChat({ ...action, provider: 'openrouter-verified-free', model: 'zeta/older:free' }, 'actor', new AbortController().signal);
    expect(ok.model).toBe('zeta/older:free');
    expect(fake.officialOpenAi).toHaveBeenCalledWith(expect.objectContaining({ model: 'zeta/older:free' }));
    fake.officialOpenAi.mockClear();
    const error = await runTestChat({ ...action, provider: 'openrouter-verified-free', model: 'paid/model' }, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('no-model');
    expect(error.diagnostic?.providerCode).toBe('FREE_REGISTRY_NOT_CONFIGURED');
    expect(fake.officialOpenAi).not.toHaveBeenCalled();
  });
  it('maps a shared OpenRouter NO_VERIFIED_FREE_MODEL miss to no-model', async () => {
    const openrouterRung = {
      id: 'openrouter', configured: true, key: 'synthetic-or-key', keyEnv: 'OPENROUTER_API_KEY',
      model: '', baseURL: 'https://openrouter.ai/api/v1', streamUsage: false, priceIn: 0, priceOut: 0,
    };
    fake.budgetConfig.mockReturnValue(budget({ rungs: [openrouterRung], openRouterModels: [] }));
    fake.strictFree.mockRejectedValue(new FreeRoutingError('NO_VERIFIED_FREE_MODEL'));
    await expect(runTestChat({ ...action, provider: 'openrouter-verified-free' }, 'actor', new AbortController().signal)).rejects.toMatchObject({ reason: 'no-model' });
    expect(fake.strictFree).toHaveBeenCalledOnce();
  });
  it('refreshes an empty Qubax plan through the shared collector then dispatches the shared ranker', async () => {
    let reads = 0;
    fake.marketPlan = vi.fn().mockImplementation(async () => {
      reads += 1;
      return reads === 1 ? { eligible: [], backup: null } : { eligible: [{ modelId: 'shared-cheap-model' }], backup: null };
    });
    fake.refresh.mockResolvedValue({ status: 'synced' });
    await runTestChat(action, 'actor', new AbortController().signal);
    expect(fake.refresh).toHaveBeenCalledOnce();
    expect(fake.run).toHaveBeenCalledOnce();
    expect(fake.run.mock.calls[0]?.[0].adminFallbackTries).toBeUndefined();
  });
  it('passes a typed Qubax model only after the shared plan stays empty', async () => {
    fake.marketPlan = vi.fn().mockResolvedValue({ eligible: [], backup: null });
    fake.refresh.mockResolvedValue({ status: 'unavailable' });
    await runTestChat({ ...action, model: 'admin-chosen-model' }, 'actor', new AbortController().signal);
    expect(fake.refresh).toHaveBeenCalledOnce();
    expect(fake.run).toHaveBeenCalledWith(expect.objectContaining({
      adminFallbackTries: [expect.objectContaining({ modelId: 'admin-chosen-model', backup: true })],
    }));
  });
  it('explains a Qubax no-model skip with feed counts and the last refresh status', async () => {
    fake.marketPlan = vi.fn().mockResolvedValue({ eligible: [], backup: null });
    fake.feedSummary = vi.fn().mockResolvedValue({
      fresh: false, observedAtMs: null, pricedRows: 0, officialMatches: 0, discountEligible: 0, probePassing: 0,
    });
    fake.refresh.mockResolvedValue({ status: 'unavailable' });
    fake.run.mockResolvedValue({ kind: 'skipped', reason: 'qubax-price-or-quality-unverified' });
    const error = await runTestChat(action, 'actor', new AbortController().signal).catch(value => value) as TestChatUnavailable;
    expect(error.reason).toBe('no-model');
    expect(error.diagnostic?.rawErrorBody).toContain('0 priced Qubax rows');
    expect(error.diagnostic?.rawErrorBody).toContain('0 at a 90%+ Qubax discount');
    expect(error.diagnostic?.rawErrorBody).toContain('Last feed refresh: unavailable');
  });
  it.each(['disabled', 'terms-shared-access'] as const)('enables CheaperInference from its key even when user-chat mode is %s', async reason => {
    const cheap = {
      id: 'cheapinf', configured: true, key: 'synthetic-cheap-key', keyEnv: 'CHEAPERINFERENCE_API_KEY',
      model: 'beam', baseURL: 'https://api.cheaperinference.com/v1', streamUsage: false, priceIn: 0, priceOut: 0, reason,
    };
    fake.budgetConfig.mockReturnValue(budget({ rungs: [cheap] }));
    fake.compatTurn.mockResolvedValue({ content: 'Hello from beam', model: 'beam' });
    const row = testChatStatus().providers.find(item => item.id === 'cheaperinference-beam');
    expect(row).toMatchObject({ configured: true, enabled: true, model: 'beam' });
    expect(row?.unavailableReason).toBeUndefined();
    const result = await runTestChat({ ...action, provider: 'cheaperinference-beam' }, 'actor', new AbortController().signal);
    expect(result.content).toBe('Hello from beam');
    expect(fake.compatCtor).toHaveBeenCalledWith(expect.objectContaining({ provider: 'CHEAPERINFERENCE', model: 'beam' }));
    expect(fake.run).not.toHaveBeenCalled();
  });
});

