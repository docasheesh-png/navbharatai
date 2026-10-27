import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ db: null as any, reserve: vi.fn(), settle: vi.fn(), snapshot: vi.fn(), execute: vi.fn(), client: vi.fn(), maintenance: vi.fn(), monthly: vi.fn(), monthSettle: vi.fn() }));
vi.mock('./serverDb', () => ({ getServerDb: () => fake.db }));
vi.mock('./aiMaintenance', () => ({ assertAiAvailable: fake.maintenance }));
vi.mock('../AI/FreeChain/masterPlan', () => ({ reserveMonthly: fake.monthly, settleMonthly: fake.monthSettle }));
vi.mock('../AI/FreeChain/store', () => ({ FreeChainStore: class { reservePaid = fake.reserve; settlePaid = fake.settle; spendSnapshot = fake.snapshot; } }));
vi.mock('./deepinfraComparisonClient', () => ({ COMPARISON_OUTPUT_TOKENS: 512, createComparisonClient: fake.client, executeComparisonCase: fake.execute }));
import { comparisonStatus, comparisonTariffDigest, readComparisonRates, runComparison } from './deepinfraComparison';
import { DEEPINFRA_COMPARISON_MODELS, summarizeComparison, readComparisonAction, isComparisonReport } from '../../lib/deepinfraComparison';
const id = '1d2efc71-6d00-4514-83c0-e31461ea9f35';
const catalog = () => DEEPINFRA_COMPARISON_MODELS.map((model_name, i) => ({ model_name, type: 'text-generation', max_tokens: 1048576,
  tags: ['tools', 'json', 'can-disable-reasoning'], pricing: { type: 'tokens', cents_per_input_token: i ? .00002 : .000006, cents_per_output_token: i ? .00006 : .000018 } }));
function database(initial?: any) {
  let state = initial, saves = 0;
  const ref = { get: async () => ({ data: () => state }) };
  const db = { doc: () => ref, runTransaction: async (fn: any) => fn({ get: async () => ({ data: () => state }), set: (_ref: unknown, next: unknown) => { state = next; saves++; } }) };
  return { db, state: () => state, saves: () => saves };
}
async function tariff() { return comparisonTariffDigest((await readComparisonRates()).rates); }
beforeEach(() => {
  vi.clearAllMocks(); fake.db = database().db; vi.stubEnv('FREE_CHAIN_DEEPINFRA_API_KEY', 'synthetic-credential');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalog()))));
  fake.snapshot.mockResolvedValue({ available: true, remainingNanoUsd: 10e9 });
  fake.reserve.mockImplementation(async (input: any) => ({ ...input, mayDispatch: true }));
  fake.settle.mockResolvedValue(true); fake.monthly.mockResolvedValue('2026-10'); fake.monthSettle.mockResolvedValue(undefined);
  fake.maintenance.mockResolvedValue(undefined); fake.client.mockReturnValue({});
  fake.execute.mockResolvedValue({ passed: true, reason: 'passed', latencyMs: 100, firstTokenMs: null, inputTokens: 20, outputTokens: 10 });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('DeepInfra comparison orchestration', () => {
  it('opening status reads catalog, saved result and budget without inference or reservations', async () => {
    const status = await comparisonStatus();
    expect(status).toMatchObject({ configured: true, catalogAvailable: true, budgetAvailable: true, lastReport: null });
    expect(status.rates[1].inputPerMillion).toBeCloseTo(.2); expect(status.maximumReservationUsd).toBeLessThan(2);
    expect(fake.execute).not.toHaveBeenCalled(); expect(fake.reserve).not.toHaveBeenCalled();
    expect(JSON.stringify(status)).not.toContain('synthetic-credential');
  });
  it('runs twelve fixed, alternating attempts only after durable reservations and records real usage-based costs', async () => {
    const report = await runComparison(id, 'owner', new AbortController().signal, await tariff());
    expect(report.completed).toBe(true); expect(report.results).toHaveLength(12); expect(isComparisonReport(report)).toBe(true);
    expect(fake.execute).toHaveBeenCalledTimes(12); expect(fake.reserve).toHaveBeenCalledTimes(12);
    expect(fake.reserve.mock.invocationCallOrder[0]).toBeLessThan(fake.execute.mock.invocationCallOrder[0]);
    expect(fake.execute.mock.calls.slice(0, 4).map(call => call[1])).toEqual([DEEPINFRA_COMPARISON_MODELS[0], DEEPINFRA_COMPARISON_MODELS[1], DEEPINFRA_COMPARISON_MODELS[1], DEEPINFRA_COMPARISON_MODELS[0]]);
    expect(report.summaries.every(s => s.passed === 6 && s.totalCostUsd! > 0 && s.costPerPassedCaseUsd! > 0)).toBe(true);
    expect(fake.reserve.mock.calls.reduce((n, call) => n + call[0].maxCostNanoUsd, 0)).toBeLessThan(2e9);
    expect(fake.reserve.mock.calls[0][0].maxCostNanoUsd).toBeGreaterThan(.06e9); // full context, not a guessed chars/token ratio
  });
  it('saved replay returns the existing result with no new paid calls', async () => {
    const first = await runComparison(id, 'owner', new AbortController().signal, await tariff());
    fake.execute.mockClear(); fake.reserve.mockClear();
    expect(await runComparison(id, 'owner', new AbortController().signal, await tariff())).toEqual(first);
    expect(fake.execute).not.toHaveBeenCalled(); expect(fake.reserve).not.toHaveBeenCalled();
  });
  it('a running new ID cannot replay an older saved report as its result', async () => {
    const report = await runComparison(id, 'owner', new AbortController().signal, await tariff());
    fake.db = database({ status: 'running', runId: '2d2efc71-6d00-4514-83c0-e31461ea9f35', expiresAt: Date.now() + 600000, report }).db;
    fake.execute.mockClear();
    await expect(runComparison('2d2efc71-6d00-4514-83c0-e31461ea9f35', 'owner', new AbortController().signal, await tariff())).rejects.toThrow('already-running');
    expect(fake.execute).not.toHaveBeenCalled();
  });
  it('changed tariffs, missing key, missing DB and insufficient global budget all prevent paid dispatch', async () => {
    await expect(runComparison(id, 'owner', new AbortController().signal, '0'.repeat(64))).rejects.toThrow('rates-changed');
    vi.stubEnv('FREE_CHAIN_DEEPINFRA_API_KEY', ''); vi.stubEnv('DEEPINFRA_TOKEN', '');
    await expect(runComparison(id, 'owner', new AbortController().signal, await tariff())).rejects.toThrow('credential-unavailable');
    vi.stubEnv('FREE_CHAIN_DEEPINFRA_API_KEY', 'synthetic'); fake.snapshot.mockResolvedValue({ available: true, remainingNanoUsd: 1 });
    await expect(runComparison(id, 'owner', new AbortController().signal, await tariff())).rejects.toThrow('shared-budget');
    fake.db = null; await expect(runComparison(id, 'owner', new AbortController().signal, await tariff())).rejects.toThrow('storage');
    expect(fake.execute).not.toHaveBeenCalled();
  });
  it('duplicate or refused reservation prevents dispatch and does not reserve monthly spend', async () => {
    fake.reserve.mockResolvedValue({ mayDispatch: false });
    const report = await runComparison(id, 'owner', new AbortController().signal, await tariff());
    expect(report).toMatchObject({ completed: false, stopReason: 'budget-or-duplicate-attempt', results: [] });
    expect(fake.execute).not.toHaveBeenCalled(); expect(fake.monthly).not.toHaveBeenCalled();
    expect(report.summaries.every(s => s.totalCostUsd === null)).toBe(true);
  });
  it('failed monthly admission releases only its undispatched daily hold', async () => {
    fake.monthly.mockResolvedValue(null);
    expect((await runComparison(id, 'owner', new AbortController().signal, await tariff())).stopReason).toBe('monthly-budget');
    expect(fake.execute).not.toHaveBeenCalled(); expect(fake.settle.mock.calls[0][1]).toBe(0);
  });
  it('unknown usage retains full reservations and never produces a free or zero-dollar result', async () => {
    fake.execute.mockResolvedValue({ passed: true, reason: 'passed', latencyMs: 20, firstTokenMs: null, inputTokens: null, outputTokens: null });
    const report = await runComparison(id, 'owner', new AbortController().signal, await tariff());
    expect(report.results.every(r => r.costUsd === null && !r.settlementConfirmed)).toBe(true);
    expect(report.summaries.every(s => s.totalCostUsd === null && s.costPerPassedCaseUsd === null)).toBe(true);
    expect(fake.settle).not.toHaveBeenCalled(); expect(fake.monthSettle.mock.calls[0][3]).toBeNull();
  });
  it('429 and authentication errors stop further attempts without retrying', async () => {
    fake.execute.mockResolvedValue({ passed: false, reason: 'rate-limit', latencyMs: 5, firstTokenMs: null, inputTokens: null, outputTokens: null });
    expect((await runComparison(id, 'owner', new AbortController().signal, await tariff())).stopReason).toBe('rate-limit');
    expect(fake.execute).toHaveBeenCalledOnce(); expect(fake.settle).not.toHaveBeenCalled();
  });
  it('an unconfirmed settlement stops the run instead of continuing after an accounting failure', async () => {
    fake.settle.mockResolvedValue(false);
    expect((await runComparison(id, 'owner', new AbortController().signal, await tariff())).stopReason).toBe('accounting-unconfirmed');
    expect(fake.execute).toHaveBeenCalledOnce();
  });
  it('catalog validation refuses unknown rates, capabilities and replacement models', async () => {
    for (const change of [{ deprecated: true }, { tags: [] }, { pricing: {} }, { max_tokens: 0 }, { pricing: { type: 'tokens', cents_per_input_token: 1, cents_per_output_token: 1 } }]) {
      const rows = catalog(); Object.assign(rows[1], change);
      await expect(readComparisonRates(async () => new Response(JSON.stringify(rows)))).rejects.toThrow();
    }
    expect(fake.execute).not.toHaveBeenCalled();
  });
  it('rejects endpoint/key/model injection and requires explicit review of rates', () => {
    const action = { runId: id, reason: 'Compare the two pinned models', tariffDigest: 'a'.repeat(64), acceptPublishedRates: true };
    expect(readComparisonAction(action)).not.toBeNull();
    for (const change of [{ endpoint: 'https://evil.test' }, { model: 'arbitrary' }, { key: 'private' }, { acceptPublishedRates: false }, { reason: 'short' }, { tariffDigest: '' }]) expect(readComparisonAction({ ...action, ...change })).toBeNull();
    expect(summarizeComparison([]).every(s => s.totalCostUsd === null && s.medianLatencyMs === null)).toBe(true);
  });
});
