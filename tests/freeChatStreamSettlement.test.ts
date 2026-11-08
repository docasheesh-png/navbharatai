import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ openai: vi.fn(), vertex: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: m.openai } }; } }));
vi.mock('../src/server/lib/vertexGenAI', () => ({ vertexGenAI: () => ({ models: { generateContentStream: m.vertex } }), vertexProjectId: () => 'offline-project', vertexLocation: () => 'offline-region' }));
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync: vi.fn(), write: vi.fn() } }));
import { AIRouterManager } from '../src/server/AI/AIRouterManager';
import { OpenAiChatProvider } from '../src/server/AI/Router/providers/OpenAiChatProvider';
import { VertexProvider } from '../src/server/AI/Router/providers/VertexProvider';
import type { AIProvider } from '../src/server/AI/Router/ProviderTypes';
import { completeStreamUsage, openAiStreamUsage, vertexStreamUsage } from '../src/server/AI/Router/streamUsage';
import { cappedFreeTierRung, setFreeTierPaidStoreForTests, settleFreeTierPaid } from '../src/server/lib/freeTierPaidCap';
import { FreeChainStore } from '../src/server/AI/FreeChain/store';

async function* chunks(values: unknown[]) { for (const value of values) yield value; }
const openAiChunks = () => [
  { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
  { choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 80 } } },
];
const vertexChunks = () => [
  { text: 'Hello', candidates: [{}] },
  { text: '', candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5, thoughtsTokenCount: 7, cachedContentTokenCount: 80 } },
];
beforeEach(() => {
  vi.clearAllMocks(); AIRouterManager.reset();
  vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off'); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off');
  vi.stubEnv('OPENAI_CHAT_MODEL', ''); vi.stubEnv('OPENAI_API_KEY', 'offline-test-only');
  vi.stubEnv('FREE_TIER_PAID_DAILY_CAP_USD', '10');
  vi.stubEnv('RATE_GEMINI_LITE_IN', '0.1'); vi.stubEnv('RATE_GEMINI_LITE_OUT', '0.4');
  vi.stubEnv('RATE_GPT_NANO_IN', '0.2'); vi.stubEnv('RATE_GPT_NANO_OUT', '1.25');
  m.openai.mockImplementation(async () => chunks(openAiChunks()));
  m.vertex.mockImplementation(async () => chunks(vertexChunks()));
});
afterEach(() => { setFreeTierPaidStoreForTests(undefined); vi.unstubAllEnvs(); });

describe('complete stream receipts', () => {
  it.each([undefined, null, -1, 1.5, '3', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuses missing or invalid counters: %s', bad => {
    expect(completeStreamUsage(bad, 2)).toBeUndefined(); expect(completeStreamUsage(2, bad)).toBeUndefined();
    expect(openAiStreamUsage({ prompt_tokens: bad, completion_tokens: 2 })).toBeUndefined();
    expect(vertexStreamUsage({ promptTokenCount: 2, candidatesTokenCount: bad })).toBeUndefined();
  });
  it('preserves genuine zero and includes Google thinking without double-counting cached input', () => {
    expect(openAiStreamUsage({ prompt_tokens: 0, completion_tokens: 0 })).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(vertexStreamUsage(vertexChunks()[1].usageMetadata)).toEqual({ inputTokens: 100, outputTokens: 12 });
    expect(vertexStreamUsage({ promptTokenCount: 0, candidatesTokenCount: 0 })).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(vertexStreamUsage({ promptTokenCount: 1, candidatesTokenCount: 1, thoughtsTokenCount: null })).toBeUndefined();
    expect(vertexStreamUsage({ promptTokenCount: 1, candidatesTokenCount: Number.MAX_SAFE_INTEGER, thoughtsTokenCount: 1 })).toBeUndefined();
    expect(vertexStreamUsage({ promptTokenCount: 1, candidatesTokenCount: 2, toolUsePromptTokenCount: 3 })).toBeUndefined();
  });
  it.each([null, -1, NaN, '105', 112, Number.MAX_SAFE_INTEGER + 1])('rejects inconsistent or malformed reported totals: %s', total => {
    expect(openAiStreamUsage({ prompt_tokens: 100, completion_tokens: 5, total_tokens: total })).toBeUndefined();
    expect(vertexStreamUsage({ promptTokenCount: 100, candidatesTokenCount: 5, totalTokenCount: total })).toBeUndefined();
  });
  it('accepts matching optional totals, including thinking and genuine zero', () => {
    expect(openAiStreamUsage({ prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 })).toEqual({ inputTokens: 100, outputTokens: 5 });
    expect(vertexStreamUsage({ promptTokenCount: 100, candidatesTokenCount: 5, thoughtsTokenCount: 7, totalTokenCount: 112 })).toEqual({ inputTokens: 100, outputTokens: 12 });
    expect(vertexStreamUsage({ promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 })).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
  it('requests OpenAI terminal usage and emits it once after normal completion', async () => {
    const usage = vi.fn(); const text = vi.fn(); const controller = new AbortController();
    expect(await new OpenAiChatProvider().executeStream('hi', 'system', text, 'gpt-5-nano', controller.signal, usage)).toBe('Hello');
    expect(usage).toHaveBeenCalledExactlyOnceWith({ inputTokens: 100, outputTokens: 5 });
    expect(text).toHaveBeenCalledExactlyOnceWith('Hello');
    expect(m.openai.mock.calls[0][0]).toMatchObject({ model: 'gpt-5-nano', stream_options: { include_usage: true } });
    expect(m.openai.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it.each(['missing', 'partial', 'no-finish', 'later-content'] as const)('OpenAI keeps %s stream usage unmeasured', async kind => {
    const values = openAiChunks();
    if (kind === 'missing') values.pop();
    if (kind === 'partial') values[2] = { choices: [], usage: { prompt_tokens: 100 } } as any;
    if (kind === 'no-finish') values.splice(1, 1);
    if (kind === 'later-content') values.push({ choices: [{ delta: { content: 'late' }, finish_reason: null }] });
    m.openai.mockImplementation(async () => chunks(values)); const usage = vi.fn();
    await new OpenAiChatProvider().executeStream('hi', undefined, () => {}, undefined, undefined, usage);
    expect(usage).not.toHaveBeenCalled();
  });
  it('Vertex carries complete billed output including thinking on a token-limited completion', async () => {
    const values = vertexChunks(); values[1].candidates = [{ finishReason: 'MAX_TOKENS' }];
    m.vertex.mockImplementation(async () => chunks(values)); const usage = vi.fn(); const controller = new AbortController();
    expect(await new VertexProvider().executeStream('hi', 'system', () => {}, 'gemini-2.5-flash-lite', controller.signal, usage)).toBe('Hello');
    expect(usage).toHaveBeenCalledExactlyOnceWith({ inputTokens: 100, outputTokens: 12 });
    expect(m.vertex.mock.calls[0][0]).toMatchObject({ model: 'gemini-2.5-flash-lite', config: { abortSignal: controller.signal, systemInstruction: 'system' } });
  });
  it.each(['missing', 'partial', 'no-finish', 'later-content'] as const)('Vertex keeps %s stream usage unmeasured', async kind => {
    const values: any[] = vertexChunks();
    if (kind === 'missing') delete values[1].usageMetadata;
    if (kind === 'partial') values[1].usageMetadata = { promptTokenCount: 100 };
    if (kind === 'no-finish') values[1].candidates = [{}];
    if (kind === 'later-content') values.push({ text: 'late' });
    m.vertex.mockImplementation(async () => chunks(values)); const usage = vi.fn();
    await new VertexProvider().executeStream('hi', undefined, () => {}, undefined, undefined, usage);
    expect(usage).not.toHaveBeenCalled();
  });
  it.each(['openai', 'vertex'] as const)('%s does not emit a receipt when iteration fails after usage arrives', async provider => {
    m[provider].mockImplementation(async () => (async function* () { yield* chunks(provider === 'openai' ? openAiChunks() : vertexChunks()); throw new Error('truncated transport'); })());
    const usage = vi.fn(); const adapter = provider === 'openai' ? new OpenAiChatProvider() : new VertexProvider();
    await expect(adapter.executeStream('hi', undefined, () => {}, undefined, undefined, usage)).rejects.toThrow('truncated transport');
    expect(usage).not.toHaveBeenCalled();
  });
  it.each(['openai', 'vertex'] as const)('%s does not emit a receipt after caller abort', async provider => {
    const controller = new AbortController(); const usage = vi.fn();
    m[provider].mockImplementation(async () => (async function* () { yield* chunks(provider === 'openai' ? openAiChunks() : vertexChunks()); controller.abort(); })());
    const adapter = provider === 'openai' ? new OpenAiChatProvider() : new VertexProvider();
    await adapter.executeStream('hi', undefined, () => {}, undefined, controller.signal, usage);
    expect(usage).not.toHaveBeenCalled();
  });
  it.each(['', 'FINISH_REASON_UNSPECIFIED', 'unknown-new-reason'])('keeps unknown finish reason %s unmeasured', async finish => {
    const openai = openAiChunks(); openai[1].choices[0].finish_reason = finish;
    m.openai.mockImplementation(async () => chunks(openai)); const openaiUsage = vi.fn();
    await new OpenAiChatProvider().executeStream('hi', undefined, () => {}, undefined, undefined, openaiUsage);
    expect(openaiUsage).not.toHaveBeenCalled();
    const vertex = vertexChunks(); vertex[1].candidates = [{ finishReason: finish }];
    m.vertex.mockImplementation(async () => chunks(vertex)); const vertexUsage = vi.fn();
    await new VertexProvider().executeStream('hi', undefined, () => {}, undefined, undefined, vertexUsage);
    expect(vertexUsage).not.toHaveBeenCalled();
  });
});

class OfflineDb {
  docs = new Map<string, any>();
  doc(path: string) { return { path }; }
  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const writes = new Map<string, any>();
    const result = await fn({ get: async ({ path }: { path: string }) => ({ exists: this.docs.has(path), data: () => structuredClone(this.docs.get(path)) }),
      set: ({ path }: { path: string }, data: any) => writes.set(path, structuredClone(data)) });
    for (const [path, data] of writes) this.docs.set(path, data);
    return result;
  }
}
describe('stream receipt reaches the original shared reservation', () => {
  it.each([['VERTEX', 'gemini-2.5-flash-lite', 14_800], ['OPENAI', 'gpt-5-nano', 26_250]] as const)('%s settles its pinned model after a successful SDK stream', async (name, model, expected) => {
    const db = new OfflineDb(); const store = new FreeChainStore(db as never, { adminEmails: () => [] });
    const held: any[] = [];
    const reservePaid = vi.fn(async (input: any) => { const value = await store.reservePaid(input); held.push(value); return value; });
    const settlePaid = vi.fn((hold: any, actual?: number) => store.settlePaid(hold, actual));
    setFreeTierPaidStoreForTests({ reservePaid, settlePaid });
    const provider = ((AIRouterManager.getRouter('free') as any).providers as AIProvider[]).find(p => p.name === name && p.pinnedModel === model)!;
    const receipt = vi.fn();
    expect(await provider.executeStream!('hi', 'system', () => {}, 'ignored-wrong-model', undefined, receipt)).toBe('Hello');
    expect(reservePaid).toHaveBeenCalledOnce(); expect(settlePaid).toHaveBeenCalledExactlyOnceWith(held[0], expected);
    const first = await store.spendSnapshot();
    expect(first).toMatchObject({ heldNanoUsd: 0, spentNanoUsd: expected, pending: 0, requests: 1 });
    expect(held[0].maxCostNanoUsd).toBeGreaterThan(expected);
    expect(receipt).toHaveBeenCalledOnce();
    // The tombstone survives settlement. It does not authorize another physical call.
    expect((await store.reservePaid(reservePaid.mock.calls[0][0]))?.mayDispatch).toBe(false);
    expect(await store.settlePaid(held[0], expected)).toBe(true);
    expect((await store.spendSnapshot()).spentNanoUsd).toBe(expected);
    expect([...db.docs.keys()].every(path => path.startsWith('free_chat_chain/'))).toBe(true);
  });
  const held = { id: 'synthetic', day: '2026-11-08', uidHash: 'owner', maxCostNanoUsd: 100000, createdAt: 0, mayDispatch: true };
  function wrapper(executeStream: NonNullable<AIProvider['executeStream']>) {
    return cappedFreeTierRung({ name: 'VERTEX', pinnedModel: 'gemini-2.5-flash-lite', priority: 1, healthCheck: async () => true, execute: vi.fn(), executeStream }, 'free-chat');
  }
  it.each(['missing', 'invalid', 'rejected', 'aborted'] as const)('retains the hold for %s usage or outcome', async kind => {
    const settlePaid = vi.fn(async () => true); setFreeTierPaidStoreForTests({ reservePaid: vi.fn(async () => held), settlePaid });
    const controller = new AbortController();
    const provider = wrapper(async (_p, _s, _c, _m, _signal, onUsage) => {
      if (kind !== 'missing') onUsage?.(kind === 'invalid' ? { inputTokens: 100 } as any : { inputTokens: 100, outputTokens: 5 });
      if (kind === 'rejected') throw new Error('unknown finish'); if (kind === 'aborted') controller.abort(); return 'partial';
    });
    await provider.executeStream!('hi', undefined, () => {}, undefined, controller.signal).catch(() => {});
    expect(settlePaid).not.toHaveBeenCalled();
  });
  it('does not retry physical inference if settlement fails', async () => {
    const settlePaid = vi.fn(async () => { throw new Error('store unavailable'); });
    setFreeTierPaidStoreForTests({ reservePaid: vi.fn(async () => held), settlePaid });
    const executeStream = vi.fn(async (_p, _s, _c, _m, _signal, onUsage) => { onUsage?.({ inputTokens: 100, outputTokens: 5 }); return 'answer'; });
    expect(await wrapper(executeStream).executeStream!('hi', undefined, () => {})).toBe('answer');
    expect(executeStream).toHaveBeenCalledOnce(); expect(settlePaid).toHaveBeenCalledOnce();
  });
  it('settles genuine zero usage, never a missing/negative/unsafe counter', async () => {
    const settlePaid = vi.fn(async () => true); setFreeTierPaidStoreForTests({ reservePaid: vi.fn(async () => held), settlePaid });
    const hold = { reservation: held, model: 'gemini-2.5-flash-lite' };
    await settleFreeTierPaid(hold, { inputTokens: 0, outputTokens: 0 });
    expect(settlePaid).toHaveBeenCalledExactlyOnceWith(held, 0); settlePaid.mockClear();
    for (const usage of [undefined, {}, { inputTokens: -1, outputTokens: 2 }, { inputTokens: 1, outputTokens: Number.MAX_SAFE_INTEGER + 1 }]) await settleFreeTierPaid(hold, usage);
    expect(settlePaid).not.toHaveBeenCalled();
  });
});
